const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  countProductListingUsage,
  assertProductListingQuota,
} = require('../../utils/listingTierLimits');

test('countProductListingUsage sums products and variants', async () => {
  const Product = {
    countDocuments: async () => 2,
  };
  const ProductVariant = {
    countDocuments: async () => 5,
  };

  const usage = await countProductListingUsage({
    Product,
    ProductVariant,
    businessId: 'biz-1',
  });

  assert.equal(usage.productCount, 2);
  assert.equal(usage.variantCount, 5);
  assert.equal(usage.total, 7);
});

test('assertProductListingQuota allows when under limit', () => {
  const result = assertProductListingQuota({ total: 3, incomingCount: 2, limit: 10 });
  assert.equal(result.ok, true);
});

test('assertProductListingQuota blocks when at limit with zero remaining', () => {
  const result = assertProductListingQuota({ total: 10, incomingCount: 1, limit: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error, /allows 10 total product\/variant entries/);
});

test('assertProductListingQuota reports remaining slots', () => {
  const result = assertProductListingQuota({ total: 8, incomingCount: 3, limit: 10 });
  assert.equal(result.ok, false);
  assert.match(result.error, /add only 2 more/);
});

test('assertProductListingQuota treats missing incoming as zero', () => {
  const result = assertProductListingQuota({ total: 9, limit: 10 });
  assert.equal(result.ok, true);
});
