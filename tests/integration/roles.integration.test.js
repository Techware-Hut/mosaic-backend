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

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('customer can access cart; vendor receives 403 on admin orders', async () => {
  const customerAgent = createAgent(getApp());
  const { email, password } = await registerAndVerify(customerAgent, {
    role: 'customer',
  });
  await login(customerAgent, email, password);

  const cartRes = await customerAgent.get('/api/cart');
  assert.equal(cartRes.status, 200);

  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);

  const adminOrders = await vendorAgent.get('/api/orders/admin');
  assert.equal(adminOrders.status, 403);
});

test('admin can access admin orders list', async () => {
  const { email, password } = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const res = await adminAgent.get('/api/orders/admin');
  assert.equal(res.status, 200);
});

test('business_owner can access business/my scoped to own account', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);

  const user = await User.findOne({ email: vendor.email });
  await seedApprovedBusiness(user);

  const myBusiness = await vendorAgent.get('/api/business/my');
  assert.equal(myBusiness.status, 200);
  assert.ok(Array.isArray(myBusiness.body.businesses));
});

test('cross-vendor connect account-link rejects foreign businessId', async () => {
  const vendorA = createAgent(getApp());
  const vendorB = createAgent(getApp());

  const a = await registerAndVerify(vendorA, { role: 'business_owner' });
  const b = await registerAndVerify(vendorB, { role: 'business_owner' });
  await login(vendorA, a.email, a.password);
  await login(vendorB, b.email, b.password);

  const bUser = await User.findOne({ email: b.email });
  const businessB = await seedApprovedBusiness(bUser);

  const foreignLink = await vendorA.post(
    `/api/connect/${businessB._id}/account-link`
  );
  assert.equal(foreignLink.status, 403);
});
