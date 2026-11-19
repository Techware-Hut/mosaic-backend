const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { GuardError, assertPreconditions } = require('../../scripts/fixtures/lib/guards');
const { main, parseArgs } = require('../../scripts/fixtures/seed-reference-data');
const {
  REFERENCE_TAG,
  STRIPE_PLACEHOLDER_PREFIX,
  UNIQUE_FIELDS,
  buildReferenceSpec,
} = require('../../scripts/fixtures/lib/referenceSpec');
const { loadModels, REFERENCE_MODEL_NAMES } = require('../../scripts/fixtures/lib/referenceSeeder');
const { FIXTURE_TAG } = require('../../scripts/fixtures/lib/fixtureSpec');

const SECRET = 'n0t-a-real-pass';

function goodEnv(overrides = {}) {
  return {
    RELEASE_ENVIRONMENT: 'staging',
    FIXTURE_SEED_CONFIRM: 'synthetic-staging',
    MONGODB_URI: `mongodb+srv://qa_user:${SECRET}@cluster0.example.test/mbh_reference_staging?retryWrites=true`,
    FIXTURE_ALLOWED_DB_HOSTS: 'cluster0.example.test',
    FIXTURE_ALLOWED_DB_NAMES: 'mbh_reference_staging',
    ...overrides,
  };
}

function capture() {
  const lines = [];
  const sink = (line) => lines.push(String(line));
  return { lines, log: sink, error: sink, text: () => lines.join('\n') };
}

async function runMain(argv, env) {
  const io = capture();
  const code = await main({ argv, env, log: io.log, error: io.error });
  return { code, output: io.text() };
}

// --- guards -------------------------------------------------------------

const REFUSALS = [
  ['RELEASE_ENVIRONMENT unset', { RELEASE_ENVIRONMENT: undefined }, 'RELEASE_ENVIRONMENT'],
  ['RELEASE_ENVIRONMENT=production', { RELEASE_ENVIRONMENT: 'production' }, 'RELEASE_ENVIRONMENT'],
  ['RELEASE_ENVIRONMENT=Staging (case)', { RELEASE_ENVIRONMENT: 'Staging' }, 'RELEASE_ENVIRONMENT'],
  ['confirm token missing', { FIXTURE_SEED_CONFIRM: undefined }, 'FIXTURE_SEED_CONFIRM'],
  ['confirm token wrong', { FIXTURE_SEED_CONFIRM: 'yes' }, 'FIXTURE_SEED_CONFIRM'],
  ['MONGODB_URI unset', { MONGODB_URI: undefined }, 'MONGODB_URI'],
  ['host allowlist unset', { FIXTURE_ALLOWED_DB_HOSTS: undefined }, 'DB_HOST_ALLOWLIST'],
  ['host not allowlisted', { FIXTURE_ALLOWED_DB_HOSTS: 'other.example.test' }, 'DB_HOST_NOT_ALLOWED'],
  ['db name allowlist unset', { FIXTURE_ALLOWED_DB_NAMES: undefined }, 'DB_NAME_ALLOWLIST'],
  ['db name not allowlisted', { FIXTURE_ALLOWED_DB_NAMES: 'mbh_other' }, 'DB_NAME_NOT_ALLOWED'],
  [
    'db name is the production database, even when allowlisted',
    {
      MONGODB_URI: `mongodb+srv://qa_user:${SECRET}@cluster0.example.test/mosaic?retryWrites=true`,
      FIXTURE_ALLOWED_DB_NAMES: 'mosaic,mbh_reference_staging',
    },
    'DB_NAME_PRODUCTION',
  ],
  [
    'db name does not end with _staging, even when allowlisted',
    {
      MONGODB_URI: `mongodb+srv://qa_user:${SECRET}@cluster0.example.test/foo?retryWrites=true`,
      FIXTURE_ALLOWED_DB_NAMES: 'foo',
    },
    'DB_NAME_NOT_STAGING',
  ],
  [
    'URI without database name',
    { MONGODB_URI: `mongodb+srv://qa_user:${SECRET}@cluster0.example.test/?retryWrites=true` },
    'DB_NAME_REFUSED',
  ],
];

for (const [label, overrides, code] of REFUSALS) {
  test(`reference seeder refuses (exit 2, no connection) when ${label}`, async () => {
    const env = goodEnv(overrides);
    for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete env[k];

    for (const argv of [[], ['--apply']]) {
      const { code: exit, output } = await runMain(argv, env);
      assert.equal(exit, 2);
      assert.match(output, new RegExp(`\\[${code}\\]`));
      assert.ok(!output.includes(SECRET), 'credentials must never be printed');
      assert.ok(!output.includes('qa_user'), 'username must never be printed');
      assert.equal(mongoose.connection.readyState, 0, 'must not connect when refusing');
    }
  });
}

