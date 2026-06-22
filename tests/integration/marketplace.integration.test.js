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
  seedApprovedBusiness,
  seedPublishedProduct,
} = require('./helpers/factories');
const User = require('../../models/User');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('GET /api/featured-products returns safe empty payload', async () => {
  const agent = createAgent(getApp());
  const res = await agent.get('/api/featured-products');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.products));
});

test('GET /api/products/list returns list wrapper', async () => {
  const agent = createAgent(getApp());
  const res = await agent.get('/api/products/list');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test('GET /api/public/product/:id returns product detail when seeded', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);
  const product = await seedPublishedProduct(business, user);

  const res = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Integration Test Product');
});

test('GET /api/services/list and /api/food/list return safe empty arrays', async () => {
  const agent = createAgent(getApp());

  const services = await agent.get('/api/services/list');
  assert.equal(services.status, 200);

  const foods = await agent.get('/api/food/list');
  assert.equal(foods.status, 200);
});

test('missing product detail returns 404', async () => {
  const agent = createAgent(getApp());
  const missingId = '507f1f77bcf86cd799439011';
  const res = await agent.get(`/api/public/product/${missingId}`);
  assert.equal(res.status, 404);
});
