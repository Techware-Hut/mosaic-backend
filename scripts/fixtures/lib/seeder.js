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

const mongoose = require('mongoose');
const { FIXTURE_TAG, buildFixtureSpec } = require('./fixtureSpec');

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
    const found = existing.get(entry.key);
    ids.set(entry.key, found ? found._id : new mongoose.Types.ObjectId());
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
  FIXTURE_MODEL_NAMES,
  buildPlan,
  applyPlan,
  countFixtures,
  cleanupFixtures,
};
