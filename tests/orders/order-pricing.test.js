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
