"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LISTING_LIMIT_REACHED,
  checkBusinessListingQuota,
  countPublishedActiveUsage,
  evaluateListingQuota,
  resolveBusinessListingEntitlement,
  resolvePlanListingLimit,
} = require('../../services/listingQuotaService');
const {
  countProductListingUsage,
  resolveProductListingLimit,
} = require('../../utils/listingTierLimits');

const NOW = new Date('2026-08-22T16:00:00.000Z');
const LATER = new Date('2026-09-22T16:00:00.000Z');

function matchesQuery(record, query) {
  return Object.entries(query).every(([field, expected]) => {
    const actual = record[field];
    if (expected && typeof expected === 'object' && '$ne' in expected) {
      return String(actual) !== String(expected.$ne);
    }
    return String(actual) === String(expected);
  });
}

function countModel(records, capturedQueries = []) {
  return {
    async countDocuments(query) {
      capturedQueries.push(query);
      return records.filter((record) => matchesQuery(record, query)).length;
    },
  };
}

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
    paymentStatus: 'PENDING',
    endDate: LATER,
    ...overrides,
  };
}

test('product usage uses the exact public Product filter, optional exclusion, and never variants', async () => {
  const queries = [];
  let variantCalls = 0;
  const Product = countModel([
    { _id: 'published', businessId: 'business-1', isDeleted: false, isPublished: true, isActive: true },
    { _id: 'draft', businessId: 'business-1', isDeleted: false, isPublished: false, isActive: true },
  ], queries);

  const usage = await countProductListingUsage({
    Product,
    ProductVariant: {
      async countDocuments() {
        variantCalls += 1;
        return 999;
      },
    },
    businessId: 'business-1',
    excludeId: 'excluded-product',
  });

  assert.deepEqual(queries, [{
    businessId: 'business-1',
    isDeleted: false,
    isPublished: true,
    isActive: { $ne: false },
    _id: { $ne: 'excluded-product' },
  }]);
  assert.equal(variantCalls, 0);
  assert.deepEqual(usage, { productCount: 1, variantCount: 0, total: 1 });
});

test('9 published products plus 20 drafts consumes 9 and allows the tenth Silver product', async () => {
  const records = [
    ...Array.from({ length: 9 }, (_, index) => ({
      _id: `published-${index}`,
      businessId: 'business-1',
      isDeleted: false,
      isPublished: true,
      isActive: true,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      _id: `draft-${index}`,
      businessId: 'business-1',
      isDeleted: false,
      isPublished: false,
      isActive: true,
    })),
  ];

  const current = await countPublishedActiveUsage({
    listingType: 'product',
    businessId: 'business-1',
    models: { Product: countModel(records) },
  });
  const result = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current,
    attemptedIncrease: 1,
  });

  assert.equal(current, 9);
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 1);
});

test('9 published products plus 5 inactive products consumes 9 and allows creation', async () => {
  const records = [
    ...Array.from({ length: 9 }, (_, index) => ({
      _id: `published-${index}`,
      businessId: 'business-1',
      isDeleted: false,
      isPublished: true,
      isActive: true,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      _id: `inactive-${index}`,
      businessId: 'business-1',
      isDeleted: false,
      isPublished: true,
      isActive: false,
    })),
  ];

  const current = await countPublishedActiveUsage({
    listingType: 'product',
    businessId: 'business-1',
    models: { Product: countModel(records) },
  });
  const result = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current,
    attemptedIncrease: 1,
  });

  assert.equal(current, 9);
  assert.equal(result.ok, true);
});

test('10 published Silver products deterministically blocks another product', () => {
  const result = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 10,
    attemptedIncrease: 1,
  });
  const message = 'Product listing limit reached for Silver. Limit 10, current 10, attempted increase 1.';

  assert.deepEqual(result, {
    ok: false,
    code: LISTING_LIMIT_REACHED,
    status: 403,
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 10,
    attemptedIncrease: 1,
    remaining: 0,
    error: message,
    message,
  });
});

test('zero or negative increases remain allowed above a downgraded limit', () => {
  const unchanged = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 25,
    attemptedIncrease: 0,
  });
  const decrease = evaluateListingQuota({
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 25,
    attemptedIncrease: -1,
  });

  assert.equal(unchanged.ok, true);
  assert.equal(decrease.ok, true);
  assert.equal(unchanged.remaining, 0);
  assert.equal(decrease.remaining, 0);
});

