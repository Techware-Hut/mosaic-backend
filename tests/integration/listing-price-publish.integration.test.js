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
  seedServiceBusiness,
  seedServiceCategories,
  seedVendorOnboarding,
} = require('./helpers/factories');
const User = require('../../models/User');
const Food = require('../../models/Food');
const FoodCategory = require('../../models/FoodCategory');
const FoodSubcategory = require('../../models/FoodSubcategory');
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function setupFoodVendor(agent) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, { listingType: 'food' });
  const category = await FoodCategory.create({
    name: `Price Gate Food Category ${Date.now()}`,
  });
  const subcategory = await FoodSubcategory.create({
    name: `Price Gate Food Subcategory ${Date.now()}`,
    category: category._id,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  return { vendor, user, business, category, subcategory };
}

async function setupServiceVendor(agent) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user);
  const { category, subcategory } = await seedServiceCategories();

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  return { vendor, user, business, category, subcategory };
}

test('POST /api/food/add-food blocks publish when price is zero', async () => {
  const agent = createAgent(getApp());
  const { business, category, subcategory } = await setupFoodVendor(agent);

  const res = await agent.post('/api/food/add-food').send({
    title: 'Zero Price Supper',
    description: 'Should stay draft-only',
    price: 0,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished: true,
  });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'LISTING_PRICE_REQUIRED');
});

test('POST /api/food/add-food allows draft save with zero price', async () => {
  const agent = createAgent(getApp());
  const { business, category, subcategory } = await setupFoodVendor(agent);

  const res = await agent.post('/api/food/add-food').send({
    title: 'Draft Zero Price Supper',
    description: 'Draft is allowed without price',
    price: 0,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished: false,
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.food.isPublished, false);
});

test('POST /api/food/add-food allows publish when price is positive', async () => {
  const agent = createAgent(getApp());
  const { business, category, subcategory } = await setupFoodVendor(agent);

  const res = await agent.post('/api/food/add-food').send({
    title: 'Priced Supper',
    description: 'Should publish',
    price: 24.5,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished: true,
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.food.isPublished, true);
  assert.equal(res.body.food.price, 24.5);
});

test('PUT /api/food/update-food/:id blocks publish when price is zero', async () => {
  const agent = createAgent(getApp());
  const { user, business, category, subcategory } = await setupFoodVendor(agent);

  const food = await Food.create({
    title: 'Draft Food',
    description: 'Will try to publish at zero price',
    price: 0,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    businessId: business._id,
    ownerId: user._id,
    isPublished: false,
  });

  const res = await agent.put(`/api/food/update-food/${food._id}`).send({
    isPublished: true,
    price: 0,
  });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'LISTING_PRICE_REQUIRED');
});

test('POST /api/service blocks publish when child service price is zero', async () => {
  const agent = createAgent(getApp());
  const { business, category, subcategory } = await setupServiceVendor(agent);

  const res = await agent.post('/api/service/').send({
    title: 'Zero Price Salon',
    description: 'Should not publish',
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished: true,
    services: [{ name: 'Basic Cut', price: 0, durationMinutes: 60 }],
  });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.ok(res.body.fieldErrors?.['services[0].price'] || res.body.fieldErrors?.isPublished);
});

test('POST /api/business/:id/publish-storefront blocks food vendor with only zero-price listing', async () => {
  const agent = createAgent(getApp());
  const { user, business, category, subcategory } = await setupFoodVendor(agent);

  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });

  await Food.create({
    title: 'Unpriced Food Listing',
    description: 'Exists but cannot satisfy publish readiness',
    price: 0,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    businessId: business._id,
    ownerId: user._id,
    isPublished: false,
  });

  const readinessRes = await agent.get('/api/business/my');
  assert.equal(readinessRes.status, 200, JSON.stringify(readinessRes.body));
  const returnedBusiness = readinessRes.body.businesses.find(
    (item) => String(item._id) === String(business._id)
  );
  assert.ok(returnedBusiness);
  assert.ok(
    returnedBusiness.onboardingReadiness.blockers.some(
      (blocker) => blocker.code === 'LISTING_PRICE_REQUIRED'
    )
  );

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 409, JSON.stringify(publishRes.body));
  assert.ok(
    (publishRes.body.blockers || []).some((blocker) => blocker.code === 'LISTING_PRICE_REQUIRED')
  );
});

test('POST /api/business/:id/publish-storefront succeeds for product vendor with priced variant', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    listingType: 'product',
    chargesEnabled: true,
    payoutsEnabled: true,
  });
  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });

  const product = await Product.create({
    title: 'Priced Product',
    description: 'Ready for storefront publish',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: business._id,
    coverImage: 'https://example.test/priced-product.png',
    isPublished: false,
    isDeleted: false,
    price: 30,
  });

  await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: user._id,
    attributes: { size: 'standard' },
    sku: `PRICE-GATE-${Date.now()}`,
    price: 30,
    stock: 3,
    images: ['https://example.test/priced-product.png'],
    isPublished: false,
    isDeleted: false,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 200, JSON.stringify(publishRes.body));
});
