'use strict';

/**
 * Plan / apply / cleanup for the synthetic staging fixtures.
 *
 * Every written document carries `fixtureTag` and `fixtureKey`. Writes go
 * through the native collection (the app schemas do not declare these two
 * fields, so a Mongoose write would strip them), after each document has
 * been validated against its Mongoose model.
 *
 * - plan:    read-only; resolves existing fixtures by marker and reports
 *            what apply would create, plus any blocking conflicts.
 * - apply:   inserts missing fixtures only ($setOnInsert upsert keyed on the
 *            marker). Existing fixture documents are never modified, so a
 *            second apply is a no-op.
 * - cleanup: deletes documents whose fixtureTag equals the fixture tag, and
 *            nothing else. It never matches on names or emails.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const { FIXTURE_TAG, buildFixtureSpec } = require('./fixtureSpec');

/**
 * Deterministic ObjectId for a fixture key: the first 12 bytes of
 * sha256("<tag>:<key>"). References between fixtures therefore never depend
 * on which documents already exist.
 */
function fixtureObjectId(key) {
  const digest = crypto.createHash('sha256').update(`${FIXTURE_TAG}:${key}`).digest();
  return new mongoose.Types.ObjectId(digest.subarray(0, 12).toString('hex'));
}

/**
 * Related (non-marker) documents that QA flows create against fixtures.
 *
 * For each collection: `owner` is the acting user's field (buyer, customer,
 * reviewer); `refs` are the vendor/business/listing reference paths (dotted
 * paths into arrays are allowed). A related document is deletable only when
 * its owner is a fixture user id AND every non-empty ref is a fixture id.
 * Anything else that touches a fixture id is reported for manual review and
 * never deleted.
 *
 * Refunds (local payment records) have no owner field: a refund is deletable
 * only when its order is itself deletable and every refunded variant is a
 * fixture id. Stripe is never called.
 */
const RELATED_COLLECTIONS = [
  {
    collection: 'cartitems',
    owner: 'userId',
    refs: ['productId', 'variantId', 'businessId'],
  },
  {
    collection: 'carts',
    owner: 'userId',
    refs: ['businessId'],
    // A cart is deletable only if every item it lists is a deletable cart item.
    childRefs: { path: 'items', collection: 'cartitems' },
  },
  {
    collection: 'orders',
    owner: 'userId',
    refs: ['vendorId', 'businessId', 'items.productId', 'items.variantId', 'inventoryAdjustments.variantId'],
  },
  {
    collection: 'refunds',
    owner: null,
    refs: ['refundedItems.productVariantId'],
    parentRef: { path: 'orderId', collection: 'orders' },
  },
  {
    collection: 'reviews',
    owner: 'userId',
    refs: ['listingId'],
  },
  {
    collection: 'bookings',
    owner: 'customerId',
    refs: ['ownerId', 'businessId', 'serviceId', 'foodId'],
  },
];

// Upper bound on related documents examined per collection; above it the
// cleanup refuses rather than scanning or deleting an unbounded set.
const MAX_RELATED_PER_COLLECTION = 5000;

// Dependents are deleted before what they point at, so an interrupted run
// never strands a dependent (refund, cart) whose parent is already gone.
const RELATED_DELETE_ORDER = ['refunds', 'orders', 'carts', 'cartitems', 'reviews', 'bookings'];

/**
 * Error whose message is safe to print as-is (no URIs or field values).
 */
class FixtureSafeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FixtureSafeError';
    this.isFixtureSafe = true;
  }
}

const MODEL_FILES = {
  User: 'User',
  VendorOnboardingStage1: 'VendorOnboardingStage1',
  Subscription: 'Subscription',
  SubscriptionPlan: 'SubscriptionPlan',
  Business: 'Business',
  ProductCategory: 'ProductCategory',
  ProductSubcategory: 'ProductSubcategory',
  ServiceCategory: 'ServiceCategory',
  ServiceSubcategory: 'ServiceSubcategory',
  FoodCategory: 'FoodCategory',
  FoodSubcategory: 'FoodSubcategory',
  Product: 'Product',
  ProductVariant: 'ProductVariant',
  Service: 'Service',
  Food: 'Food',
};

