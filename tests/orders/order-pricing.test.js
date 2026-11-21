const test = require('node:test');
const assert = require('node:assert/strict');
const { priceOrderLines } = require('../../lib/orders/orderPricing');

const line = { productId: 'product', variantId: 'variant', size: 'M', quantity: 3,
  priceExclTax: 19.99, submittedPrice: 19.99, taxCategory: { code: 'goods', label: 'Goods' },
  shipping: { standard: 2 } };
const input = { rawVendorItems: [line], businessId: 'business', deliverySpeed: 'standard',
  business: { taxSettings: { enabled: true, categories: [{ code: 'goods', rate: 8.25 }] } } };

test('shared pricing preserves unit tax rounding and accepts both checkout price formats', async () => {
  const legacy = await priceOrderLines(input);
  const inclusive = await priceOrderLines({ ...input,
    rawVendorItems: [{ ...line, submittedPrice: 21.64 }] });
  assert.deepEqual(inclusive, legacy);
  assert.equal(legacy.subtotalAmount, 64.92);
  assert.equal(legacy.taxTotal, 4.95);
  assert.equal(legacy.totalAmount, 70.92);
  await assert.rejects(priceOrderLines({ ...input,
    rawVendorItems: [{ ...line, submittedPrice: 1 }] }),
    { statusCode: 400, message: 'Price mismatch for size M' });
});


test('quote and initiate reject incomplete Connect onboarding using their respective snapshots', async () => {
  const Module = require('node:module');
  const controllerPath = require.resolve('../../controllers/orderController');
  const productId = '507f1f77bcf86cd799439013';
  const variantId = '507f1f77bcf86cd799439014';
  const variant = { ownerId: 'vendor', businessId: 'business', isPublished: true,
    productId: { _id: productId, isPublished: true, isActive: true },
    attributes: { size: 'M' }, price: 20, stock: 10 };
  for (const fields of [
    { chargesEnabled: false, capabilities: { transfers: 'active' } },
    { chargesEnabled: true, capabilities: { transfers: 'pending' } },
  ]) {
    const business = { isApproved: true, isActive: true, stripeConnectAccountId: 'acct_test',
      ...fields, save: async () => {} };
    let retrieves = 0;
    const original = Module._load;
    let controller;
    try {
      Module._load = function(request, parent, isMain) {
        if (request === 'stripe') return class { constructor() { return { accounts: {
          retrieve: async () => { retrieves++; return { charges_enabled: fields.chargesEnabled,
            capabilities: fields.capabilities }; },
        } }; } };
        if (request.endsWith('models/ProductVariant')) return { findById: () => ({ populate: async () => variant }) };
        if (request.endsWith('models/Business')) return { findById: async () => business };
        if (request.endsWith('models/User')) return { findById: () => ({ select: async () => ({ email: 'buyer@example.test' }) }) };
        return original.call(this, request, parent, isMain);
      };
      delete require.cache[controllerPath];
      controller = require(controllerPath);
    } finally { Module._load = original; delete require.cache[controllerPath]; }
    const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } });
    const req = { user: { id: 'buyer' }, body: { items: [{ productId, variantId, size: 'M', quantity: '1', price: 20 }],
      shippingAddress: { fullName: 'Buyer', phone: '123', addressLine1: 'Main' } } };
    const quote = response(), order = response();
    await controller.buyNowQuote(req, quote);
    assert.equal(retrieves, 0);
    await controller.initiateOrder(req, order);
    assert.equal(retrieves, 1);
    assert.equal(quote.statusCode, 400);
    assert.equal(order.statusCode, 400);
    assert.deepEqual(quote.body, { success: false, message: 'Vendor Stripe onboarding incomplete.' });
    assert.deepEqual(quote.body, order.body);
  }
});