test('only an explicit requireMailAllowlist=false skips the mail allowlist; other falsy values still require it', () => {
  const env = goodEnv({ MAIL_RECIPIENT_ALLOWLIST: undefined });
  delete env.MAIL_RECIPIENT_ALLOWLIST;
  for (const value of [null, 0, '', undefined, 'false']) {
    assert.throws(
      () => assertPreconditions({ env, emails: {}, requireMailAllowlist: value }),
      (err) =>
        err instanceof GuardError &&
        err.failures.map((f) => f.code).includes('MAIL_ALLOWLIST_UNSET'),
      `requireMailAllowlist=${JSON.stringify(value)} must still require the allowlist`
    );
  }
  const target = assertPreconditions({ env, emails: {}, requireMailAllowlist: false });
  assert.equal(target.dbName, 'mbh_reference_staging');
});

test('reference seeder does not require MAIL_RECIPIENT_ALLOWLIST; fixture seeder guard still does', () => {
  const env = goodEnv();
  const target = assertPreconditions({ env, emails: {}, requireMailAllowlist: false });
  assert.deepEqual(target, { hosts: ['cluster0.example.test'], dbName: 'mbh_reference_staging' });

  assert.throws(
    () => assertPreconditions({ env, emails: {} }),
    (err) => err instanceof GuardError && err.failures.some((f) => f.code === 'MAIL_ALLOWLIST_UNSET')
  );
});

test('parseArgs defaults to dry-run and rejects unknown or conflicting flags', () => {
  assert.equal(parseArgs([]).mode, 'dry-run');
  assert.equal(parseArgs(['--dry-run']).mode, 'dry-run');
  assert.equal(parseArgs(['--apply']).mode, 'apply');
  assert.throws(() => parseArgs(['--apply', '--dry-run']));
  assert.throws(() => parseArgs(['--cleanup']));
  assert.throws(() => parseArgs(['--force']));
});

test('usage errors exit 2 before any guard or connection', async () => {
  const { code, output } = await runMain(['--bogus'], goodEnv());
  assert.equal(code, 2);
  assert.match(output, /Unknown argument/);
  assert.equal(mongoose.connection.readyState, 0);
});

// --- spec ---------------------------------------------------------------

test('reference tag is distinct from the fixture tag (fixture cleanup never removes reference data)', () => {
  assert.notEqual(REFERENCE_TAG, FIXTURE_TAG);
});

test('spec keys are unique and stable "<kind>:<slug>" and parents precede children', () => {
  const spec = buildReferenceSpec();
  const keys = spec.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[a-z-]+:[a-z0-9-]+$/);
  const seen = new Set();
  for (const entry of spec) {
    if (entry.parentKey) assert.ok(seen.has(entry.parentKey), `${entry.key} before its parent`);
    seen.add(entry.key);
  }
  assert.deepEqual(buildReferenceSpec().map((e) => e.key), keys, 'spec is deterministic');
});

test('unique fields (name/slug/stripePriceId) do not repeat within a model', () => {
  const spec = buildReferenceSpec();
  for (const [model, fields] of Object.entries(UNIQUE_FIELDS)) {
    for (const field of fields) {
      const values = spec.filter((e) => e.model === model).map((e) => e.data[field]);
      assert.equal(new Set(values).size, values.length, `${model}.${field} repeats`);
    }
  }
});

test('subscription plans: every tier the schema enum allows, Launch Plan included, fake Stripe ids', () => {
  const { SubscriptionPlan } = loadModels();
  const plans = buildReferenceSpec().filter((e) => e.model === 'SubscriptionPlan');
  const enumValues = SubscriptionPlan.schema.path('name').enumValues;
  assert.deepEqual(plans.map((p) => p.data.name).sort(), [...enumValues].sort());
  assert.ok(plans.some((p) => p.data.name === 'Launch Plan'));
  for (const plan of plans) {
    assert.ok(plan.data.stripePriceId.startsWith(`price_${STRIPE_PLACEHOLDER_PREFIX}`));
    assert.ok(plan.data.stripeProductId.startsWith(`prod_${STRIPE_PLACEHOLDER_PREFIX}`));
    for (const value of Object.values(plan.data.limits)) assert.ok(Number.isInteger(value) && value >= 0);
  }
});

test('every seeded document validates against its Mongoose schema', async () => {
  const models = loadModels();
  const spec = buildReferenceSpec();
  const ids = new Map();
  const seenModels = new Set();
  for (const entry of spec) {
    const data = { ...entry.data };
    if (entry.parentKey) data[entry.parentField] = ids.get(entry.parentKey);
    const doc = new models[entry.model](data);
    ids.set(entry.key, doc._id);
    seenModels.add(entry.model);
    await doc.validate();

    // No field is silently dropped by strict mode.
    const kept = doc.toObject();
    for (const field of Object.keys(entry.data)) {
      assert.notEqual(kept[field], undefined, `${entry.key}: ${field} is not in the ${entry.model} schema`);
    }
    if (entry.data.slug) assert.equal(kept.slug, entry.data.slug);
  }
  assert.deepEqual([...seenModels].sort(), [...REFERENCE_MODEL_NAMES].sort());
});

test('category entries stay publicly visible under the category visibility rules', () => {
  const models = loadModels();
  for (const entry of buildReferenceSpec().filter((e) => /Category$/.test(e.model))) {
    const doc = new models[entry.model](entry.data);
    assert.equal(doc.status, 'active');
    assert.equal(doc.isActive, true);
    assert.equal(doc.isDeleted, false);
  }
});
