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

test('authenticated customer receives cart payload', async () => {
  const agent = createAgent(getApp());
  const customer = await registerAndVerify(agent, { role: 'customer' });
  await login(agent, customer.email, customer.password);

  const res = await agent.get('/api/cart');
  assert.equal(res.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(res.body, 'cart'));
});

test('order initiate rejects empty cart for customer', async () => {
  const agent = createAgent(getApp());
  const customer = await registerAndVerify(agent, { role: 'customer' });
  await login(agent, customer.email, customer.password);

  const res = await agent.post('/api/orders/initiate').send({
    shippingAddress: {
      fullName: 'Test Customer',
      phone: '5555550100',
      addressLine1: '123 Main St',
      city: 'Atlanta',
      state: 'GA',
      country: 'USA',
      postalCode: '30301',
    },
  });

  assert.notEqual(res.status, 200);
});

test('vendor cannot initiate customer checkout order', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const res = await agent.post('/api/orders/initiate').send({});
  assert.equal(res.status, 403);
});

test('admin can list orders; vendor can list vendor orders endpoint', async () => {
  const { email, password } = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const adminOrders = await adminAgent.get('/api/orders/admin');
  assert.equal(adminOrders.status, 200);

  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);
  const user = await User.findOne({ email: vendor.email });
  await seedApprovedBusiness(user);

  const vendorOrders = await vendorAgent.get('/api/orders/vendor');
  assert.equal(vendorOrders.status, 200);
});