// Models that may hold fixture documents (SubscriptionPlan is read-only).
const FIXTURE_MODEL_NAMES = Object.keys(MODEL_FILES).filter(
  (name) => name !== 'SubscriptionPlan'
);

function loadModels() {
  const models = {};
  for (const [name, file] of Object.entries(MODEL_FILES)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    models[name] = mongoose.models[name] || require(`../../../models/${file}`);
  }
  return models;
}

function markerFilter(key) {
  return key ? { fixtureTag: FIXTURE_TAG, fixtureKey: key } : { fixtureTag: FIXTURE_TAG };
}

async function loadExistingFixtures(models) {
  const existing = new Map();
  for (const name of FIXTURE_MODEL_NAMES) {
    const docs = await models[name].collection
      .find(markerFilter(), { projection: { _id: 1, fixtureKey: 1, email: 1 } })
      .toArray();
    for (const doc of docs) {
      existing.set(doc.fixtureKey, { model: name, _id: doc._id, email: doc.email });
    }
  }
  return existing;
}

/**
 * Build the plan. Read-only.
 * @param {object} options
 * @param {Record<string,string>} options.emails role -> email
 * @param {Record<string,string>} options.mobiles role -> E.164 mobile
 * @param {string} options.planName SubscriptionPlan name to attach
 * @param {string} [options.passwordHash] only needed for apply
 */
async function buildPlan({ emails, mobiles, planName, passwordHash, now = new Date() }) {
  const models = loadModels();
  const spec = buildFixtureSpec();
  const existing = await loadExistingFixtures(models);
  const blockers = [];

  const plan = await models.SubscriptionPlan.findOne({ name: planName })
    .select('_id name')
    .lean();
  if (!plan) {
    blockers.push({
      code: 'SUBSCRIPTION_PLAN_NOT_FOUND',
      message: `SubscriptionPlan "${planName}" was not found; the seeder does not create plans`,
    });
  }

  const ids = new Map();
  for (const entry of spec) {
    ids.set(entry.key, fixtureObjectId(entry.key));
  }

  const existingCount = spec.filter((entry) => existing.has(entry.key)).length;
  if (existingCount > 0 && existingCount < spec.length) {
    blockers.push({
      code: 'FIXTURE_SET_PARTIAL',
      message: `${existingCount} of ${spec.length} fixture documents exist (partial set); run --cleanup first, then --apply`,
    });
  }

  for (const entry of spec) {
    const found = existing.get(entry.key);
    if (found && String(found._id) !== String(ids.get(entry.key))) {
      blockers.push({
        code: 'FIXTURE_ID_MISMATCH',
        message: `${entry.key} exists with a non-deterministic id; run --cleanup first, then --apply`,
      });
    }
  }

  const ctx = {
    emails,
    mobiles,
    passwordHash,
    planId: plan ? plan._id : new mongoose.Types.ObjectId(),
    now,
    id: (key) => {
      if (!ids.has(key)) throw new Error(`Unknown fixture key: ${key}`);
      return ids.get(key);
    },
  };

  const entries = [];
  for (const entry of spec) {
    const Model = models[entry.model];
    const found = existing.get(entry.key);

    if (found) {
      if (entry.model === 'User') {
        const expected = entry.build(ctx).email;
        if (found.email !== expected) {
          blockers.push({
            code: 'FIXTURE_EMAIL_CHANGED',
            message: `${entry.key} exists with a different email; run --cleanup before re-seeding`,
          });
        }
      }
      entries.push({ key: entry.key, model: entry.model, action: 'exists', _id: found._id });
      continue;
    }

    const data = entry.build(ctx);
    const doc = new Model({ ...data, _id: ctx.id(entry.key) });
    try {
      await doc.validate();
    } catch (err) {
      blockers.push({
        code: 'FIXTURE_INVALID',
        message: `${entry.key} failed ${entry.model} validation: ${err.message}`,
      });
    }

    const unique = entry.unique(ctx);
    const clauses = Object.entries(unique)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([field, value]) => ({ [field]: value }));
    if (clauses.length > 0) {
      const clash = await Model.collection.findOne(
        { $or: clauses, fixtureTag: { $ne: FIXTURE_TAG } },
        { projection: { _id: 1 } }
      );
      if (clash) {
        blockers.push({
          code: 'NON_FIXTURE_COLLISION',
          message: `${entry.key}: a non-fixture ${entry.model} already uses one of [${Object.keys(unique).join(', ')}]`,
        });
      }
    }

    entries.push({ key: entry.key, model: entry.model, action: 'create', _id: doc._id, doc });
  }

  return { entries, blockers, planFound: Boolean(plan) };
}

