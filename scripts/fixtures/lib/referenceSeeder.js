'use strict';

/**
 * Plan / apply for synthetic staging reference data.
 *
 * Every document this seeder writes carries `fixtureTag` (REFERENCE_TAG) and
 * `fixtureKey` (the stable "<kind>:<slug>" key). The app schemas do not
 * declare these fields, so writes go through the native collection after the
 * document has been validated against its Mongoose model (same approach as
 * the fixture seeder). The tag differs from the fixture tag, so the fixture
 * seeder's --cleanup never removes reference data.
 *
 * - plan:  read-only. For each entry: "exists" (a reference document with the
 *          key is present), "skip" (a document NOT created by this seeder
 *          already uses the entry's unique name/slug; it is left untouched),
 *          "skip-parent" (the parent category was skipped) or "create".
 * - apply: $setOnInsert upsert keyed on { fixtureTag, fixtureKey }. Existing
 *          documents are never modified and nothing is ever deleted, so a
 *          second apply is a no-op.
 */

const mongoose = require('mongoose');
const { REFERENCE_TAG, UNIQUE_FIELDS, buildReferenceSpec } = require('./referenceSpec');

const MODEL_FILES = {
  SubscriptionPlan: 'SubscriptionPlan',
  ProductCategory: 'ProductCategory',
  ProductSubcategory: 'ProductSubcategory',
  ServiceCategory: 'ServiceCategory',
  ServiceSubcategory: 'ServiceSubcategory',
  FoodCategory: 'FoodCategory',
  FoodSubcategory: 'FoodSubcategory',
  MinorityType: 'MinorityType',
};

const REFERENCE_MODEL_NAMES = Object.keys(MODEL_FILES);

function loadModels() {
  const models = {};
  for (const [name, file] of Object.entries(MODEL_FILES)) {
    // MinorityType calls mongoose.model() unguarded, so reuse a registered model.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    models[name] = mongoose.models[name] || require(`../../../models/${file}`);
  }
  return models;
}

function markerFilter(key) {
  return key ? { fixtureTag: REFERENCE_TAG, fixtureKey: key } : { fixtureTag: REFERENCE_TAG };
}

/**
 * Build the plan. Read-only.
 * @returns {Promise<{ entries: object[], blockers: object[] }>}
 */
async function buildReferencePlan() {
  const models = loadModels();
  const spec = buildReferenceSpec();
  const blockers = [];
  const entries = [];
  const resolved = new Map(); // key -> { action, _id }

  for (const entry of spec) {
    const Model = models[entry.model];

    const found = await Model.collection.findOne(markerFilter(entry.key), {
      projection: { _id: 1 },
    });
    if (found) {
      resolved.set(entry.key, { action: 'exists', _id: found._id });
      entries.push({ key: entry.key, model: entry.model, action: 'exists', _id: found._id });
      continue;
    }

    if (entry.parentKey) {
      const parent = resolved.get(entry.parentKey);
      if (!parent || parent.action === 'skip' || parent.action === 'skip-parent') {
        resolved.set(entry.key, { action: 'skip-parent' });
        entries.push({
          key: entry.key,
          model: entry.model,
          action: 'skip-parent',
          reason: `parent ${entry.parentKey} was skipped`,
        });
        continue;
      }
    }

    const clauses = (UNIQUE_FIELDS[entry.model] || [])
      .filter((field) => entry.data[field] !== undefined && entry.data[field] !== '')
      .map((field) => ({ [field]: entry.data[field] }));
    if (clauses.length > 0) {
      const clash = await Model.collection.findOne(
        { $or: clauses, fixtureTag: { $ne: REFERENCE_TAG } },
        { projection: { _id: 1 } }
      );
      if (clash) {
        resolved.set(entry.key, { action: 'skip' });
        entries.push({
          key: entry.key,
          model: entry.model,
          action: 'skip',
          reason: `an existing ${entry.model} not created by this seeder uses its ${clauses
            .map((c) => Object.keys(c)[0])
            .join('/')}; left untouched`,
        });
        continue;
      }
    }

    const data = { ...entry.data };
    if (entry.parentKey) data[entry.parentField] = resolved.get(entry.parentKey)._id;
    const doc = new Model(data);
    try {
      await doc.validate();
    } catch (err) {
      blockers.push({
        code: 'REFERENCE_INVALID',
        message: `${entry.key} failed ${entry.model} validation: ${err.message}`,
      });
    }

    resolved.set(entry.key, { action: 'create', _id: doc._id });
    entries.push({ key: entry.key, model: entry.model, action: 'create', _id: doc._id, doc });
  }

  return { entries, blockers };
}

function toInsertable(doc, now) {
  const obj = doc.toObject({ depopulate: true, flattenMaps: true, virtuals: false });
  if (doc.schema.options.timestamps) {
    obj.createdAt = obj.createdAt || now;
    obj.updatedAt = obj.updatedAt || now;
  }
  return obj;
}

/**
 * Insert the "create" entries of a plan. Never updates or deletes.
 * @returns {Promise<{ created: number, existing: number, skipped: number }>}
 */
async function applyReferencePlan(plan, { now = new Date() } = {}) {
  if (plan.blockers.length > 0) {
    const error = new Error('Plan has blockers; nothing was written');
    error.blockers = plan.blockers;
    throw error;
  }

  const models = loadModels();
  let created = 0;
  let existing = 0;
  let skipped = 0;

  for (const entry of plan.entries) {
    if (entry.action === 'exists') {
      existing += 1;
      continue;
    }
    if (entry.action !== 'create') {
      skipped += 1;
      continue;
    }
    const { _id, ...rest } = toInsertable(entry.doc, now);
    try {
      const result = await models[entry.model].collection.updateOne(
        markerFilter(entry.key),
        { $setOnInsert: { _id, ...rest, fixtureTag: REFERENCE_TAG, fixtureKey: entry.key } },
        { upsert: true }
      );
      if (result.upsertedCount === 1) created += 1;
      else existing += 1;
    } catch (err) {
      // A unique index rejected the insert: something else took the name/slug
      // after planning. Leave it alone.
      if (err && err.code === 11000) skipped += 1;
      else throw err;
    }
  }

  return { created, existing, skipped };
}

/** Count reference documents (by marker) per model. Read-only. */
async function countReferenceDocs() {
  const models = loadModels();
  const counts = {};
  for (const name of REFERENCE_MODEL_NAMES) {
    counts[name] = await models[name].collection.countDocuments(markerFilter());
  }
  return counts;
}

module.exports = {
  REFERENCE_TAG,
  REFERENCE_MODEL_NAMES,
  loadModels,
  buildReferencePlan,
  applyReferencePlan,
  countReferenceDocs,
};
