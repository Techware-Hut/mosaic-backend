const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { main } = require('../../scripts/fixtures/seed-reference-data');
const { main: fixtureMain } = require('../../scripts/fixtures/seed-synthetic-staging');
const {
  REFERENCE_TAG,
  REFERENCE_MODEL_NAMES,
  loadModels,
} = require('../../scripts/fixtures/lib/referenceSeeder');
const { buildReferenceSpec } = require('../../scripts/fixtures/lib/referenceSpec');

const EXPECTED_COUNTS = {
  SubscriptionPlan: 3,
  ProductCategory: 4,
  ProductSubcategory: 8,
  ServiceCategory: 4,
  ServiceSubcategory: 8,
  FoodCategory: 4,
  FoodSubcategory: 8,
  MinorityType: 8,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0);

let mongoServer;
let baseUri;

function envFor(dbName, overrides = {}) {
  return {
    RELEASE_ENVIRONMENT: 'staging',
    FIXTURE_SEED_CONFIRM: 'synthetic-staging',
    MONGODB_URI: `${baseUri}${dbName}`,
    FIXTURE_ALLOWED_DB_HOSTS: '127.0.0.1',
    FIXTURE_ALLOWED_DB_NAMES: dbName,
    ...overrides,
  };
}

async function run(argv, env, entry = main) {
  const lines = [];
  const sink = (line) => lines.push(String(line));
  const code = await entry({ argv, env, log: sink, error: sink });
  return { code, output: lines.join('\n') };
}

async function withDb(dbName, fn) {
  const conn = await mongoose.createConnection(`${baseUri}${dbName}`).asPromise();
  try {
    return await fn(conn.db);
  } finally {
    await conn.close();
  }
}

const collectionOf = (name) => loadModels()[name].collection.collectionName;

async function countsBy(dbName, filter) {
  return withDb(dbName, async (db) => {
    const counts = {};
    for (const name of REFERENCE_MODEL_NAMES) {
      counts[name] = await db.collection(collectionOf(name)).countDocuments(filter);
    }
    return counts;
  });
}

async function totalDocuments(dbName) {
  return withDb(dbName, async (db) => {
    let total = 0;
    for (const info of await db.listCollections().toArray()) {
      total += await db.collection(info.name).countDocuments({});
    }
    return total;
  });
}

