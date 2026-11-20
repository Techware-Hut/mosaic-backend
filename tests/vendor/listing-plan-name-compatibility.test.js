'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tierFromPlanName,
  resolvePlanListingLimit,
  resolveBusinessListingEntitlement,
  checkBusinessListingQuota,
} = require('../../services/listingQuotaService');

// Mapping matches scripts/migrate-rename-plan-tiers.js on staging.
// These are naming aliases, not changes to pricing, caps, or subscription data.
const renamedTiers = [
  { old: 'Silver', name: 'Launch', caps: { product: 10, service: 5, food: 5 } },
  { old: 'Gold', name: 'Growth', caps: { product: 25, service: 15, food: 15 } },
  { old: 'Platinum', name: 'Legacy', caps: { product: 75, service: 40, food: 30 } },
];
const storedLimits = { productListings: 75, serviceListings: 40, foodListings: 30 };
const now = new Date('2026-10-22T12:00:00Z');
const business = { _id: 'business-1', owner: 'user-1', subscriptionId: 'subscription-1' };
const subscription = {
  _id: 'subscription-1', userId: 'user-1', businessId: 'business-1',
  subscriptionPlanId: 'plan-1', status: 'active', endDate: new Date('2027-10-22T12:00:00Z'),
};

function quotaArgs(name, listingType, current, options = {}) {
  const plan = { _id: 'plan-1', name, limits: { ...storedLimits } };
  return {
    business, userId: 'user-1', listingType, attemptedIncrease: 1, now,
    env: {}, nodeEnv: 'production',
    models: {
      Subscription: { findById: async () => ({ ...subscription }) },
      SubscriptionPlan: { findById: async () => plan },
      Product: { countDocuments: async () => current },
      Service: { aggregate: async () => [{ total: current }] },
      Food: { countDocuments: async () => current },
    },
    ...options,
  };
}

for (const tier of renamedTiers) {
  for (const name of [tier.name, `${tier.name} Plan`, `  ${tier.name.toUpperCase()} PLAN  `,
    tier.old, `${tier.old} Plan`]) {
    test(`plan-name alias ${JSON.stringify(name)} preserves ${tier.old} quota identity`, () => {
      assert.equal(tierFromPlanName(name), tier.old);
      for (const [listingType, expected] of Object.entries(tier.caps)) {
        const result = resolvePlanListingLimit({ plan: { name, limits: storedLimits }, listingType });
        assert.equal(result.ok, true);
        assert.equal(result.limit, expected);
        assert.equal(result.tier, tier.old);
      }
    });
  }

  for (const [listingType, cap] of Object.entries(tier.caps)) {
    test(`${tier.name} Plan ${listingType}: allowed at cap, blocked above cap, no rename 503`, async () => {
      const allowed = await checkBusinessListingQuota(quotaArgs(`${tier.name} Plan`, listingType, cap - 1));
      assert.equal(allowed.ok, true);
      assert.equal(allowed.limit, cap);
      assert.equal(allowed.projected, cap);
      const blocked = await checkBusinessListingQuota(quotaArgs(`${tier.name} Plan`, listingType, cap));
      assert.equal(blocked.ok, false);
      assert.equal(blocked.status, 403);
      assert.equal(blocked.code, 'LISTING_LIMIT_REACHED');
      assert.equal(blocked.tier, tier.old);
    });
  }
}