test('service usage sums offerings only under published active parents using exact business scope', async () => {
  let receivedPipeline;
  const Service = {
    async aggregate(pipeline) {
      receivedPipeline = pipeline;
      return [{ _id: null, total: 4 }];
    },
  };

  const current = await countPublishedActiveUsage({
    listingType: 'service',
    businessId: 'business-1',
    excludeId: 'current-parent',
    models: { Service },
  });

  assert.equal(current, 4);
  assert.deepEqual(receivedPipeline, [
    {
      $match: {
        businessId: 'business-1',
        isPublished: true,
        isActive: { $ne: false },
        _id: { $ne: 'current-parent' },
      },
    },
    {
      $project: {
        offeringCount: { $size: { $ifNull: ['$services', []] } },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$offeringCount' },
      },
    },
  ]);
});

test('food usage uses the exact published/active business filter and exclusion', async () => {
  const queries = [];
  const Food = countModel([], queries);

  const current = await countPublishedActiveUsage({
    listingType: 'food',
    businessId: 'business-1',
    excludeId: 'food-1',
    models: { Food },
  });

  assert.equal(current, 0);
  assert.deepEqual(queries, [{
    businessId: 'business-1',
    isPublished: true,
    isActive: { $ne: false },
    _id: { $ne: 'food-1' },
  }]);
});

test('product, service, and food usage are independent counters', async () => {
  let servicePipeline;
  const Product = { countDocuments: async () => 10 };
  const Food = { countDocuments: async () => 5 };
  const Service = {
    async aggregate(pipeline) {
      servicePipeline = pipeline;
      return [{ total: 5 }];
    },
  };
  const models = { Product, Service, Food };

  const [products, services, foods] = await Promise.all([
    countPublishedActiveUsage({ listingType: 'product', businessId: 'business-1', models }),
    countPublishedActiveUsage({ listingType: 'service', businessId: 'business-1', models }),
    countPublishedActiveUsage({ listingType: 'food', businessId: 'business-1', models }),
  ]);

  assert.deepEqual({ products, services, foods }, { products: 10, services: 5, foods: 5 });
  assert.equal(servicePipeline[0].$match.businessId, 'business-1');
});

test('Silver and Gold limits are exact by SubscriptionPlan.name regardless of stored values', () => {
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

  assert.deepEqual(
    ['product', 'service', 'food'].map((listingType) =>
      resolvePlanListingLimit({ plan: silver, listingType, env: {} })
    ),
    [10, 5, 5]
  );
  assert.deepEqual(
    ['product', 'service', 'food'].map((listingType) =>
      resolvePlanListingLimit({ plan: gold, listingType, env: {} })
    ),
    [25, 15, 15]
  );
});

test('Platinum preserves higher stored limits and floors lower stored limits', () => {
  const higher = plan('Platinum Plan', {
    productListings: 80,
    serviceListings: 30,
    foodListings: 40,
  });
  const lower = plan('Platinum Plan', {
    productListings: 20,
    serviceListings: 10,
    foodListings: 10,
  });

  assert.deepEqual(
    ['product', 'service', 'food'].map((listingType) =>
      resolvePlanListingLimit({ plan: higher, listingType, env: {} })
    ),
    [80, 30, 40]
  );
  assert.deepEqual(
    ['product', 'service', 'food'].map((listingType) =>
      resolvePlanListingLimit({ plan: lower, listingType, env: {} })
    ),
    [50, 25, 25]
  );
});

test('missing Platinum values are unlimited rather than invented finite caps', () => {
  const platinum = plan('Platinum Plan', {});

  for (const listingType of ['product', 'service', 'food']) {
    assert.equal(
      resolvePlanListingLimit({ plan: platinum, listingType, env: {} }),
      Number.POSITIVE_INFINITY
    );
  }
});

test('nonproduction environments enforce the plan when no explicit override exists', () => {
  assert.equal(resolveProductListingLimit(10, {
    env: { NODE_ENV: 'development' },
    nodeEnv: 'development',
  }), 10);
  assert.equal(resolvePlanListingLimit({
    plan: plan('Silver Plan', { productListings: 999 }),
    listingType: 'product',
    env: { NODE_ENV: 'test' },
  }), 10);
});

test('legacy product-limit environment overrides cannot bypass approved rules', () => {
  const env = { PRODUCT_LISTING_LIMIT_OVERRIDE: '100', NODE_ENV: 'development' };
  const silver = plan('Silver Plan', {
    productListings: 1,
    serviceListings: 1,
    foodListings: 1,
  });

  assert.equal(resolvePlanListingLimit({ plan: silver, listingType: 'product', env }), 10);
  assert.equal(resolvePlanListingLimit({ plan: silver, listingType: 'service', env }), 5);
  assert.equal(resolvePlanListingLimit({ plan: silver, listingType: 'food', env }), 5);
  assert.equal(resolveProductListingLimit(10, { env }), 10);
  assert.equal(resolveProductListingLimit(10, {
    env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' },
  }), 10);
});