describe('synthetic reference data seeder (in-memory Mongo)', () => {
  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    baseUri = mongoServer.getUri().replace(/\/?$/, '/');
    loadModels(); // register the models so collection names resolve
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('dry-run on an empty database plans every entry and writes nothing', async () => {
    const db = 'mbh_ref_dry_staging';
    const { code, output } = await run([], envFor(db));
    assert.equal(code, 0, output);
    assert.match(output, new RegExp(`Summary: ${EXPECTED_TOTAL} to create, 0 already present, 0 skipped`));
    assert.match(output, /Dry run: nothing was written/);
    assert.equal(await totalDocuments(db), 0);
    assert.deepEqual(
      await withDb(db, async (d) => (await d.listCollections().toArray()).length),
      0,
      'dry-run must not create collections'
    );
    assert.equal(mongoose.connection.readyState, 0, 'disconnects after the run');
  });

  it('apply is idempotent: second run creates nothing and counts are unchanged', async () => {
    const db = 'mbh_ref_apply_staging';
    const first = await run(['--apply'], envFor(db));
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, new RegExp(`Applied: ${EXPECTED_TOTAL} created, 0 already present, 0 skipped`));
    const afterFirst = await countsBy(db, { fixtureTag: REFERENCE_TAG });
    assert.deepEqual(afterFirst, EXPECTED_COUNTS);

    const second = await run(['--apply'], envFor(db));
    assert.equal(second.code, 0, second.output);
    assert.match(second.output, new RegExp(`Applied: 0 created, ${EXPECTED_TOTAL} already present, 0 skipped`));
    assert.deepEqual(await countsBy(db, { fixtureTag: REFERENCE_TAG }), afterFirst);
    assert.equal(await totalDocuments(db), EXPECTED_TOTAL);

    const dry = await run([], envFor(db));
    assert.match(dry.output, new RegExp(`Summary: 0 to create, ${EXPECTED_TOTAL} already present`));
  });

  it('every stored document validates against its schema, is tagged, and subcategories point at seeded parents', async () => {
    const db = 'mbh_ref_apply_staging';
    const models = loadModels();
    const spec = buildReferenceSpec();
    await withDb(db, async (d) => {
      const idsByKey = new Map();
      for (const entry of spec) {
        const stored = await d.collection(collectionOf(entry.model)).findOne({ fixtureKey: entry.key });
        assert.ok(stored, `${entry.key} missing`);
        assert.equal(stored.fixtureTag, REFERENCE_TAG);
        assert.ok(stored.createdAt instanceof Date && stored.updatedAt instanceof Date);
        idsByKey.set(entry.key, stored._id);
        if (entry.parentKey) {
          assert.equal(String(stored[entry.parentField]), String(idsByKey.get(entry.parentKey)));
        }
        const { fixtureTag, fixtureKey, ...fields } = stored;
        await new models[entry.model](fields).validate();
      }
    });
  });

  it('never overwrites a modified reference document', async () => {
    const db = 'mbh_ref_apply_staging';
    await withDb(db, (d) =>
      d.collection(collectionOf('SubscriptionPlan')).updateOne(
        { fixtureKey: 'subscription-plan:launch-plan' },
        { $set: { price: 12345 } }
      )
    );
    const { code } = await run(['--apply'], envFor(db));
    assert.equal(code, 0);
    const plan = await withDb(db, (d) =>
      d.collection(collectionOf('SubscriptionPlan')).findOne({ fixtureKey: 'subscription-plan:launch-plan' })
    );
    assert.equal(plan.price, 12345);
  });

  it('skips (and leaves untouched) documents it did not create, plus their subcategories', async () => {
    const db = 'mbh_ref_existing_staging';
    const theirs = {
      plan: { _id: new mongoose.Types.ObjectId(), name: 'Launch Plan', price: 1, limits: {} },
      category: { _id: new mongoose.Types.ObjectId(), name: 'Home & Living', slug: 'home-living' },
      minority: { _id: new mongoose.Types.ObjectId(), name: 'Asian Americans' },
    };
    await withDb(db, async (d) => {
      await d.collection(collectionOf('SubscriptionPlan')).insertOne({ ...theirs.plan });
      await d.collection(collectionOf('ProductCategory')).insertOne({ ...theirs.category });
      await d.collection(collectionOf('MinorityType')).insertOne({ ...theirs.minority });
    });

    const dry = await run([], envFor(db));
    assert.equal(dry.code, 0, dry.output);
    assert.match(dry.output, /skip\s+SubscriptionPlan\s+subscription-plan:launch-plan/);
    assert.match(dry.output, /skip-parent\s+ProductSubcategory\s+product-subcategory:home-decor/);

    const first = await run(['--apply'], envFor(db));
    assert.equal(first.code, 0, first.output);
    // 1 plan + 1 category + 2 subcategories + 1 minority type skipped
    assert.match(first.output, new RegExp(`Applied: ${EXPECTED_TOTAL - 5} created, 0 already present, 5 skipped`));
    const second = await run(['--apply'], envFor(db));
    assert.match(second.output, new RegExp(`Applied: 0 created, ${EXPECTED_TOTAL - 5} already present, 5 skipped`));

    await withDb(db, async (d) => {
      assert.deepEqual(await d.collection(collectionOf('SubscriptionPlan')).findOne({ _id: theirs.plan._id }), theirs.plan);
      assert.deepEqual(await d.collection(collectionOf('ProductCategory')).findOne({ _id: theirs.category._id }), theirs.category);
      assert.deepEqual(await d.collection(collectionOf('MinorityType')).findOne({ _id: theirs.minority._id }), theirs.minority);
      assert.equal(await d.collection(collectionOf('SubscriptionPlan')).countDocuments({ name: 'Launch Plan' }), 1);
    });
  });

  it('refuses before connecting when the database name is not allowlisted', async () => {
    const db = 'mbh_ref_refused_staging';
    const { code, output } = await run(['--apply'], envFor(db, { FIXTURE_ALLOWED_DB_NAMES: 'mbh_other' }));
    assert.equal(code, 2);
    assert.match(output, /DB_NAME_NOT_ALLOWED/);
    assert.equal(await totalDocuments(db), 0);
  });

  it('unblocks the fixture seeder: after reference apply its dry-run finds the Launch Plan', async () => {
    const db = 'mbh_ref_then_fixtures_staging';
    const fixtureEnv = envFor(db, {
      MAIL_RECIPIENT_ALLOWLIST: '@example.test',
      FIXTURE_EMAIL_BUYER: 'qa+buyer@example.test',
      FIXTURE_EMAIL_VENDOR_A: 'qa+vendor-a@example.test',
      FIXTURE_EMAIL_VENDOR_B: 'qa+vendor-b@example.test',
      FIXTURE_EMAIL_ADMIN: 'qa+admin@example.test',
      FIXTURE_EMAIL_FOOD_VENDOR: 'qa+food@example.test',
    });

    const before = await run([], fixtureEnv, fixtureMain);
    assert.match(before.output, /SUBSCRIPTION_PLAN_NOT_FOUND/);

    const ref = await run(['--apply'], envFor(db));
    assert.equal(ref.code, 0, ref.output);

    const afterRef = await run([], fixtureEnv, fixtureMain);
    assert.equal(afterRef.code, 0, afterRef.output);
    assert.doesNotMatch(afterRef.output, /SUBSCRIPTION_PLAN_NOT_FOUND/);
  });
});