for (const name of [null, undefined, '', 'Unknown Plan', 'Diamond Plan', 'Launching Plan']) {
  test(`unsupported plan ${JSON.stringify(name)} still fails closed`, () => {
    const result = resolvePlanListingLimit({ plan: { name, limits: storedLimits }, listingType: 'product' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'PLAN_LIMIT_CONFIGURATION_INVALID');
  });
}

for (const [listingType, field, floor] of [
  ['product', 'productListings', 50], ['service', 'serviceListings', 25], ['food', 'foodListings', 25],
]) {
  test(`Legacy Plan ${listingType}: floor and larger stored cap remain enforced`, () => {
    for (const value of [floor, floor + 7]) {
      const result = resolvePlanListingLimit({
        plan: { name: 'Legacy Plan', limits: { [field]: value } }, listingType,
      });
      assert.equal(result.ok, true);
      assert.equal(result.limit, value);
    }
    for (const value of [undefined, null, floor - 1, floor + 0.5, 'bad', Infinity]) {
      const result = resolvePlanListingLimit({
        plan: { name: 'Legacy Plan', limits: { [field]: value } }, listingType,
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, 503);
      assert.equal(result.code, 'PLAN_LIMIT_CONFIGURATION_INVALID');
    }
  });
}

test('new aliases preserve populated-plan resolution and do not mutate the plan', async () => {
  const plan = Object.freeze({ _id: 'plan-1', name: 'Growth Plan', limits: Object.freeze({ ...storedLimits }) });
  const args = quotaArgs('Growth Plan', 'service', 0);
  args.models.Subscription.findById = async () => ({ ...subscription, subscriptionPlanId: plan });
  args.models.SubscriptionPlan.findById = async () => { throw new Error('Do not re-resolve a populated plan'); };
  const result = await resolveBusinessListingEntitlement(args);
  assert.equal(result.ok, true);
  assert.equal(result.plan, plan);
  assert.equal(result.plan.name, 'Growth Plan');
  assert.equal(result.limit, 15);
});

test('new aliases preserve subscription user, business, status, and expiry checks', async () => {
  const cases = [
    [{ userId: 'other' }, 'SUBSCRIPTION_USER_MISMATCH'],
    [{ businessId: 'other' }, 'SUBSCRIPTION_BUSINESS_MISMATCH'],
    [{ status: 'cancelled' }, 'SUBSCRIPTION_INACTIVE'],
    [{ endDate: new Date(0) }, 'SUBSCRIPTION_EXPIRED'],
  ];
  for (const [overrides, code] of cases) {
    const args = quotaArgs('Launch Plan', 'food', 0);
    args.models.Subscription.findById = async () => ({ ...subscription, ...overrides });
    const result = await resolveBusinessListingEntitlement(args);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, code);
  }
});

test('aliases retain product-only overrides without changing service/food caps', async () => {
  const product = await resolveBusinessListingEntitlement(quotaArgs('Launch Plan', 'product', 0, {
    env: { PRODUCT_LISTING_LIMIT_OVERRIDE: '100' },
  }));
  assert.equal(product.ok, true);
  assert.equal(product.limit, 100);
  const development = await resolveBusinessListingEntitlement(quotaArgs('Launch Plan', 'product', 0, { nodeEnv: 'development' }));
  assert.equal(development.ok, true);
  assert.equal(development.limit, Infinity);
  for (const type of ['service', 'food']) {
    const result = await resolveBusinessListingEntitlement(quotaArgs('Launch Plan', type, 0, {
      env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' },
    }));
    assert.equal(result.ok, true);
    assert.equal(result.limit, 5);
  }
});

test('an unlimited product override cannot rescue invalid Legacy configuration', async () => {
  const args = quotaArgs('Legacy Plan', 'product', 0, { env: { PRODUCT_LISTING_LIMIT_OVERRIDE: 'unlimited' } });
  args.models.SubscriptionPlan.findById = async () => ({ name: 'Legacy Plan', limits: { productListings: 49 } });
  args.models.Product.countDocuments = async () => { throw new Error('No usage lookup after invalid entitlement'); };
  const result = await checkBusinessListingQuota(args);
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, 'PLAN_LIMIT_CONFIGURATION_INVALID');
});

test('renamed tiers preserve zero/negative delta handling after a downgrade', async () => {
  for (const attemptedIncrease of [0, -1]) {
    const args = quotaArgs('Launch Plan', 'product', 15, { attemptedIncrease });
    args.models.Subscription.findById = async () => { throw new Error('Nonincreasing changes bypass entitlement lookup'); };
    const result = await checkBusinessListingQuota(args);
    assert.equal(result.ok, true);
  }
});
