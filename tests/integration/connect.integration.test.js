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
} = require('./helpers/factories');
const User = require('../../models/User');
const {
  setStripeShouldFail,
  resetStripeStub,
} = require('./helpers/providerStubs');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  resetStripeStub();
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('connect account-link returns onboarding URL contract', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    stripeConnectAccountId: null,
  });

  const res = await agent.post(`/api/connect/${business._id}/account-link`);
  assert.equal(res.status, 200);
  assert.match(res.body.url, /connect\.stripe\.com/);
});

test('connect status returns capability summary', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);

  const res = await agent.get(`/api/connect/${business._id}/status`);
  assert.equal(res.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(res.body, 'chargesEnabled'));
});

test('connect account-link surfaces provider failure without live Stripe', async () => {
  setStripeShouldFail(true);

  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    stripeConnectAccountId: null,
  });

  const res = await agent.post(`/api/connect/${business._id}/account-link`);
  assert.notEqual(res.status, 200);
});