function toInsertable(doc, now) {
  const obj = doc.toObject({ depopulate: true, flattenMaps: true, virtuals: false });
  if (doc.schema.options.timestamps) {
    obj.createdAt = obj.createdAt || now;
    obj.updatedAt = obj.updatedAt || now;
  }
  return obj;
}

async function applyPlan(planResult, { now = new Date() } = {}) {
  if (planResult.blockers.length > 0) {
    const error = new Error('Plan has blockers; nothing was written');
    error.blockers = planResult.blockers;
    throw error;
  }

  const models = loadModels();
  let created = 0;
  let existing = 0;

  for (const entry of planResult.entries) {
    if (entry.action !== 'create') {
      existing += 1;
      continue;
    }
    const body = toInsertable(entry.doc, now);
    const { _id, ...rest } = body;
    const result = await models[entry.model].collection.updateOne(
      markerFilter(entry.key),
      {
        $setOnInsert: {
          _id,
          ...rest,
          fixtureTag: FIXTURE_TAG,
          fixtureKey: entry.key,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount === 1) created += 1;
    else existing += 1;
  }

  return { created, existing };
}

async function countFixtures() {
  const models = loadModels();
  const counts = {};
  for (const name of FIXTURE_MODEL_NAMES) {
    counts[name] = await models[name].collection.countDocuments(markerFilter());
  }
  return counts;
}

function allFixtureIds() {
  return buildFixtureSpec().map((entry) => fixtureObjectId(entry.key));
}

function valuesAtPath(doc, dottedPath) {
  let current = [doc];
  for (const part of dottedPath.split('.')) {
    const next = [];
    for (const value of current) {
      if (value == null) continue;
      const child = value[part];
      if (Array.isArray(child)) next.push(...child);
      else if (child !== undefined) next.push(child);
    }
    current = next;
  }
  return current.filter((v) => v !== null && v !== undefined && v !== '');
}

/**
 * Classify related documents. Read-only.
 * @returns {Promise<Record<string, { deletable: ObjectId[], review: ObjectId[] }>>}
 */
async function classifyRelatedDocuments() {
  const { db } = mongoose.connection;
  const fixtureIds = allFixtureIds();
  const fixtureSet = new Set(fixtureIds.map(String));
  const isFixture = (value) => fixtureSet.has(String(value));
  const result = {};
  const deletableByCollection = {};
  const relatedByCollection = {};

  for (const rule of RELATED_COLLECTIONS) {
    const clauses = [];
    if (rule.owner) clauses.push({ [rule.owner]: { $in: fixtureIds } });
    for (const ref of rule.refs) clauses.push({ [ref]: { $in: fixtureIds } });
    if (rule.parentRef) {
      const parents = relatedByCollection[rule.parentRef.collection] || [];
      if (parents.length) clauses.push({ [rule.parentRef.path]: { $in: parents } });
    }

    const docs = await db
      .collection(rule.collection)
      .find({ $or: clauses })
      .limit(MAX_RELATED_PER_COLLECTION + 1)
      .toArray();
    if (docs.length > MAX_RELATED_PER_COLLECTION) {
      throw new FixtureSafeError(
        `more than ${MAX_RELATED_PER_COLLECTION} ${rule.collection} documents reference fixtures; refusing (nothing was deleted)`
      );
    }

    const deletable = [];
    const review = [];
    for (const doc of docs) {
      let ok = true;
      if (rule.owner) ok = isFixture(doc[rule.owner]);
      if (ok) ok = rule.refs.every((ref) => valuesAtPath(doc, ref).every(isFixture));
      if (ok && rule.childRefs) {
        const allowed = new Set((deletableByCollection[rule.childRefs.collection] || []).map(String));
        ok = valuesAtPath(doc, rule.childRefs.path).every((id) => allowed.has(String(id)));
      }
      if (ok && rule.parentRef) {
        const allowed = new Set((deletableByCollection[rule.parentRef.collection] || []).map(String));
        ok = valuesAtPath(doc, rule.parentRef.path).length > 0 &&
          valuesAtPath(doc, rule.parentRef.path).every((id) => allowed.has(String(id)));
      }
      (ok ? deletable : review).push(doc._id);
    }

    deletableByCollection[rule.collection] = deletable;
    relatedByCollection[rule.collection] = docs.map((d) => d._id);
    result[rule.collection] = { deletable, review };
  }

  return result;
}

// Aggregation expression: every value at `path` (scalar, array, or path into
// an array of subdocuments) is in `allowed`; missing, null or '' count as empty.
function allValuesInExpr(path, allowed) {
  return {
    $setIsSubset: [
      {
        $let: {
          vars: { v: { $ifNull: [`$${path}`, []] } },
          in: { $cond: [{ $isArray: '$$v' }, '$$v', ['$$v']] },
        },
      },
      [...allowed, null, ''],
    ],
  };
}

/**
 * Delete only the deletable related documents from a classification, by id,
 * re-checking the same predicate at delete time (owner, every reference,
 * cart items, refund order) so a document changed since classification is
 * not removed. Dependents are deleted before their parents.
 */
async function deleteRelatedDocuments(classification) {
  const { db } = mongoose.connection;
  const fixtureIds = allFixtureIds();
  const rules = new Map(RELATED_COLLECTIONS.map((rule) => [rule.collection, rule]));
  const deleted = {};
  for (const collection of RELATED_DELETE_ORDER) {
    const rule = rules.get(collection);
    const ids = classification[collection].deletable;
    if (ids.length === 0) {
      deleted[collection] = 0;
      continue;
    }
    const exprs = rule.refs.map((ref) => allValuesInExpr(ref, fixtureIds));
    if (rule.childRefs) {
      exprs.push(allValuesInExpr(rule.childRefs.path, classification[rule.childRefs.collection].deletable));
    }
    const filter = { _id: { $in: ids }, $expr: { $and: exprs } };
    if (rule.owner) filter[rule.owner] = { $in: fixtureIds };
    if (rule.parentRef) {
      filter[rule.parentRef.path] = { $in: classification[rule.parentRef.collection].deletable };
    }
    const res = await db.collection(collection).deleteMany(filter);
    deleted[collection] = res.deletedCount;
  }
  return deleted;
}

async function cleanupFixtures({ dryRun = false } = {}) {
  const models = loadModels();
  const deleted = {};
  for (const name of FIXTURE_MODEL_NAMES) {
    const filter = markerFilter();
    if (dryRun) {
      deleted[name] = await models[name].collection.countDocuments(filter);
    } else {
      const result = await models[name].collection.deleteMany(filter);
      deleted[name] = result.deletedCount;
    }
  }
  return deleted;
}

module.exports = {
  FIXTURE_TAG,
  RELATED_COLLECTIONS,
  RELATED_DELETE_ORDER,
  MAX_RELATED_PER_COLLECTION,
  FixtureSafeError,
  fixtureObjectId,
  classifyRelatedDocuments,
  deleteRelatedDocuments,
  FIXTURE_MODEL_NAMES,
  buildPlan,
  applyPlan,
  countFixtures,
  cleanupFixtures,
};
