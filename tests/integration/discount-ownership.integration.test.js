const test = require('node:test');
const assert = require('node:assert/strict');
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
  seedApprovedBusiness,
  seedDiscount,
} = require('./helpers/factories');
const User = require('../../models/User');
const Discount = require('../../models/Discounts');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function setupTwoVendors() {
  const ownerAgent = createAgent(getApp());
  const otherAgent = createAgent(getApp());

  const ownerRegistration = await registerAndVerify(ownerAgent, { role: 'business_owner' });
  const otherRegistration = await registerAndVerify(otherAgent, { role: 'business_owner' });

  const ownerUser = await User.findOne({ email: ownerRegistration.email });
  const otherUser = await User.findOne({ email: otherRegistration.email });

  const ownerBusiness = await seedApprovedBusiness(ownerUser);
  const otherBusiness = await seedApprovedBusiness(otherUser);

  const ownerLogin = await login(ownerAgent, ownerRegistration.email, ownerRegistration.password);
  const otherLogin = await login(otherAgent, otherRegistration.email, otherRegistration.password);

  assert.equal(ownerLogin.status, 200);
  assert.equal(otherLogin.status, 200);

  const discount = await seedDiscount(ownerBusiness, {
    name: 'Owner Only Discount',
    couponCode: `OWN${Date.now()}`.slice(0, 20),
  });

  return {
    ownerAgent,
    otherAgent,
    ownerBusiness,
    otherBusiness,
    discount,
  };
}

test('owner can read, update, and delete their own discount', async () => {
  const { ownerAgent, discount } = await setupTwoVendors();

  const getRes = await ownerAgent.get(`/api/discounts/${discount._id}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.success, true);
  assert.equal(String(getRes.body.data._id), String(discount._id));

  const updateRes = await ownerAgent.put(`/api/discounts/${discount._id}`).send({
    name: 'Updated Owner Discount',
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.success, true);
  assert.equal(updateRes.body.data.name, 'Updated Owner Discount');

  const deleteRes = await ownerAgent.delete(`/api/discounts/${discount._id}`);
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);
  assert.equal(deleteRes.body.message, 'Discount deleted successfully');

  const missing = await Discount.findById(discount._id);
  assert.equal(missing, null);
});

test('different business_owner cannot read, update, or delete another discount', async () => {
  const { ownerAgent, otherAgent, discount } = await setupTwoVendors();

  const otherGet = await otherAgent.get(`/api/discounts/${discount._id}`);
  assert.equal(otherGet.status, 404);
  assert.equal(otherGet.body.success, false);
  assert.equal(otherGet.body.message, 'Discount not found');

  const otherUpdate = await otherAgent.put(`/api/discounts/${discount._id}`).send({
    name: 'Cross Tenant Update',
  });
  assert.equal(otherUpdate.status, 404);
  assert.equal(otherUpdate.body.message, 'Discount not found');

  const otherDelete = await otherAgent.delete(`/api/discounts/${discount._id}`);
  assert.equal(otherDelete.status, 404);
  assert.equal(otherDelete.body.message, 'Discount not found');

  const ownerGet = await ownerAgent.get(`/api/discounts/${discount._id}`);
  assert.equal(ownerGet.status, 200);
  assert.equal(ownerGet.body.data.name, discount.name);
});

test('unauthenticated access to discount routes is rejected', async () => {
  const { discount } = await setupTwoVendors();
  const agent = createAgent(getApp());

  const getRes = await agent.get(`/api/discounts/${discount._id}`);
  assert.equal(getRes.status, 401);

  const updateRes = await agent.put(`/api/discounts/${discount._id}`).send({ name: 'No Auth' });
  assert.equal(updateRes.status, 401);

  const deleteRes = await agent.delete(`/api/discounts/${discount._id}`);
  assert.equal(deleteRes.status, 401);
});

test('nonexistent discount id returns 404 for owner', async () => {
  const { ownerAgent } = await setupTwoVendors();
  const missingId = new mongoose.Types.ObjectId();

  const getRes = await ownerAgent.get(`/api/discounts/${missingId}`);
  assert.equal(getRes.status, 404);
  assert.equal(getRes.body.message, 'Discount not found');

  const updateRes = await ownerAgent.put(`/api/discounts/${missingId}`).send({ name: 'Missing' });
  assert.equal(updateRes.status, 404);

  const deleteRes = await ownerAgent.delete(`/api/discounts/${missingId}`);
  assert.equal(deleteRes.status, 404);
});

test('malformed discount id returns 404 for owner', async () => {
  const { ownerAgent } = await setupTwoVendors();

  const getRes = await ownerAgent.get('/api/discounts/not-a-valid-id');
  assert.equal(getRes.status, 404);
  assert.equal(getRes.body.message, 'Discount not found');
});
