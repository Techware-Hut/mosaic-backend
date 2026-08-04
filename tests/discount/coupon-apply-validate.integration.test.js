const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
} = require('../integration/setup/harness');
const { createAgent } = require('../integration/helpers/client');
const {
  registerAndVerify,
  seedApprovedBusiness,
  seedDiscount,
} = require('../integration/helpers/factories');
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

test('POST /api/discounts/validate and /apply share minOrderAmount enforcement', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser);
  const discount = await seedDiscount(business, {
    couponCode: 'MIN50',
    minOrderAmount: 50,
    type: 'percentage',
    value: 10,
  });

  const agent = createAgent(getApp());

  const validateBelow = await agent.post('/api/discounts/validate').send({
    couponCode: discount.couponCode,
    businessId: business._id,
    amount: 40,
  });
  assert.equal(validateBelow.status, 400);
  assert.match(validateBelow.body.message, /Minimum order amount is 50/i);

  const applyBelow = await agent.post('/api/discounts/apply').send({
    couponCode: discount.couponCode,
    businessId: business._id,
    amount: 40,
  });
  assert.equal(applyBelow.status, 400);
  assert.match(applyBelow.body.message, /Minimum order amount is 50/i);

  const validateOk = await agent.post('/api/discounts/validate').send({
    couponCode: discount.couponCode,
    businessId: business._id,
    amount: 50,
  });
  assert.equal(validateOk.status, 200);
  assert.equal(validateOk.body.success, true);

  const applyOk = await agent.post('/api/discounts/apply').send({
    couponCode: discount.couponCode,
    businessId: business._id,
    amount: 50,
  });
  assert.equal(applyOk.status, 200);
  assert.equal(applyOk.body.data.discountAmount, 5);
  assert.equal(applyOk.body.data.finalAmount, 45);
});

test('POST /api/discounts/validate rejects missing amount when minOrderAmount is set', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser);
  const discount = await seedDiscount(business, {
    couponCode: 'NEEDAMT',
    minOrderAmount: 25,
  });

  const agent = createAgent(getApp());
  const res = await agent.post('/api/discounts/validate').send({
    couponCode: discount.couponCode,
    businessId: business._id,
  });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /Valid order amount is required/i);
});
