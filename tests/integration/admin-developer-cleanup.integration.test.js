const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
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
const LIST_URL = '/api/admin/developer/businesses';

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

function emailFor(name) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.com`;
}

async function seedBusinesses(names) {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const owner = await User.findOne({ email: vendor.email });
  const created = [];
  for (const businessName of names) {
    created.push(
      await seedApprovedBusiness(owner, { businessName, email: emailFor(businessName) })
    );
  }
  return created;
}

let fillerSeq = 0;
/** Bulk-insert unrelated businesses so cleanup matches stay under the 25% share limit. */
async function seedBulk(count, prefix = 'Neighborhood Shop') {
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    fillerSeq += 1;
    const businessName = `${prefix} ${fillerSeq}`;
    docs.push({
      owner: new mongoose.Types.ObjectId(),
      businessName,
      slug: `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fillerSeq}-${Date.now()}`,
      email: emailFor(businessName),
      listingType: 'product',
      subscriptionId: new mongoose.Types.ObjectId(),
      subscriptionPlanId: new mongoose.Types.ObjectId(),
    });
  }
  return Business.insertMany(docs);
}

function tokenFor(ids) {
  return crypto
    .createHash('sha256')
    .update(ids.map(String).sort().join(','))
    .digest('hex');
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
    { dryRun: false, patterns: [], expectedCount: 1, matchToken: 'x' },
  ]) {
    const res = await agent.post(CLEANUP_URL).send(body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'PATTERNS_REQUIRED');
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

test('cleanup refuses email/domain-like patterns', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['Contest Bakery']);

  for (const pattern of ['@example', 'example.com', '.com', 'gmail', 'Yahoo', 'outlook', 'hotmail.co']) {
    const res = await agent.post(CLEANUP_URL).send({ patterns: [pattern], dryRun: true });
    assert.equal(res.status, 400, `expected 400 for ${pattern}`);
    assert.equal(res.body.code, 'PATTERN_EMAIL_LIKE');
  }

  const listRes = await agent.get(`${LIST_URL}?cleanupMatch=true&patterns=gmail`);
  assert.equal(listRes.status, 400);
  assert.equal(listRes.body.code, 'PATTERN_EMAIL_LIKE');

  assert.equal(await Business.countDocuments({}), 1);
});

test('cleanup refuses patterns matching more than 25% of businesses (above 10 matches)', async () => {
  const agent = await adminAgent();
  await seedBulk(11, 'QA-Synth Bulk');
  await seedBulk(30); // 11 of 41 = 26.8%

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(dry.status, 400);
  assert.equal(dry.body.code, 'PATTERN_TOO_BROAD');
  assert.equal(dry.body.matchedCount, 11);
  assert.equal(dry.body.totalBusinesses, 41);

  const del = await agent
    .post(CLEANUP_URL)
    .send({ patterns: ['qa-synth'], dryRun: false, matchToken: 'x', expectedCount: 11 });
  assert.equal(del.status, 400);
  assert.equal(del.body.code, 'PATTERN_TOO_BROAD');

  await seedBulk(3); // 11 of 44 = 25% -> allowed
  const ok = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.matchedCount, 11);

  assert.equal(await Business.countDocuments({}), 44);
});

test('small databases: 3 matches out of 5 businesses is allowed', async () => {
  const agent = await adminAgent();
  const matches = await seedBusinesses(['QA-Synth One', 'QA-Synth Two', 'QA-Synth Three']);
  await seedBulk(2); // 3 of 5 = 60%, but only 3 matches

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.matchedCount, 3);

  const res = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    matchToken: dry.body.matchToken,
    expectedCount: 3,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.deletedCount, 3);
  for (const m of matches) assert.equal(await Business.findById(m._id), null);
  assert.equal(await Business.countDocuments({}), 2);
});

test('dry run returns count, sorted ids and match token, and deletes nothing', async () => {
  const agent = await adminAgent();
  const [alpha, beta] = await seedBusinesses(['QA-Synth Alpha', 'qa-synth beta', 'Contest Bakery']);
  await seedBulk(6);

  const res = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.matchedCount, 2);
  assert.equal(res.body.matched, 2);
  assert.equal(res.body.data.length, 2);
  assert.deepEqual(res.body.patterns, ['qa-synth']);
  const expectedIds = [String(alpha._id), String(beta._id)].sort();
  assert.deepEqual(res.body.matchedIds, expectedIds);
  assert.equal(res.body.matchToken, tokenFor(expectedIds));
  assert.equal(res.body.exceedsBatchLimit, false);

  assert.equal(await Business.countDocuments({}), 9);
});

test('regex special characters in patterns are matched literally', async () => {
  const agent = await adminAgent();
  const [dotted] = await seedBusinesses(['Shop qa.s Literal', 'Shop qaXs Wildcard']);
  await seedBulk(6);

  const res = await agent.post(CLEANUP_URL).send({ patterns: ['qa.s'], dryRun: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.matchedCount, 1);
  assert.deepEqual(res.body.matchedIds, [String(dotted._id)]);
});

test('delete without matchToken or with missing/invalid expectedCount is refused', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha']);
  await seedBulk(4);

  const noToken = await agent
    .post(CLEANUP_URL)
    .send({ patterns: ['qa-synth'], dryRun: false, expectedCount: 1 });
  assert.equal(noToken.status, 400);
  assert.equal(noToken.body.code, 'MATCH_TOKEN_REQUIRED');

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  const missing = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    matchToken: dry.body.matchToken,
  });
  assert.equal(missing.status, 400, 'expected 400 when expectedCount is omitted');
  assert.equal(missing.body.code, 'EXPECTED_COUNT_REQUIRED');

  for (const expectedCount of [null, '', '  ', 'abc', 1.5, '1.5', -1, true, [1], { n: 1 }]) {
    const res = await agent.post(CLEANUP_URL).send({
      patterns: ['qa-synth'],
      dryRun: false,
      matchToken: dry.body.matchToken,
      expectedCount,
    });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(expectedCount)}`);
    assert.equal(res.body.code, 'EXPECTED_COUNT_REQUIRED');
  }

  assert.equal(await Business.countDocuments({}), 5);
});

