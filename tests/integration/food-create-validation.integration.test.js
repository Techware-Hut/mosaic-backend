const test = require('node:test');
const assert = require('node:assert/strict');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, login, seedApprovedBusiness } = require('./helpers/factories');
const User = require('../../models/User');
const Food = require('../../models/Food');
const FoodCategory = require('../../models/FoodCategory');
const FoodSubcategory = require('../../models/FoodSubcategory');

test.before(async () => { await startHarness(); });
test.afterEach(async () => { await resetDatabase(); });
test.after(async () => { await stopHarness(); });

async function setup() {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, { listingType: 'food' });
  const category = await FoodCategory.create({ name: 'Food validation category' });
  const subcategory = await FoodSubcategory.create({ name: 'Food validation subcategory', category: category._id });
  assert.equal((await login(agent, vendor.email, vendor.password)).status, 200);
  // Same shape as origin/develop useServiceForm.ts handleSubmit, with location omitted
  // as the form does when no address is entered.
  const payload = {
    title: 'Jollof Rice', description: 'Party-size tray', price: 25,
    businessId: String(business._id), categoryId: String(category._id),
    subcategoryId: String(subcategory._id), coverImage: 'https://example.test/food.webp',
    images: ['https://example.test/g1.webp'], menuImage: '',
    businessHours: [{ day: 'Monday', hours: '09:00 AM - 06:00 PM', closed: false }],
    bookingToolLink: '', metaFields: [{ key: 'Cuisine', value: 'West African' }],
    isPublished: false,
  };
  return { agent, payload, user };
}

test('incomplete food returns deterministic validation errors without persisting a document', async () => {
  const { agent, payload } = await setup();
  for (const [field, message] of [
    ['title', 'Food title is required.'],
    ['description', 'Food description is required.'],
    ['coverImage', 'Cover image is required.'],
  ]) {
    for (const value of [undefined, '', '   ', null, 42]) {
      const res = await agent.post('/api/food/add-food').send({ ...payload, [field]: value });
      assert.equal(res.status, 400, `${field}=${JSON.stringify(value)}`);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'VALIDATION_FAILED');
      assert.equal(res.body.error, message);
      assert.equal(res.body.errors.length, 1);
      assert.equal(res.body.errors[0].path, field);
      assert.equal(res.body.errors[0].msg, message);
      assert.equal(await Food.countDocuments(), 0);
    }
  }
  const res = await agent.post('/api/food/add-food').send({});
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.errors.map(e => e.path), ['title', 'description', 'coverImage']);
  assert.equal(res.body.error, 'Food title is required.');
  assert.equal(await Food.countDocuments(), 0);
});

test('current frontend create payload persists one food unchanged', async () => {
  const { agent, payload, user } = await setup();
  const res = await agent.post('/api/food/add-food').send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await Food.countDocuments(), 1);
  const food = await Food.findById(res.body.food._id).lean();
  for (const field of ['title', 'description', 'coverImage', 'price', 'isPublished']) {
    assert.equal(food[field], payload[field]);
  }
  assert.deepEqual(food.images, payload.images);
  assert.equal(String(food.ownerId), String(user._id));
  assert.equal(String(food.businessId), payload.businessId);
});

test('complete food payloads retain existing draft and publication price safeguards', async () => {
  const { agent, payload } = await setup();
  const rejected = await agent.post('/api/food/add-food').send({ ...payload, price: 0, isPublished: true });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'LISTING_PRICE_REQUIRED');
  assert.equal(await Food.countDocuments(), 0);
  const draft = await agent.post('/api/food/add-food').send({ ...payload, price: 0 });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.food.isPublished, false);
  const published = await agent.post('/api/food/add-food').send({ ...payload, isPublished: true });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.food.isPublished, true);
  assert.equal(await Food.countDocuments(), 2);
});
