const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startHarness, resetDatabase, stopHarness, getApp } = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const { registerAndVerify, login, seedApprovedBusiness, seedPublishedProduct, seedDiscount } = require('./helpers/factories');
const { setStripeShouldFail } = require('./helpers/providerStubs');
const User = require('../../models/User');
const ProductVariant = require('../../models/ProductVariant');
// Hydrate the legacy sizes field for this compatibility fixture. The current
// schema omits it; production schema and checkout selection stay unchanged.
Object.defineProperty(ProductVariant.prototype, 'sizes', {
  configurable: true, get() { return this.get('sizes'); },
});
test.before(() => startHarness({ transactions: true }));
test.afterEach(() => resetDatabase());
test.after(() => stopHarness());
const rates = { standard: 5, express: 12, local: 2 };
async function snapshot() {
  const result = {};
  for (const c of Object.values(mongoose.connection.collections)) {
    result[c.collectionName] = await c.find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(result);
}
for (const scenario of [
  { name: 'numeric string quantity', quantity: '3', expectedShipping: 15 },
  { name: 'fractional quantity', quantity: 1.5, expectedShipping: 7.5 },
  { name: 'legacy per-unit qty 3', expectedShipping: 15 },
  { name: 'vendor flat rate', settings: { method: 'flat_rate', flatRate: rates }, expectedShipping: 5 },
  { name: 'quantity tiers', settings: { method: 'quantity_based', quantityTiers: [{ minQuantity: 1, maxQuantity: 2, rates }, { minQuantity: 3, rates: { standard: 8, express: 15, local: 3 } }] }, expectedShipping: 8 },
  ...[59, 60, 61].map(threshold => ({ name: 'threshold ' + threshold, settings: { method: 'flat_rate', flatRate: rates, freeShipping: { enabled: true, threshold } }, expectedShipping: threshold <= 60 ? 0 : 5 })),
  { name: 'overnight maps to express', speed: 'overnight', expectedShipping: 36 },
  { name: 'tax inclusive sale', sale: true },
  { name: 'size price', sizes: true },
  { name: 'fixed coupon', coupon: 'fixed' },
  { name: 'percent coupon', coupon: 'percentage' },
]) {
  test('quote matches initiate: ' + scenario.name, async () => {
    const vendorAgent = createAgent(getApp());
    const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
    const owner = await User.findOne({ email: vendor.email });
    const business = await seedApprovedBusiness(owner, {
      chargesEnabled: true, capabilities: { transfers: 'active' },
      ...(scenario.settings ? { shippingSettings: scenario.settings } : {}),
      taxSettings: { enabled: !!scenario.sale, categories: [{ code: 'goods', label: 'Goods', rate: 10 }] },
    });
    const product = await seedPublishedProduct(business, owner);
    product.taxCategory = { code: 'goods', label: 'Goods' }; await product.save();
    const variant = await ProductVariant.create({ productId: product._id, businessId: business._id,
      ownerId: owner._id, isPublished: true, attributes: { size: 'M' }, sku: 'QUOTE', price: 20,
      ...(scenario.sale ? { salePrice: 15 } : {}), stock: 100, shipping: { standard: 5, overnight: 12, local: 2 } });
    if (scenario.sizes) await ProductVariant.collection.updateOne({ _id: variant._id }, { $set: { sizes: [{ size: 'M', price: 27, sku: 'SIZE-M' }] } });
    const agent = createAgent(getApp());
    const buyer = await registerAndVerify(agent, { role: 'customer' }); await login(agent, buyer.email, buyer.password);
    const coupon = scenario.coupon ? await seedDiscount(business, { type: scenario.coupon, value: 10 }) : null;
    const body = { items: [{ productId: String(product._id), variantId: String(variant._id), size: 'M', quantity: scenario.quantity || 3 }],
      shippingAddress: { fullName: 'Buyer', phone: '1234567890', addressLine1: '1 Main St', state: 'GA' },
      selectedDeliverySpeed: scenario.speed || 'standard', ...(coupon ? { couponCode: coupon.couponCode } : {}) };
    const before = await snapshot(); setStripeShouldFail(true);
    const quote = await agent.post('/api/orders/buy-now-quote').send(body);
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(await snapshot(), before, 'quote must leave all database documents unchanged');
    setStripeShouldFail(false);
    if (scenario.expectedShipping !== undefined) assert.equal(quote.body.pricing.shippingTotal, scenario.expectedShipping);
    body.items[0].price = scenario.sizes ? 27 : scenario.sale ? 15 : 20;
    const order = await agent.post('/api/orders/initiate').send(body);
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(quote.body.pricing.totalAmount, order.body.totals.totalAmount);
    assert.equal(quote.body.pricing.taxTotal, order.body.totals.taxTotal);
    if (scenario.sizes) assert.equal(quote.body.pricing.lineItems[0].price, 27);
    if (scenario.sale) { assert.equal(quote.body.pricing.subtotal, 49.5); assert.equal(quote.body.pricing.taxTotal, 4.5); }
    if (scenario.coupon) assert.equal(quote.body.pricing.discountAmount, scenario.coupon === 'fixed' ? 10 : 6);
    assert.equal(quote.body.pricing.discountAmount, order.body.totals.discountAmount);
  });
}


test('quote validates input and enforces buyer and vendor eligibility without side effects', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);
  const owner = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(owner, { chargesEnabled: true, capabilities: { transfers: 'active' } });
  const product = await seedPublishedProduct(business, owner);
  const variant = await ProductVariant.create({ productId: product._id, businessId: business._id,
    ownerId: owner._id, isPublished: true, attributes: { size: 'M' }, sku: 'GUARDS', price: 20, stock: 100 });
  const agent = createAgent(getApp());
  const buyer = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, buyer.email, buyer.password);
  const item = { productId: String(product._id), variantId: String(variant._id), size: 'M', quantity: 1 };
  const quote = body => agent.post('/api/orders/buy-now-quote').send(body);
  setStripeShouldFail(true);
  assert.equal((await createAgent(getApp()).post('/api/orders/buy-now-quote').send({ items: [item] })).status, 401);
  assert.equal((await quote({ items: [item] })).status, 200, 'vendors may buy from another vendor');
  const self = await vendorAgent.post('/api/orders/buy-now-quote').send({ items: [item] });
  assert.equal(self.status, 403); assert.equal(self.body.code, 'SELF_PURCHASE_FORBIDDEN');
  for (const [document, field, value] of [
    [product, 'isPublished', false], [product, 'isActive', false],
    [product, 'isDeleted', true], [variant, 'isPublished', false], [variant, 'isDeleted', true],
  ]) {
    const previous = document[field];
    document[field] = value; await document.save();
    const hidden = await quote({ items: [item] });
    assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, { success: false, message: 'Product not found' });
    document[field] = previous; await document.save();
  }
  const before = await snapshot();
  for (const items of [[], [null], [{ ...item, quantity: 0 }],
    [{ ...item, variantId: 'invalid' }], [{ ...item, size: 'missing' }], [item, item], Array(51).fill(item)]) {
    assert.equal((await quote({ items })).status, 400, JSON.stringify(items));
  }
  const capped = await quote({ items: Array(51).fill(item) });
  assert.equal(capped.status, 400);
  assert.match(capped.body.message, /50/);
  assert.equal((await quote({ items: Array(50).fill(item) })).body.message, 'Duplicate item in cart');
  for (const patch of [{ productId: String(new mongoose.Types.ObjectId()) }, { variantId: String(new mongoose.Types.ObjectId()) }]) {
    assert.equal((await quote({ items: [{ ...item, ...patch }] })).status, 404);
  }
  assert.equal((await quote({ items: [item], couponCode: 'UNKNOWN' })).status, 400);
  assert.equal((await quote({ items: [item], selectedDeliverySpeed: 'invalid' })).status, 400);
  assert.equal(await snapshot(), before);
  const secondOwner = await User.findOne({ email: buyer.email });
  const secondBusiness = await seedApprovedBusiness(secondOwner);
  const secondProduct = await seedPublishedProduct(secondBusiness, secondOwner);
  const secondVariant = await ProductVariant.create({ productId: secondProduct._id, businessId: secondBusiness._id,
    ownerId: secondOwner._id, isPublished: true, attributes: { size: 'M' }, sku: 'SECOND', price: 20, stock: 100 });
  assert.equal((await quote({ items: [item, { ...item, productId: String(secondProduct._id), variantId: String(secondVariant._id) }] })).status, 400);
  business.isActive = false; await business.save();
  const blockedQuote = await quote({ items: [item] });
  const blockedOrder = await agent.post('/api/orders/initiate').send({ items: [{ ...item, price: 20 }],
    shippingAddress: { fullName: 'Buyer', phone: '1234567890', addressLine1: 'Main' } });
  assert.equal(blockedQuote.status, blockedOrder.status);
  assert.equal(blockedQuote.body.message, blockedOrder.body.message);
});

test('quote rate limit returns RATE_LIMITED and leaves initiate outside the limiter', async () => {
  const agent = createAgent(getApp());
  let response;
  for (let n = 0; n < 61; n++) {
    response = await agent.post('/api/orders/buy-now-quote').send({});
    if (response.status === 429) break;
    assert.equal(response.status, 401);
  }
  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'RATE_LIMITED');
  assert.equal((await agent.post('/api/orders/initiate').send({})).status, 401);
});
