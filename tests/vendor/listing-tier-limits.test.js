const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  countProductListingUsage,
  assertProductListingQuota,
  resolveProductListingLimit,
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

test('assertProductListingQuota allows unlimited limits', () => {
  const result = assertProductListingQuota({
    total: 10_000,
    incomingCount: 50,
    limit: Number.POSITIVE_INFINITY,
  });
  assert.equal(result.ok, true);
  assert.equal(result.unlimited, true);
});

test('resolveProductListingLimit uses plan limit in production when override unset', () => {
  const limit = resolveProductListingLimit(10, {
    env: {},
    nodeEnv: 'production',
  });
  assert.equal(limit, 10);
});

test('resolveProductListingLimit is unlimited outside production when override unset', () => {
  const limit = resolveProductListingLimit(10, {
    env: {},
    nodeEnv: 'development',
  });
  assert.equal(limit, Number.POSITIVE_INFINITY);
});

test('resolveProductListingLimit honors numeric PRODUCT_LISTING_LIMIT_OVERRIDE', () => {
  const limit = resolveProductListingLimit(10, {
    env: { PRODUCT_LISTING_LIMIT_OVERRIDE: '100' },
    nodeEnv: 'production',
  });
  assert.equal(limit, 100);
});

test('resolveProductListingLimit honors unlimited PRODUCT_LISTING_LIMIT_OVERRIDE', () => {
  const limit = resolveProductListingLimit(10, {
    env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' },
    nodeEnv: 'production',
  });
  assert.equal(limit, Number.POSITIVE_INFINITY);
});