test('delete with mismatched expectedCount is refused and deletes nothing', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha', 'qa-synth beta']);
  await seedBulk(6);

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  const res = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    matchToken: dry.body.matchToken,
    expectedCount: 1,
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'EXPECTED_COUNT_MISMATCH');
  assert.equal(res.body.matchedCount, 2);
  assert.equal(res.body.expectedCount, 1);
  assert.match(res.body.message, /Nothing was deleted/);

  assert.equal(await Business.countDocuments({}), 8);
});

test('swap race: same count but different matched set is refused with 409', async () => {
  const agent = await adminAgent();
  const [alpha, beta] = await seedBusinesses(['QA-Synth Alpha', 'qa-synth beta']);
  await seedBulk(10);

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.matchedCount, 2);

  // A stops matching, C starts matching: count is still 2, but the set differs.
  await Business.updateOne(
    { _id: alpha._id },
    { $set: { businessName: 'Renamed Real Shop', email: 'renamed-real-shop@example.com' } }
  );
  const [gamma] = await seedBusinesses(['QA-Synth Gamma']);

  const res = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    matchToken: dry.body.matchToken,
    expectedCount: dry.body.matchedCount,
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'MATCH_SET_CHANGED');

  assert.ok(await Business.findById(alpha._id));
  assert.ok(await Business.findById(beta._id));
  assert.ok(await Business.findById(gamma._id));
});

test('delete with matching token deletes exactly the matched set; Contest Bakery untouched', async () => {
  const agent = await adminAgent();
  const [alpha, beta, bakery] = await seedBusinesses([
    'QA-Synth Alpha',
    'qa-synth beta',
    'Contest Bakery',
  ]);
  const filler = await seedBulk(6);

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.matchedCount, 2);

  const res = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    matchToken: dry.body.matchToken,
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
  assert.equal(await Business.countDocuments({}), 1 + filler.length);
});

test('more than 200 matches: dry run reports it without a token and delete is refused', async () => {
  const agent = await adminAgent();
  await seedBulk(201, 'QA-Synth Bulk');
  await seedBulk(700);

  const dry = await agent.post(CLEANUP_URL).send({ patterns: ['qa-synth'], dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.matchedCount, 201);
  assert.equal(dry.body.data.length, 200);
  assert.equal(dry.body.exceedsBatchLimit, true);
  assert.equal(dry.body.matchToken, null);

  const res = await agent.post(CLEANUP_URL).send({
    patterns: ['qa-synth'],
    dryRun: false,
    matchToken: 'anything',
    expectedCount: 201,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TOO_MANY_MATCHES');

  assert.equal(await Business.countDocuments({}), 901);
});

test('list cleanupMatch requires explicit valid patterns and combines with search', async () => {
  const agent = await adminAgent();
  await seedBusinesses(['QA-Synth Alpha', 'QA-Synth Bravo', 'Contest Bakery']);

  const noPatterns = await agent.get(`${LIST_URL}?cleanupMatch=true`);
  assert.equal(noPatterns.status, 400);
  assert.equal(noPatterns.body.code, 'PATTERNS_REQUIRED');

  const shortPattern = await agent.get(`${LIST_URL}?cleanupMatch=true&patterns=qa`);
  assert.equal(shortPattern.status, 400);
  assert.equal(shortPattern.body.code, 'INVALID_PATTERNS');

  const matched = await agent.get(`${LIST_URL}?cleanupMatch=true&patterns=qa-synth`);
  assert.equal(matched.status, 200);
  assert.equal(matched.body.total, 2);
  assert.deepEqual(matched.body.defaultCleanupPatterns, []);

  const combined = await agent.get(
    `${LIST_URL}?cleanupMatch=true&patterns=qa-synth&search=bravo`
  );
  assert.equal(combined.status, 200);
  assert.equal(combined.body.total, 1);
  assert.equal(combined.body.data[0].businessName, 'QA-Synth Bravo');

  const plain = await agent.get(LIST_URL);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.total, 3);
});
