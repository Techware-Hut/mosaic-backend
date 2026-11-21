const test = require('node:test');
const assert = require('node:assert/strict');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, seedApprovedBusiness } = require('./helpers/factories');
const User = require('../../models/User');
const Subscription = require('../../models/Subscription');
const { createBusiness } = require('../../controllers/businessController');

test.before(startHarness);
test.afterEach(resetDatabase);
test.after(stopHarness);

test('createBusiness detects a literal punctuation name against real Mongo records', async () => {
  const vendor = await registerAndVerify(createAgent(getApp()), { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, { businessName: 'C++ Caf\u00e9' });
  const subscription = await Subscription.findById(business.subscriptionId);
  const req = { user, body: {
    businessName: 'c++ caf\u00e9',
    subscriptionPlanId: business.subscriptionPlanId,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    paymentStatus: 'COMPLETED',
  } };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await createBusiness(req, res);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.match(res.body.message, /Business name already exists/);
});
