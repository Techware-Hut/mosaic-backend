const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkBusinessListingQuota,
  countPublishedActiveUsage,
  evaluateListingQuota,
  resolveBusinessListingEntitlement,
  resolvePlanListingLimit,
} = require('../../services/listingQuotaService');
const {
  resolveProductListingLimit,
} = require('../../utils/listingTierLimits');

const business = {
  _id: 'business-1',
  owner: 'user-1',
  subscriptionId: 'subscription-1',
};

function plan(name, limits = {}) {
  return { _id: `${name}-id`, name, limits };
}

function activeSubscription(overrides = {}) {
  return {
    _id: 'subscription-1',
    userId: 'user-1',
    businessId: 'business-1',
    subscriptionPlanId: 'plan-1',
    status: 'active',
    endDate: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

test('Silver and Gold listing limits use the approved independent values', () => {
  const silver = plan('Silver Plan', {
    productListings: 999,
    serviceListings: 999,
    foodListings: 999,
  });
  const gold = plan('Gold Plan', {
    productListings: 1,
    serviceListings: 1,
    foodListings: 1,
  });

  assert.equal(resolvePlanListingLimit({ plan: silver, listingType: 'product' }).limit, 10);
  assert.equal(resolvePlanListingLimit({ plan: silver, listingType: 'service' }).limit, 5);
  assert.equal(resolvePlanListingLimit({ plan: silver, listingType: 'food' }).limit, 5);
  assert.equal(resolvePlanListingLimit({ plan: gold, listingType: 'product' }).limit, 25);
  assert.equal(resolvePlanListingLimit({ plan: gold, listingType: 'service' }).limit, 15);
  assert.equal(resolvePlanListingLimit({ plan: gold, listingType: 'food' }).limit, 15);
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

test('Platinum requires valid stored whole-number limits at or above approved floors', () => {
  const valid = plan('Platinum Plan', {
    productListings: 75,
    serviceListings: 40,
    foodListings: 30,
  });

  assert.equal(resolvePlanListingLimit({ plan: valid, listingType: 'product' }).limit, 75);
  assert.equal(resolvePlanListingLimit({ plan: valid, listingType: 'service' }).limit, 40);
  assert.equal(resolvePlanListingLimit({ plan: valid, listingType: 'food' }).limit, 30);

  for (const [listingType, storedValue] of [
    ['product', undefined],
    ['product', 49],
    ['service', 24],
    ['food', 'invalid'],
  ]) {
    const limits = {};
    const field = listingType === 'product'
      ? 'productListings'
      : listingType === 'service'
        ? 'serviceListings'
        : 'foodListings';
    if (storedValue !== undefined) limits[field] = storedValue;

    const result = resolvePlanListingLimit({
      plan: plan('Platinum Plan', limits),
      listingType,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'PLAN_LIMIT_CONFIGURATION_INVALID');
  }
});

test('product entitlement applies the legacy environment policy after approved plan validation', async () => {
  const models = {
    Subscription: { findById: async () => activeSubscription() },
    SubscriptionPlan: { findById: async () => plan('Silver Plan') },
  };

  const production = await resolveBusinessListingEntitlement({
    business,
    userId: 'user-1',
    listingType: 'product',
    models,
    env: {},
    nodeEnv: 'production',
  });
  assert.equal(production.ok, true);
  assert.equal(production.limit, 10);

  const service = await resolveBusinessListingEntitlement({
    business,
    userId: 'user-1',
    listingType: 'service',
    models,
    env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' },
    nodeEnv: 'production',
  });
  assert.equal(service.ok, true);
  assert.equal(service.limit, 5, 'the product override must not affect service quota');
});

test('unlimited product environments validate entitlement and skip the usage count', async () => {
  for (const options of [
    { env: {}, nodeEnv: 'development' },
    {
      env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' },
      nodeEnv: 'production',
    },
  ]) {
    let productCountCalls = 0;
    const result = await checkBusinessListingQuota({
      business,
      userId: 'user-1',
      listingType: 'product',
      attemptedIncrease: 1,
      models: {
        Subscription: { findById: async () => activeSubscription() },
        SubscriptionPlan: { findById: async () => plan('Silver Plan') },
        Product: {
          countDocuments: async () => {
            productCountCalls += 1;
            return 10_000;
          },
        },
      },
      ...options,
    });

    assert.equal(result.ok, true);
    assert.equal(result.unlimited, true);
    assert.equal(result.limit, Number.POSITIVE_INFINITY);
    assert.equal(productCountCalls, 0);
  }
});

test('finite fractional product overrides preserve legacy comparison behavior', async () => {
  const result = await checkBusinessListingQuota({
    business,
    userId: 'user-1',
    listingType: 'product',
    attemptedIncrease: 1,
    models: {
      Subscription: { findById: async () => activeSubscription() },
      SubscriptionPlan: { findById: async () => plan('Silver Plan') },
      Product: { countDocuments: async () => 10 },
    },
    env: { PRODUCT_LISTING_LIMIT_OVERRIDE: '10.5' },
    nodeEnv: 'production',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'LISTING_LIMIT_REACHED');
  assert.equal(result.limit, 10.5);
  assert.equal(result.current, 10);
  assert.equal(result.projected, 11);
  assert.equal(result.remaining, 0.5);
});

test('an unlimited override cannot rescue missing or invalid Platinum configuration', async () => {
  let productCountCalls = 0;
  for (const limits of [{}, { productListings: 49 }]) {
    const result = await checkBusinessListingQuota({
      business,
      userId: 'user-1',
      listingType: 'product',
      attemptedIncrease: 1,
      models: {
        Subscription: { findById: async () => activeSubscription() },
        SubscriptionPlan: {
          findById: async () => plan('Platinum Plan', limits),
        },
        Product: {
          countDocuments: async () => {
            productCountCalls += 1;
            return 0;
          },
        },
      },
      env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' },
      nodeEnv: 'production',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'PLAN_LIMIT_CONFIGURATION_INVALID');
  }
  assert.equal(productCountCalls, 0);
});

test('product usage uses only the published active nondeleted business filter', async () => {
  let capturedQuery;
  const Product = {
    countDocuments: async (query) => {
      capturedQuery = query;
      return 9;
    },
  };

  const usage = await countPublishedActiveUsage({
    listingType: 'product',
    businessId: 'business-1',
    models: { Product },
  });

  assert.equal(usage, 9);
  assert.deepEqual(capturedQuery, {
    businessId: 'business-1',
    isDeleted: false,
    isPublished: true,
    isActive: { $ne: false },
  });
});

test('food usage uses only the published active business filter', async () => {
  let capturedQuery;
  const Food = {
    countDocuments: async (query) => {
      capturedQuery = query;
      return 4;
    },
  };

  const usage = await countPublishedActiveUsage({
    listingType: 'food',
    businessId: 'business-1',
    models: { Food },
  });

  assert.equal(usage, 4);
  assert.deepEqual(capturedQuery, {
    businessId: 'business-1',
    isPublished: true,
    isActive: { $ne: false },
  });
});

test('service usage sums offerings only under published active parents', async () => {
  let capturedPipeline;
  const Service = {
    aggregate: async (pipeline) => {
      capturedPipeline = pipeline;
      return [{ _id: null, total: 4 }];
    },
  };

  const usage = await countPublishedActiveUsage({
    listingType: 'service',
    businessId: 'business-1',
    models: { Service },
  });

  assert.equal(usage, 4);
  assert.deepEqual(capturedPipeline[0], {
    $match: {
      businessId: 'business-1',
      isPublished: true,
      isActive: { $ne: false },
    },
  });
  assert.deepEqual(capturedPipeline[1].$project, {
    offeringCount: { $size: { $ifNull: ['$services', []] } },
  });
});

test('product, service, and food counters query only their own model', async () => {
  const calls = { Product: 0, Service: 0, Food: 0 };
  const models = {
    Product: {
      countDocuments: async () => {
        calls.Product += 1;
        return 10;
      },
    },
    Service: {
      aggregate: async () => {
        calls.Service += 1;
        return [{ total: 5 }];
      },
    },
    Food: {
      countDocuments: async () => {
        calls.Food += 1;
        return 5;
      },
    },
  };

  assert.equal(await countPublishedActiveUsage({ listingType: 'product', businessId: 'b', models }), 10);
  assert.deepEqual(calls, { Product: 1, Service: 0, Food: 0 });
  assert.equal(await countPublishedActiveUsage({ listingType: 'service', businessId: 'b', models }), 5);
  assert.deepEqual(calls, { Product: 1, Service: 1, Food: 0 });
  assert.equal(await countPublishedActiveUsage({ listingType: 'food', businessId: 'b', models }), 5);
  assert.deepEqual(calls, { Product: 1, Service: 1, Food: 1 });
});

test('quota evaluation blocks only positive increases beyond the limit', () => {
  const allowed = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 9,
    attemptedIncrease: 1,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.projected, 10);

  const blocked = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 10,
    attemptedIncrease: 1,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'LISTING_LIMIT_REACHED');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.projected, 11);
  assert.equal(blocked.remaining, 0);

  for (const attemptedIncrease of [0, -1]) {
    const nonIncreasing = evaluateListingQuota({
      listingType: 'product',
      tier: 'Silver',
      limit: 10,
      current: 15,
      attemptedIncrease,
    });
    assert.equal(nonIncreasing.ok, true);
  }
});

test('business subscription pointer resolves the exact active nonexpired plan', async () => {
  const models = {
    Subscription: {
      findById: async (id) => {
        assert.equal(id, 'subscription-1');
        return activeSubscription({ businessId: null });
      },
    },
    SubscriptionPlan: {
      findById: async (id) => {
        assert.equal(id, 'plan-1');
        return plan('Silver Plan');
      },
    },
  };

  const result = await resolveBusinessListingEntitlement({
    business,
    userId: 'user-1',
    listingType: 'service',
    models,
  });

  assert.equal(result.ok, true);
  assert.equal(result.tier, 'Silver');
  assert.equal(result.limit, 5);
});

test('business subscription ownership, status, expiry, and reverse link are validated', async (t) => {
  const cases = [
    { name: 'wrong user', subscription: activeSubscription({ userId: 'user-2' }), code: 'SUBSCRIPTION_USER_MISMATCH' },
    { name: 'inactive', subscription: activeSubscription({ status: 'cancelled' }), code: 'SUBSCRIPTION_INACTIVE' },
    { name: 'expired', subscription: activeSubscription({ endDate: new Date(0) }), code: 'SUBSCRIPTION_EXPIRED' },
    { name: 'different business', subscription: activeSubscription({ businessId: 'business-2' }), code: 'SUBSCRIPTION_BUSINESS_MISMATCH' },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const result = await resolveBusinessListingEntitlement({
        business,
        userId: 'user-1',
        listingType: 'product',
        models: {
          Subscription: { findById: async () => item.subscription },
          SubscriptionPlan: { findById: async () => plan('Silver Plan') },
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, item.code);
      assert.equal(result.status, 403);
    });
  }
});

test('end-to-end quota check returns deterministic metadata before a write', async () => {
  const result = await checkBusinessListingQuota({
    business,
    userId: 'user-1',
    listingType: 'food',
    attemptedIncrease: 1,
    models: {
      Subscription: { findById: async () => activeSubscription() },
      SubscriptionPlan: { findById: async () => plan('Silver Plan') },
      Food: { countDocuments: async () => 5 },
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual({
    status: result.status,
    code: result.code,
    listingType: result.listingType,
    tier: result.tier,
    limit: result.limit,
    current: result.current,
    attemptedIncrease: result.attemptedIncrease,
    projected: result.projected,
    remaining: result.remaining,
  }, {
    status: 403,
    code: 'LISTING_LIMIT_REACHED',
    listingType: 'food',
    tier: 'Silver',
    limit: 5,
    current: 5,
    attemptedIncrease: 1,
    projected: 6,
    remaining: 0,
  });
});
