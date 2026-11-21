// POST /api/product failure paths against a real MongoDB (synthetic data).
//
// A failed create must not leave an unpublished Product behind, because every
// non-deleted Product counts against the vendor's listing quota
// (utils/listingTierLimits.js). The quota rule itself is unchanged here.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const jwt = require('jsonwebtoken');
let app;
const { startHarness, resetDatabase, stopHarness } = require('./setup/harness');

let Product;
let ProductVariant;
let SubscriptionPlan;
let User;
let factories;
let controller;

test.before(async () => {
  app = await startHarness();
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

test('duplicate SKUs within one request leave no product or variants', async () => {
  const { user, business } = await seedVendor();

  const res = await create(user, body(business, [variant('DUP-1', 20, 'M'), variant('DUP-1', 22, 'L')]));

  assert.equal(res.statusCode, 400);
  assert.equal(await Product.countDocuments({ businessId: business._id }), 0, 'no orphan product');
  assert.equal(await ProductVariant.countDocuments({ businessId: business._id }), 0, 'no stray variants');
});

test('failed creates release the exact quota after partial insert and failed publication', async (t) => {
  const previous = process.env.PRODUCT_LISTING_LIMIT_OVERRIDE;
  process.env.PRODUCT_LISTING_LIMIT_OVERRIDE = '2';
  t.after(() => {
    if (previous === undefined) delete process.env.PRODUCT_LISTING_LIMIT_OVERRIDE;
    else process.env.PRODUCT_LISTING_LIMIT_OVERRIDE = previous;
  });
  const { user, business } = await seedVendor();
  const originalInsert = ProductVariant.insertMany;
  for (const code of [11000, undefined]) {
    ProductVariant.insertMany = async function(docs) {
      await originalInsert.call(this, docs);
      throw Object.assign(new Error('private database detail'), { code });
    };
    let failed;
    try { failed = await create(user, body(business, [variant('FAIL-' + code)])); }
    finally { ProductVariant.insertMany = originalInsert; }
    assert.equal(failed.statusCode, code === 11000 ? 400 : 500);
    assert.equal(typeof failed.body.error, 'string');
    assert.doesNotMatch(failed.body.error, /private database detail/);
    assert.equal(await Product.countDocuments({}), 0);
    assert.equal(await ProductVariant.countDocuments({}), 0);
  }
  for (let i = 0; i < 2; i++) {
    const failed = await create(user, { ...body(business, [variant('ZERO-' + i, 0)]), isPublished: true });
    assert.equal(failed.statusCode, 400);
    assert.equal(failed.body.code, 'LISTING_PRICE_REQUIRED');
    assert.equal(await Product.countDocuments({}), 0);
    assert.equal(await ProductVariant.countDocuments({}), 0);
  }
  const ok = await create(user, body(business, [variant('OK')]));
  assert.equal(ok.statusCode, 201, JSON.stringify(ok.body));
  assert.equal(await Product.countDocuments({}), 1);
  assert.equal(await ProductVariant.countDocuments({}), 1);
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

test('normalization and request duplicates fail before save or insert', async (t) => {
  const { user, business } = await seedVendor();
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('must not save'); });
  const insert = t.mock.method(ProductVariant, 'insertMany', async () => { throw new Error('must not insert'); });
  for (const [variants, code] of [
    [[variant('A'), variant('B', -1, 'L')], 'PRODUCT_VARIANT_INVALID'],
    [[variant(' abc '), variant('abc', 20, 'L')], 'PRODUCT_DUPLICATE_SKU'],
    [[{ ...variant('A'), attributes: { Size: 'M', Color: 'Red' } },
      { ...variant('B'), attributes: { Color: 'Red', Size: 'M' } }], 'PRODUCT_DUPLICATE_ATTRIBUTES'],
  ]) {
    const res = await create(user, body(business, variants));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, code);
    assert.equal(typeof res.body.error, 'string');
  }
  assert.equal(save.mock.callCount(), 0);
  assert.equal(insert.mock.callCount(), 0);
});

test('required field validation returns the FE error contract before writes', async (t) => {
  const { validateProductCreate } = require('../../validators/productValidators');
  const save = t.mock.method(Product.prototype, 'save', async () => { throw new Error('must not save'); });
  const insert = t.mock.method(ProductVariant, 'insertMany', async () => { throw new Error('must not insert'); });
  for (const field of ['title', 'description', 'businessId', 'categoryId', 'subcategoryId', 'coverImage', 'variants']) {
    const payload = body({ _id: new mongoose.Types.ObjectId() }, [variant('A')]);
    delete payload[field];
    const req = { body: payload };
    for (const validator of validateProductCreate) await validator.run(req);
    const res = { status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    await controller.createProductWithVariants(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'PRODUCT_VALIDATION_FAILED');
    assert.equal(typeof res.body.error, 'string');
    assert.ok(res.body.errors.length > 0);
  }
  assert.equal(save.mock.callCount(), 0);
  assert.equal(insert.mock.callCount(), 0);
});

test('unexpected final-read failure cleans only this request and preserves existing listings', async (t) => {
  const { user, business } = await seedVendor();
  const existing = await create(user, body(business, [variant('EXISTING')]));
  assert.equal(existing.statusCode, 201);
  t.mock.method(Product, 'findById', () => { throw new Error('private exception'); });
  const failed = await create(user, body(business, [variant('FAILED')]));
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.error, 'Server error while creating product.');
  assert.equal(await Product.countDocuments({}), 1);
  assert.equal(await ProductVariant.countDocuments({}), 1);
  assert.ok(await Product.exists({ _id: existing.body.product._id }));
  assert.equal(await ProductVariant.countDocuments({ productId: existing.body.product._id }), 1);
});

async function postProduct(user, payload) {
  const token = jwt.sign({ userId: String(user._id), sessionVersion: user.sessionVersion || 0 }, process.env.JWT_SECRET);
  return request(app).post('/api/product').set('Authorization', 'Bearer ' + token).send(payload);
}

test('full published FE payload persists through the real route and Mongo', async () => {
  const { user, business } = await seedVendor();
  const payload = {
    ...body(business, [
      { ...variant('abc'), attributes: { Size: 'M', Color: 'Red' } },
      { ...variant('ABC', 25), attributes: { Size: 'L', Color: 'Red' } },
    ]),
    isPublished: true,
    attributes: [{ name: 'Size', values: ['M', 'L'] }, { name: 'Color', values: ['Red'] }],
    discount: { type: 'fixed', amount: 5 },
    taxCategory: { code: 'txcd_99999999' },
    shipping: { standard: 3, overnight: 8, local: 1 },
    metaFields: [{ key: 'Material', value: 'Cotton' }],
  };
  const res = await postProduct(user, payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const product = await Product.findById(res.body.product._id).lean();
  assert.equal(product.isPublished, true);
  assert.equal(product.discount.type, 'fixed');
  assert.equal(product.discount.amount, 5);
  assert.equal(product.taxCategory.code, payload.taxCategory.code);
  assert.deepEqual(product.shipping, payload.shipping);
  assert.equal(product.metaFields[0].key, 'Material');
  assert.equal(product.metaFields[0].value, 'Cotton');
  const variants = await ProductVariant.find({ productId: product._id }).lean();
  assert.equal(variants.length, 2);
  for (const expected of payload.variants) {
    const stored = variants.find(v => v.sku === expected.sku);
    assert.ok(stored);
    assert.deepEqual(stored.attributes, expected.attributes);
    assert.equal(Number(stored.price.toString()), expected.price);
    assert.equal(stored.stock, expected.stock);
    assert.equal(stored.isPublished, true);
  }
});

test('published single-price empty attributes payload persists one variant', async () => {
  const { user, business } = await seedVendor();
  const res = await postProduct(user, { ...body(business, [{ attributes: {}, price: 20, stock: 2 }]), isPublished: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await Product.findById(res.body.product._id)).isPublished, true);
  const variants = await ProductVariant.find({ productId: res.body.product._id }).lean();
  assert.equal(variants.length, 1);
  assert.deepEqual(variants[0].attributes, {});
  assert.equal(Number(variants[0].price.toString()), 20);
});

test('product save ValidationError returns safe 400 and leaves no documents', async (t) => {
  const { user, business } = await seedVendor();
  const error = new mongoose.Error.ValidationError();
  error.addError('discount.type', new mongoose.Error.ValidatorError({ message: 'private validation detail' }));
  t.mock.method(Product.prototype, 'save', async () => { throw error; });
  const res = await postProduct(user, body(business, [variant('INVALID')]));
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { code: 'PRODUCT_VALIDATION_FAILED', error: 'Invalid product details.' });
  assert.equal(await Product.countDocuments({}), 0);
  assert.equal(await ProductVariant.countDocuments({}), 0);
});
