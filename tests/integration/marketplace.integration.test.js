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
  seedPublishedProduct,
  seedServiceBusiness,
  seedServiceCategories,
} = require('./helpers/factories');
const User = require('../../models/User');
const Business = require('../../models/Business');
const ProductVariant = require('../../models/ProductVariant');
const Cart = require('../../models/Cart');
const CartItem = require('../../models/CartItem');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const FoodCategory = require('../../models/FoodCategory');
const FoodSubcategory = require('../../models/FoodSubcategory');

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
  const business = await seedApprovedBusiness(user, {
    address: { city: 'Atlanta', state: 'GA', country: 'USA', zipCode: '30301' },
  });
  const product = await seedPublishedProduct(business, user);

  const res = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Integration Test Product');
  assert.equal(res.body.data.state, 'GA');
  assert.equal(res.body.data.business.state, 'GA');
  assert.equal(res.body.data.business.address.state, 'GA');
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

test('ineligible product vendor is hidden from public marketplace surfaces', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    isApproved: false,
    isActive: true,
    businessName: 'Ineligible Integration Vendor',
  });
  const product = await seedPublishedProduct(business, user);
  product.isFeatured = true;
  await product.save();

  const directory = await agent.get('/api/business');
  assert.equal(directory.status, 200);
  assert.equal(directory.body.total, 0);

  const list = await agent.get('/api/products/list');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 0);

  const ranked = await agent.get('/api/ranked');
  assert.equal(ranked.status, 200);
  assert.deepEqual(ranked.body.items, []);

  const search = await agent.get('/api/public/search').query({
    keyword: 'Integration',
    listingType: 'product',
  });
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.data.products, []);

  const detail = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(detail.status, 404);

  const profile = await agent.get(`/api/public/product/vendor-profile/${business._id}`);
  assert.equal(profile.status, 404);

  const storefront = await agent.get(`/api/public/products/business/${business._id}`);
  assert.equal(storefront.status, 200);
  assert.equal(storefront.body.total, 0);
  assert.deepEqual(storefront.body.data, []);

  const featured = await agent.get('/api/featured-products');
  assert.equal(featured.status, 200);
  assert.deepEqual(featured.body.products, []);
});

test('cart rejects ineligible vendors and strips stale ineligible lines', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser, {
    isApproved: false,
    isActive: true,
  });
  const product = await seedPublishedProduct(business, vendorUser);
  const variant = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: vendorUser._id,
    attributes: { size: 'M' },
    sku: `SKU-INELIGIBLE-${Date.now()}`,
    price: 25,
    stock: 5,
    isPublished: true,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);
  const customerUser = await User.findOne({ email: customer.email });

  const addRes = await customerAgent.post('/api/cart/add').send({
    productId: product._id,
    variantId: variant._id,
    quantity: 1,
    variant: 'M',
  });
  assert.equal(addRes.status, 403);
  assert.match(addRes.body.message, /approved and active/i);

  const staleLine = await CartItem.create({
    userId: customerUser._id,
    productId: product._id,
    variantId: variant._id,
    businessId: business._id,
    quantity: 1,
    variant: 'M',
  });
  await Cart.create({
    userId: customerUser._id,
    businessId: business._id,
    items: [staleLine._id],
    totalItems: 1,
  });

  const cartRes = await customerAgent.get('/api/cart');
  assert.equal(cartRes.status, 200);
  assert.match(cartRes.body.message, /vendor is no longer approved and active/i);
  assert.deepEqual(cartRes.body.cart.items, []);
  assert.equal(cartRes.body.cart.totalItems, 0);
  assert.equal(cartRes.body.cart.removedItems[0].reason, 'ineligible_vendor');
  assert.equal(await CartItem.findById(staleLine._id), null);
});

test('admin activation does not approve, while admin approve sets public eligibility', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  const vendorUser = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(vendorUser, {
    isApproved: false,
    isActive: false,
    onboardingStatus: 'completed',
  });

  const admin = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, admin.email, admin.password);

  const activateRes = await adminAgent
    .patch(`/admin/api/business/status/${business._id}`)
    .send({ isActive: true });

  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.body.publicMarketplaceEligible, false);
  assert.match(activateRes.body.message, /remain hidden until it is approved/i);

  let reloaded = await Business.findById(business._id).lean();
  assert.equal(reloaded.isActive, true);
  assert.equal(reloaded.isApproved, false);

  const approveRes = await adminAgent.post(`/admin/api/business/approve/${business._id}`);
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.publicMarketplaceEligible, true);

  reloaded = await Business.findById(business._id).lean();
  assert.equal(reloaded.isApproved, true);
  assert.equal(reloaded.isActive, true);
});

test('legacy business-service endpoint hides rejected-live vendor', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user, {
    isApproved: false,
    isActive: true,
    businessName: 'Rejected Live Service Vendor',
  });
  const { category, subcategory } = await seedServiceCategories();

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const createRes = await agent.post('/api/service/').send({
    title: 'Rejected Live Service',
    description: 'Should stay hidden from legacy public lookup',
    price: 45,
    duration: '60',
    services: [{ name: 'Basic Cut' }],
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished: true,
  });
  assert.equal(createRes.status, 201);

  const serviceId = String(createRes.body?.data?.service?._id);
  assert.ok(serviceId);

  const legacyDetail = await agent.get(`/api/service/business-service/${serviceId}`);
  assert.equal(legacyDetail.status, 404);

  const publicDetail = await agent.get(`/api/public/services/${serviceId}`);
  assert.equal(publicDetail.status, 404);
});

test('legacy business-food endpoint hides rejected-live vendor', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    listingType: 'food',
    isApproved: false,
    isActive: true,
    businessName: 'Rejected Live Food Vendor',
  });

  const category = await FoodCategory.create({
    name: `Rejected Food Category ${Date.now()}`,
  });
  const subcategory = await FoodSubcategory.create({
    name: `Rejected Food Subcategory ${Date.now()}`,
    category: category._id,
  });

  const food = await Food.create({
    title: 'Rejected Live Supper Club',
    description: 'Should stay hidden from legacy public lookup',
    price: 35,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    businessId: business._id,
    ownerId: user._id,
    isPublished: true,
  });

  const legacyDetail = await agent.get(`/api/food/business-food/${food._id}`);
  assert.equal(legacyDetail.status, 404);

  const publicDetail = await agent.get(`/api/public/foods/${food._id}`);
  assert.equal(publicDetail.status, 404);
});
