const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
} = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const {
  registerAndVerify,
  login,
  createAdminDirect,
  seedApprovedBusiness,
} = require('./helpers/factories');
const User = require('../../models/User');
const Business = require('../../models/Business');

const CLEANUP_URL = '/api/admin/developer/cleanup';

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function adminAgent() {
  const { email, password } = await createAdminDirect();
  const agent = createAgent(getApp());
  const res = await login(agent, email, password);
  assert.equal(res.status, 200);
  return agent;
}

async function seedBusinesses(names) {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const owner = await User.findOne({ email: vendor.email });
  const created = [];
  for (const businessName of names) {
    created.push(
      await seedApprovedBusiness(owner, {
        businessName,
        email: `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.com`,
      })
    );
  }
  return created;
}

test('cleanup refuses missing or empty patterns (dry run and delete)', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['Contest Bakery']);

  for (const body of [
    {},
    { patterns: [] },
    { patterns: '' },
    { patterns: ['  ', ''] },
    { dryRun: false },
    { dryRun: false, patterns: [], expectedCount: 1 },
  ]) {
    const res = await agent.post(CLEANUP_URL).send(body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /pattern is required/i);
  }

  assert.equal(await Business.countDocuments({}), 1);
});

test('cleanup refuses short patterns and too many patterns', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['Contest Bakery']);

  const shortRes = await agent
    .post(CLEANUP_URL)
    .send({ patterns: ['qa-synth', 'te'], dryRun: true });
  assert.equal(shortRes.status, 400);
  assert.match(shortRes.body.message, /at least 4 characters/i);

  const manyRes = await agent.post(CLEANUP_URL).send({
    patterns: Array.from({ length: 11 }, (_, i) => `pattern-${i}`),
    dryRun: true,
  });
  assert.equal(manyRes.status, 400);
  assert.match(manyRes.body.message, /maximum of 10/i);

  assert.equal(await Business.countDocuments({}), 1);
});

test('dry run returns the matched count and deletes nothing', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha', 'qa-synth beta', 'Contest Bakery']);

  const res = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.matchedCount, 2);
  assert.equal(res.body.matched, 2);
  assert.equal(res.body.data.length, 2);
  assert.deepEqual(res.body.patterns, ['qa-synth']);

  assert.equal(await Business.countDocuments({}), 3);
});

test('delete without expectedCount is refused', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha']);

  for (const extra of [{}, { expectedCount: 'abc' }, { expectedCount: 1.5 }, { expectedCount: -1 }]) {
    const res = await agent
      .post(CLEANUP_URL)
      .send({ patterns: ['qa-synth'], dryRun: false, ...extra });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(extra)}`);
    assert.equal(res.body.code, 'EXPECTED_COUNT_REQUIRED');
  }

  assert.equal(await Business.countDocuments({}), 1);
});

test('delete with mismatched expectedCount is refused and deletes nothing', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha', 'qa-synth beta']);

  const res = await agent
    .post(CLEANUP_URL)
    .send({ patterns: ['qa-synth'], dryRun: false, expectedCount: 1 });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'EXPECTED_COUNT_MISMATCH');
  assert.equal(res.body.matchedCount, 2);
  assert.equal(res.body.expectedCount, 1);
  assert.match(res.body.message, /Nothing was deleted/);

  assert.equal(await Business.countDocuments({}), 2);
});

test('delete with matching expectedCount deletes exactly the matched set; Contest Bakery untouched', async () => {
  const agent = await adminAgent();
  const [alpha, beta, bakery] = await seedBusinesses([
    'QA-Synth Alpha',
    'qa-synth beta',
    'Contest Bakery',
  ]);

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.matchedCount, 2);

  const res = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    expectedCount: dry.body.matchedCount,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, false);
  assert.equal(res.body.deletedCount, 2);
  assert.equal(res.body.skippedCount, 0);
  assert.deepEqual(
    res.body.deleted.map((d) => String(d._id)).sort(),
    [String(alpha._id), String(beta._id)].sort()
  );

  assert.equal(await Business.findById(alpha._id), null);
  assert.equal(await Business.findById(beta._id), null);
  const remaining = await Business.findById(bakery._id);
  assert.ok(remaining, 'Contest Bakery must not be deleted');
  assert.equal(remaining.businessName, 'Contest Bakery');
});

test('list cleanupMatch requires explicit patterns and returns no default suggestions', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha', 'Contest Bakery']);

  const noPatterns = await agent.get('/api/admin/developer/businesses?cleanupMatch=true');
  assert.equal(noPatterns.status, 400);

  const matched = await agent.get(
    '/api/admin/developer/businesses?cleanupMatch=true&patterns=qa-synth'
  );
  assert.equal(matched.status, 200);
  assert.equal(matched.body.total, 1);
  assert.equal(matched.body.data[0].businessName, 'QA-Synth Alpha');
  assert.deepEqual(matched.body.defaultCleanupPatterns, []);

  const plain = await agent.get('/api/admin/developer/businesses');
  assert.equal(plain.status, 200);
  assert.equal(plain.body.total, 2);
});
