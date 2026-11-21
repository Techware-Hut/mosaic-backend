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
  seedPublishedProduct,
} = require('./helpers/factories');
const User = require('../../models/User');
const ProductVariant = require('../../models/ProductVariant');

const D = (value) => mongoose.Types.Decimal128.fromString(String(value));

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

// Synthetic fixtures: one published product with three variants whose sale
// prices are Decimal128("0"), null and a positive Decimal128. The "zero" and
// "pos" variants also carry legacy `sizes` rows (written through the raw
// collection, since the current schema no longer declares `sizes`).
async function seedSaleVariants() {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user);
  const product = await seedPublishedProduct(business, user);

  const base = {
    productId: product._id,
    businessId: business._id,
    ownerId: user._id,
    price: D('30'),
    stock: 5,
    images: ['https://example.test/sale-read.png'],
    isPublished: true,
    isDeleted: false,
  };
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const zero = await ProductVariant.create({
    ...base,
    attributes: { size: 'zero' },
    sku: `SALE-READ-ZERO-${stamp}`,
    salePrice: D('0'),
  });
  const none = await ProductVariant.create({
    ...base,
    attributes: { size: 'none' },
    sku: `SALE-READ-NULL-${stamp}`,
    salePrice: null,
  });
  const pos = await ProductVariant.create({
    ...base,
    attributes: { size: 'pos' },
    sku: `SALE-READ-POS-${stamp}`,
    salePrice: D('19.99'),
  });

  await ProductVariant.collection.updateOne(
    { _id: zero._id },
    {
      $set: {
        sizes: [
          { _id: new mongoose.Types.ObjectId(), size: 'S', sku: `Z-S-${stamp}`, stock: 2, price: D('30'), salePrice: D('0') },
          { _id: new mongoose.Types.ObjectId(), size: 'M', sku: `Z-M-${stamp}`, stock: 2, price: D('30'), salePrice: null },
        ],
      },
    }
  );
  await ProductVariant.collection.updateOne(
    { _id: pos._id },
    {
      $set: {
        sizes: [
          { _id: new mongoose.Types.ObjectId(), size: 'L', sku: `P-L-${stamp}`, stock: 2, price: D('30'), salePrice: D('12.5') },
        ],
      },
    }
  );

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  return { agent, business, product, zero, none, pos };
}

const byId = (list, idKey, id) =>
  list.find((entry) => String(entry[idKey]) === String(id));

test('GET /api/public/product/:id returns null salePrice for Decimal128("0") and null sales', async () => {
  const { agent, product, zero, none, pos } = await seedSaleVariants();

  const res = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const variants = res.body.data.variants;
  assert.ok(Array.isArray(variants));

  const zeroV = byId(variants, 'variantId', zero._id);
  const noneV = byId(variants, 'variantId', none._id);
  const posV = byId(variants, 'variantId', pos._id);

  assert.equal(zeroV.salePrice, null);
  assert.equal(zeroV.salePriceExclTax, null);
  assert.equal(zeroV.salePriceInclTax, null);
  assert.equal(zeroV.price, 30);
  assert.equal(noneV.salePrice, null);
  assert.equal(noneV.salePriceInclTax, null);
  assert.equal(posV.salePrice, 19.99);
  assert.equal(posV.salePriceExclTax, 19.99);

  assert.equal(zeroV.sizes.find((s) => s.size === 'S').salePrice, null);
  assert.equal(zeroV.sizes.find((s) => s.size === 'M').salePrice, null);
  assert.equal(posV.sizes.find((s) => s.size === 'L').salePrice, 12.5);
});

test('GET /api/private/products/list returns null salePrice for Decimal128("0") and null sales', async () => {
  const { agent, business, zero, none, pos } = await seedSaleVariants();

  const res = await agent.get(`/api/private/products/list?businessId=${business._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const variants = res.body.data.flatMap((p) => p.variants);

  const zeroV = byId(variants, 'variantId', zero._id);
  const noneV = byId(variants, 'variantId', none._id);
  const posV = byId(variants, 'variantId', pos._id);

  // Legacy sizes rows on the zero-sale variant.
  assert.deepEqual(
    zeroV.sizes.map((s) => [s.size, s.salePrice]),
    [['S', null], ['M', null]]
  );
  // Single-row (non-legacy) variants.
  assert.equal(noneV.sizes.length, 1);
  assert.equal(noneV.sizes[0].salePrice, null);
  assert.equal(noneV.sizes[0].price, 30);
  assert.deepEqual(posV.sizes.map((s) => [s.size, s.salePrice]), [['L', 12.5]]);
});

test('GET /api/product/:id returns null variant salePrice for Decimal128("0") and null sales', async () => {
  const { agent, product, zero, none, pos } = await seedSaleVariants();

  const res = await agent.get(`/api/product/${product._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const variants = res.body.product.variants;

  assert.equal(byId(variants, '_id', zero._id).salePrice, null);
  assert.equal(byId(variants, '_id', none._id).salePrice, null);
  assert.equal(byId(variants, '_id', pos._id).salePrice, 19.99);
  assert.equal(byId(variants, '_id', zero._id).price, 30);
});

test('GET /api/product/get-variant/:productId/:variantId returns null salePrice for Decimal128("0") and null sales', async () => {
  const { agent, product, zero, none, pos } = await seedSaleVariants();

  const zeroRes = await agent.get(`/api/product/get-variant/${product._id}/${zero._id}`);
  assert.equal(zeroRes.status, 200, JSON.stringify(zeroRes.body));
  assert.equal(zeroRes.body.variant.salePrice, null);
  assert.equal(zeroRes.body.variant.price, 30);

  const noneRes = await agent.get(`/api/product/get-variant/${product._id}/${none._id}`);
  assert.equal(noneRes.status, 200, JSON.stringify(noneRes.body));
  assert.equal(noneRes.body.variant.salePrice, null);

  const posRes = await agent.get(`/api/product/get-variant/${product._id}/${pos._id}`);
  assert.equal(posRes.status, 200, JSON.stringify(posRes.body));
  assert.equal(posRes.body.variant.salePrice, 19.99);
});
