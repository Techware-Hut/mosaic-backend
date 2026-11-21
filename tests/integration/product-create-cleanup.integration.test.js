// POST /api/product failure paths against a real MongoDB (synthetic data).
//
// A failed create must not leave an unpublished Product behind, because every
// non-deleted Product counts against the vendor's listing quota
// (utils/listingTierLimits.js). The quota rule itself is unchanged here.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { startHarness, resetDatabase, stopHarness } = require('./setup/harness');

let Product;
let ProductVariant;
let SubscriptionPlan;
let User;
let factories;
let controller;

test.before(async () => {
  await startHarness();
  Product = require('../../models/Product');
  ProductVariant = require('../../models/ProductVariant');
  SubscriptionPlan = require('../../models/SubscriptionPlan');
  User = require('../../models/User');
  factories = require('./helpers/factories');
  controller = require('../../controllers/productController');
  await Product.init();
  await ProductVariant.init(); // unique sku index
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function seedVendor({ productListings = 3 } = {}) {
  await SubscriptionPlan.create({
    name: 'Launch Plan',
    price: 0,
    limits: { productListings, serviceListings: 1, foodListings: 1, imageLimit: 5, videoLimit: 0 },
  });
  const user = await User.create({
    name: 'Synthetic Vendor',
    email: `vendor-${Date.now()}@example.test`,
    mobile: `+1415555${String(Date.now()).slice(-4)}`,
    passwordHash: await bcrypt.hash('Synthetic123!', 4),
    role: 'business_owner',
    isOtpVerified: true,
  });
  const business = await factories.seedApprovedBusiness(user);
  return { user, business };
}

function body(business, variants) {
  return {
    title: 'Test Product 1',
    description: 'Synthetic product',
    businessId: String(business._id),
    categoryId: String(new mongoose.Types.ObjectId()),
    subcategoryId: String(new mongoose.Types.ObjectId()),
    coverImage: 'https://example.test/cover.webp',
    galleryImages: ['https://example.test/g1.webp'],
    variants,
    isPublished: false,
  };
}

async function create(user, payload) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  await controller.createProductWithVariants({ user: { _id: user._id }, body: payload }, res);
  return res;
}

const variant = (sku, price = 20, size = 'M') => ({ attributes: { Size: size }, sku, price, stock: 2 });

test('an invalid variant is rejected before any product is written', async () => {
  const { user, business } = await seedVendor();

  const res = await create(user, body(business, [variant('A-1'), variant('A-2', -5, 'L')]));

  assert.equal(res.statusCode, 400);
  assert.match(String(res.body.error), /price/);
  assert.equal(await Product.countDocuments({ businessId: business._id }), 0);
  assert.equal(await ProductVariant.countDocuments({ businessId: business._id }), 0);
});

test('a variant insert failure (duplicate SKU in one request) removes the saved product', async () => {
  const { user, business } = await seedVendor();

  const res = await create(user, body(business, [variant('DUP-1', 20, 'M'), variant('DUP-1', 22, 'L')]));

  assert.equal(res.statusCode, 400);
  assert.equal(await Product.countDocuments({ businessId: business._id }), 0, 'no orphan product');
  assert.equal(await ProductVariant.countDocuments({ businessId: business._id }), 0, 'no stray variants');
});

test('failed creates do not use up listing quota: a valid create still fits afterwards', async () => {
  // Limit 3 entries; a product with 2 variants uses all 3 (product + 2).
  const { user, business } = await seedVendor({ productListings: 3 });

  await create(user, body(business, [variant('Q-1'), variant('Q-1', 21, 'L')]));
  await create(user, body(business, [variant('Q-2'), variant('Q-3', -1, 'L')]));
  const ok = await create(user, body(business, [variant('Q-4'), variant('Q-5', 21, 'L')]));

  assert.equal(ok.statusCode, 201, JSON.stringify(ok.body));
  assert.equal(await Product.countDocuments({ businessId: business._id }), 1);
  assert.equal(await ProductVariant.countDocuments({ businessId: business._id }), 2);
});

test('a valid create still succeeds and keeps its variants', async () => {
  const { user, business } = await seedVendor();

  const res = await create(user, body(business, [variant('OK-1')]));

  assert.equal(res.statusCode, 201);
  const product = await Product.findOne({ businessId: business._id }).lean();
  assert.ok(product);
  // Variants link to the product by productId (Product has no variants array).
  assert.equal(await ProductVariant.countDocuments({ productId: product._id }), 1);
});
