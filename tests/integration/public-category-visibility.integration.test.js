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
  createAdminDirect,
  login,
} = require('./helpers/factories');
const ProductCategory = require('../../models/ProductCategory');
const ServiceCategory = require('../../models/ServiceCategory');
const FoodCategory = require('../../models/FoodCategory');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('public category endpoints hide legacy invalid and hidden categories', async () => {
  const agent = createAgent(getApp());

  await ProductCategory.create({ name: 'Electronics' });
  await ServiceCategory.create({ name: 'Home Cleaning' });
  await FoodCategory.create({ name: 'Food & Grocery' });
  await ProductCategory.create({ name: 'Office Supplies', hidden: true });
  await ServiceCategory.create({ name: 'Window Washing', isActive: false });
  await FoodCategory.create({ name: 'Prepared Meals', status: 'hidden' });

  await ProductCategory.collection.insertMany([
    { name: 'gcgjgjgg', slug: 'gcgjgjgg' },
    { name: 'vvvvv', slug: 'vvvvv' },
    { name: 'v v v v', slug: 'v-v-v-v' },
  ]);
  await ServiceCategory.collection.insertOne({ name: 'gcgjgjgg', slug: 'gcgjgjgg' });
  await FoodCategory.collection.insertOne({ name: 'vvvvv', slug: 'vvvvv' });

  const all = await agent.get('/api/categories');
  assert.equal(all.status, 200);
  assertNames(all.body.data.productCategories, {
    includes: ['Electronics'],
    excludes: ['gcgjgjgg', 'vvvvv', 'v v v v', 'Office Supplies'],
  });
  assertNames(all.body.data.serviceCategories, {
    includes: ['Home Cleaning'],
    excludes: ['gcgjgjgg', 'Window Washing'],
  });
  assertNames(all.body.data.foodCategories, {
    includes: ['Food & Grocery'],
    excludes: ['vvvvv', 'Prepared Meals'],
  });

  const products = await agent.get('/api/categories/products');
  assert.equal(products.status, 200);
  assertNames(products.body.data.productCategories, {
    includes: ['Electronics'],
    excludes: ['gcgjgjgg', 'vvvvv', 'v v v v', 'Office Supplies'],
  });

  const services = await agent.get('/api/categories/services');
  assert.equal(services.status, 200);
  assertNames(services.body.data.serviceCategories, {
    includes: ['Home Cleaning'],
    excludes: ['gcgjgjgg', 'Window Washing'],
  });

  const foods = await agent.get('/api/categories/foods');
  assert.equal(foods.status, 200);
  assertNames(foods.body.data.foodCategories, {
    includes: ['Food & Grocery'],
    excludes: ['vvvvv', 'Prepared Meals'],
  });

  const legacyProducts = await agent.get('/api/admin/category/product');
  assert.equal(legacyProducts.status, 200);
  assertNames(legacyProducts.body.data, {
    includes: ['Electronics'],
    excludes: ['gcgjgjgg', 'vvvvv', 'v v v v', 'Office Supplies'],
  });

  const legacyServices = await agent.get('/api/admin/category/service');
  assert.equal(legacyServices.status, 200);
  assertNames(legacyServices.body.categories, {
    includes: ['Home Cleaning'],
    excludes: ['gcgjgjgg', 'Window Washing'],
  });

  const legacyFoods = await agent.get('/api/admin/category/food');
  assert.equal(legacyFoods.status, 200);
  assertNames(legacyFoods.body.data, {
    includes: ['Food & Grocery'],
    excludes: ['vvvvv', 'Prepared Meals'],
  });
});

test('admin category creation rejects obvious test names', async () => {
  const { email, password } = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const product = await adminAgent
    .post('/api/admin/category/product')
    .send({ name: 'gcgjgjgg' });
  assert.equal(product.status, 400);
  assert.match(product.body.message, /test data|reserved/i);

  const service = await adminAgent
    .post('/api/admin/category/service')
    .send({ name: 'vvvvv' });
  assert.equal(service.status, 400);
  assert.match(service.body.message, /placeholder|test data|reserved/i);

  const food = await adminAgent
    .post('/api/admin/category/food')
    .send({ name: 'v v v v' });
  assert.equal(food.status, 400);
  assert.match(food.body.message, /placeholder|test data|reserved/i);
});

function assertNames(categories, { includes = [], excludes = [] }) {
  assert.ok(Array.isArray(categories));
  const names = categories.map((category) => category.name);

  for (const expected of includes) {
    assert.ok(names.includes(expected), `${expected} should be public`);
  }

  for (const blocked of excludes) {
    assert.equal(names.includes(blocked), false, `${blocked} should be hidden`);
  }
}