test('business.subscriptionId is authoritative, user/business validated, and PENDING payment is not rejected', async () => {
  const subscription = activeSubscription({ businessId: null, paymentStatus: 'PENDING' });
  let exactReference;
  let fallbackCalls = 0;
  const models = {
    Subscription: {
      async findById(reference) {
        exactReference = reference;
        return subscription;
      },
      findOne() {
        fallbackCalls += 1;
        throw new Error('fallback must not run for a resolved exact reference');
      },
    },
    SubscriptionPlan: {
      async findById(reference) {
        assert.equal(reference, 'plan-1');
        return plan('Silver Plan', {
          productListings: 1,
          serviceListings: 1,
          foodListings: 1,
        });
      },
    },
  };

  const result = await resolveBusinessListingEntitlement({
    business: { _id: 'business-1', subscriptionId: 'exact-subscription' },
    userId: 'user-1',
    listingType: 'product',
    models,
    now: NOW,
    env: {},
  });

  assert.equal(result.ok, true);
  assert.equal(exactReference, 'exact-subscription');
  assert.equal(fallbackCalls, 0);
  assert.equal(result.source, 'business.subscriptionId');
  assert.equal(result.subscription.paymentStatus, 'PENDING');
  assert.equal(result.tier, 'Silver');
  assert.equal(result.limit, 10);
  assert.deepEqual(result.limits, { product: 10, service: 5, food: 5 });
});

test('legacy fallback uses exact businessId/user/active/nonexpired query and newest subscription', async () => {
  const subscription = activeSubscription();
  let fallbackFilter;
  let sort;
  const models = {
    Subscription: {
      async findById(reference) {
        assert.equal(reference, 'dangling-subscription');
        return null;
      },
      findOne(filter) {
        fallbackFilter = filter;
        return {
          async sort(criteria) {
            sort = criteria;
            return subscription;
          },
        };
      },
    },
    SubscriptionPlan: {
      async findById() {
        return plan('Gold Plan');
      },
    },
  };

  const result = await resolveBusinessListingEntitlement({
    business: { _id: 'business-1', subscriptionId: 'dangling-subscription' },
    userId: 'user-1',
    models,
    now: NOW,
    env: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'subscription.businessId');
  assert.deepEqual(fallbackFilter, {
    businessId: 'business-1',
    userId: 'user-1',
    status: 'active',
    endDate: { $gte: NOW },
  });
  assert.deepEqual(sort, { createdAt: -1 });
  assert.deepEqual(result.limits, { product: 25, service: 15, food: 15 });
});

test('an invalid exact subscription is rejected without falling through to another subscription', async (t) => {
  const cases = [
    {
      name: 'user mismatch',
      subscription: activeSubscription({ userId: 'other-user' }),
      code: 'SUBSCRIPTION_USER_MISMATCH',
    },
    {
      name: 'inactive',
      subscription: activeSubscription({ status: 'cancelled' }),
      code: 'SUBSCRIPTION_INACTIVE',
    },
    {
      name: 'expired',
      subscription: activeSubscription({ endDate: new Date('2026-08-21T16:00:00.000Z') }),
      code: 'SUBSCRIPTION_EXPIRED',
    },
    {
      name: 'business mismatch',
      subscription: activeSubscription({ businessId: 'other-business' }),
      code: 'SUBSCRIPTION_BUSINESS_MISMATCH',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let fallbackCalls = 0;
      const result = await resolveBusinessListingEntitlement({
        business: { _id: 'business-1', subscriptionId: 'exact-subscription' },
        userId: 'user-1',
        models: {
          Subscription: {
            async findById() {
              return scenario.subscription;
            },
            findOne() {
              fallbackCalls += 1;
              return null;
            },
          },
        },
        now: NOW,
        env: {},
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, scenario.code);
      assert.equal(result.status, 403);
      assert.equal(fallbackCalls, 0);
    });
  }
});

test('checkBusinessListingQuota returns the deterministic limit payload end to end', async () => {
  const result = await checkBusinessListingQuota({
    business: { _id: 'business-1', subscriptionId: 'subscription-1' },
    userId: 'user-1',
    listingType: 'food',
    attemptedIncrease: 1,
    models: {
      Subscription: {
        async findById() {
          return activeSubscription();
        },
      },
      SubscriptionPlan: {
        async findById() {
          return plan('Silver Plan');
        },
      },
      Food: {
        async countDocuments(query) {
          assert.deepEqual(query, {
            businessId: 'business-1',
            isPublished: true,
            isActive: { $ne: false },
          });
          return 5;
        },
      },
    },
    now: NOW,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, LISTING_LIMIT_REACHED);
  assert.equal(result.listingType, 'food');
  assert.equal(result.tier, 'Silver');
  assert.equal(result.limit, 5);
  assert.equal(result.current, 5);
  assert.equal(result.attemptedIncrease, 1);
  assert.equal(result.remaining, 0);
  assert.equal(result.status, 403);
  assert.equal(result.error, result.message);
});
