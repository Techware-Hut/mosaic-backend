const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, login, seedApprovedBusiness } = require('./helpers/factories');
const User = require('../../models/User');
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');

test.before(() => startHarness());
test.afterEach(() => resetDatabase());
test.after(() => stopHarness());

const priceOf = (product) => (product.price == null ? null : Number(product.price.toString()));

async function setupVendor() {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);
  assert.equal((await login(agent, vendor.email, vendor.password)).status, 200);
  return { agent, user, business };
}

async function createProduct(agent, business, variants) {
  const res = await agent.post('/api/product').send({
    title: 'Synthetic Price Summary Product',
    description: 'Synthetic product for #457 price summary regression',
    categoryId: new mongoose.Types.ObjectId().toString(),
    subcategoryId: new mongoose.Types.ObjectId().toString(),
    businessId: business._id.toString(),
    coverImage: 'https://example.test/price-summary.webp',
    isPublished: false,
    variants,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res;
}

test('create with a $0 sale price stores the base price as product.price', async () => {
  const { agent, business } = await setupVendor();
  const res = await createProduct(agent, business, [
    { attributes: { Size: 'M' }, sku: 'SYN-457-M', price: 46.64, salePrice: 0, stock: 3 },
  ]);

  const stored = await Product.findById(res.body.product._id);
  assert.equal(priceOf(stored), 46.64);
  assert.equal(Number(res.body.product.price.$numberDecimal), 46.64);
});

test('updateVariant price change refreshes product.price', async () => {
  const { agent, business } = await setupVendor();
  const res = await createProduct(agent, business, [
    { attributes: { Size: 'S' }, sku: 'SYN-457-S', price: 20, stock: 2 },
    { attributes: { Size: 'L' }, sku: 'SYN-457-L', price: 30, stock: 2 },
  ]);
  const productId = res.body.product._id;
  assert.equal(priceOf(await Product.findById(productId)), 20);

  const small = res.body.variants.find((v) => v.sku.endsWith('SYN-457-S'));
  const updated = await agent
    .put(`/api/product/update-variant/${productId}/${small._id}`)
    .send({ price: 35 });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(priceOf(await Product.findById(productId)), 30);

  // A $0 sale on the cheaper variant must not drop the product price to 0.
  const zeroSale = await agent
    .put(`/api/product/update-variant/${productId}/${small._id}`)
    .send({ price: 15, salePrice: 0 });
  assert.equal(zeroSale.status, 200, JSON.stringify(zeroSale.body));
  assert.equal(priceOf(await Product.findById(productId)), 15);
});

test('addVariants and deleteVariant recompute product.price from non-deleted variants', async () => {
  const { agent, business } = await setupVendor();
  const res = await createProduct(agent, business, [
    { attributes: { Size: 'M' }, sku: 'SYN-457-BASE', price: 40, stock: 2 },
  ]);
  const productId = res.body.product._id;

  const added = await agent
    .post(`/api/product/add-variants/${productId}`)
    .send({ variants: [{ attributes: { Size: 'XS' }, sku: 'SYN-457-XS', price: 12, stock: 1 }] });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(priceOf(await Product.findById(productId)), 12);

  const deleted = await agent.delete(
    `/api/product/delete-variant/${productId}/${added.body.variants[0]._id}`
  );
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(priceOf(await Product.findById(productId)), 40);

  // Soft-deleted variant stays in the collection but no longer affects price.
  const softDeleted = await ProductVariant.findById(added.body.variants[0]._id);
  assert.equal(softDeleted.isDeleted, true);

  const remaining = res.body.variants[0];
  const deletedLast = await agent.delete(`/api/product/delete-variant/${productId}/${remaining._id}`);
  assert.equal(deletedLast.status, 200, JSON.stringify(deletedLast.body));
  assert.equal((await Product.findById(productId)).price, null);
});

async function createTwoVariantProduct(agent, business) {
  const res = await createProduct(agent, business, [
    { attributes: { Size: 'A' }, sku: 'SYN-457-A', price: 20, stock: 2 },
    { attributes: { Size: 'B' }, sku: 'SYN-457-B', price: 10, stock: 2 },
  ]);
  const productId = res.body.product._id;
  const a = res.body.variants.find((v) => v.sku.endsWith('SYN-457-A'));
  const b = res.body.variants.find((v) => v.sku.endsWith('SYN-457-B'));
  assert.equal(priceOf(await Product.findById(productId)), 10);
  return { productId, a, b };
}

test('PUT updateProduct excludes soft-deleted variants from product.price', async () => {
  const { agent, business } = await setupVendor();
  const { productId, a, b } = await createTwoVariantProduct(agent, business);

  // Simulate a previously soft-deleted variant that is still referenced.
  await ProductVariant.updateOne({ _id: b._id }, { $set: { isDeleted: true } });

  const res = await agent.put(`/api/product/${productId}`).send({
    variants: [
      { _id: a._id, attributes: { Size: 'A' }, price: 25 },
      { _id: b._id, attributes: { Size: 'B' } },
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await ProductVariant.findById(b._id)).isDeleted, true);
  assert.equal(priceOf(await Product.findById(productId)), 25);
  assert.equal(Number(res.body.product.price.$numberDecimal), 25);
});

test('PUT updateProduct 400 after partial variant writes still refreshes product.price', async () => {
  const { agent, business } = await setupVendor();
  const { productId, a, b } = await createTwoVariantProduct(agent, business);

  // Variant A is saved and B is removed (not in payload) before the invalid
  // new variant triggers the in-loop 400.
  const res = await agent.put(`/api/product/${productId}`).send({
    variants: [
      { _id: a._id, attributes: { Size: 'A' }, price: 50 },
      { attributes: { Size: 'C' }, price: -1 },
    ],
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));

  assert.equal((await ProductVariant.findById(a._id)).price.toString(), '50');
  assert.equal(await ProductVariant.findById(b._id), null);
  assert.equal(priceOf(await Product.findById(productId)), 50);
});
