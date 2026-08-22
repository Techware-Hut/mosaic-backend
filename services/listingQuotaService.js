"use strict";

const Product = require('../models/Product');
const Service = require('../models/Service');
const Food = require('../models/Food');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const {
  PUBLIC_PRODUCT_FILTER,
  PUBLIC_SERVICE_FILTER,
  PUBLIC_FOOD_FILTER,
} = require('../lib/listing/publicMarketplaceStates');
const { resolveProductListingLimit } = require('../utils/listingTierLimits');

const LISTING_LIMIT_REACHED = 'LISTING_LIMIT_REACHED';
const PLAN_LIMIT_CONFIGURATION_INVALID = 'PLAN_LIMIT_CONFIGURATION_INVALID';

const LISTING_LIMIT_FIELDS = Object.freeze({
  product: 'productListings',
  service: 'serviceListings',
  food: 'foodListings',
});

const APPROVED_TIER_LIMITS = Object.freeze({
  Silver: Object.freeze({ product: 10, service: 5, food: 5 }),
  Gold: Object.freeze({ product: 25, service: 15, food: 15 }),
  Platinum: Object.freeze({ product: 50, service: 25, food: 25 }),
});

const DEFAULT_MODELS = Object.freeze({
  Product,
  Service,
  Food,
  Subscription,
  SubscriptionPlan,
});

function normalizeListingType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'product' || type === 'products') return 'product';
  if (type === 'service' || type === 'services') return 'service';
  if (type === 'food' || type === 'foods') return 'food';
  throw new TypeError(`Unsupported listing type: ${value}`);
}

function tierFromPlanName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (name === 'silver' || name === 'silver plan') return 'Silver';
  if (name === 'gold' || name === 'gold plan') return 'Gold';
  if (name === 'platinum' || name === 'platinum plan') return 'Platinum';
  return null;
}

function idString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value._id !== undefined && value._id !== value) {
    return idString(value._id);
  }
  return String(value);
}

function sameId(left, right) {
  const leftId = idString(left);
  const rightId = idString(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function failure(status, code, message, details = {}) {
  return {
    ok: false,
    status,
    code,
    error: message,
    message,
    ...details,
  };
}

function resolvePlanListingLimit({ plan, listingType } = {}) {
  const type = normalizeListingType(listingType);
  const tier = tierFromPlanName(plan && plan.name);
  const field = LISTING_LIMIT_FIELDS[type];

  if (!tier) {
    return failure(
      503,
      PLAN_LIMIT_CONFIGURATION_INVALID,
      'Subscription plan listing limits are not configured for a supported tier.',
      { listingType: type, tier: null, field }
    );
  }

  if (tier === 'Silver' || tier === 'Gold') {
    return {
      ok: true,
      listingType: type,
      tier,
      field,
      limit: APPROVED_TIER_LIMITS[tier][type],
    };
  }

  const minimum = APPROVED_TIER_LIMITS.Platinum[type];
  const storedLimit = Number(plan && plan.limits && plan.limits[field]);
  if (!Number.isInteger(storedLimit) || storedLimit < minimum) {
    return failure(
      503,
      PLAN_LIMIT_CONFIGURATION_INVALID,
      `Platinum ${type} listing limit must be a whole number of at least ${minimum}.`,
      {
        listingType: type,
        tier,
        field,
        minimum,
      }
    );
  }

  return {
    ok: true,
    listingType: type,
    tier,
    field,
    limit: storedLimit,
  };
}

async function resolveBusinessListingEntitlement({
  business,
  userId,
  listingType,
  models = {},
  now = new Date(),
  env,
  nodeEnv,
} = {}) {
  const type = normalizeListingType(listingType);
  if (!business || business._id === undefined || business._id === null) {
    return failure(403, 'BUSINESS_REQUIRED', 'Business is required to resolve listing limits.', {
      listingType: type,
    });
  }

  if (!business.subscriptionId) {
    return failure(403, 'VALID_SUBSCRIPTION_NOT_FOUND', 'Valid subscription not found.', {
      listingType: type,
    });
  }

  const dependencies = { ...DEFAULT_MODELS, ...models };
  const subscription = await dependencies.Subscription.findById(business.subscriptionId);
  if (!subscription) {
    return failure(403, 'VALID_SUBSCRIPTION_NOT_FOUND', 'Valid subscription not found.', {
      listingType: type,
    });
  }

  if (!sameId(subscription.userId, userId)) {
    return failure(403, 'SUBSCRIPTION_USER_MISMATCH', 'The subscription does not belong to the authenticated user.', {
      listingType: type,
    });
  }

  if (subscription.status !== 'active') {
    return failure(403, 'SUBSCRIPTION_INACTIVE', 'The subscription is not active.', {
      listingType: type,
    });
  }

  const endTime = new Date(subscription.endDate).getTime();
  if (!Number.isFinite(endTime) || endTime < now.getTime()) {
    return failure(403, 'SUBSCRIPTION_EXPIRED', 'The subscription has expired.', {
      listingType: type,
    });
  }

  if (subscription.businessId && !sameId(subscription.businessId, business._id)) {
    return failure(403, 'SUBSCRIPTION_BUSINESS_MISMATCH', 'The subscription belongs to a different business.', {
      listingType: type,
    });
  }

  const planReference = subscription.subscriptionPlanId;
  const populatedPlan = planReference && typeof planReference === 'object' && planReference.name
    ? planReference
    : null;
  const plan = populatedPlan || await dependencies.SubscriptionPlan.findById(planReference);
  if (!plan) {
    return failure(503, PLAN_LIMIT_CONFIGURATION_INVALID, 'Subscription plan configuration was not found.', {
      listingType: type,
    });
  }

  const resolvedLimit = resolvePlanListingLimit({ plan, listingType: type });
  if (!resolvedLimit.ok) return resolvedLimit;

  // Preserve the legacy product-only environment policy, but only after the
  // supported tier and Platinum stored floor have been validated above.
  const effectiveLimit = type === 'product'
    ? resolveProductListingLimit(resolvedLimit.limit, { env, nodeEnv })
    : resolvedLimit.limit;

  return {
    ok: true,
    business,
    subscription,
    plan,
    listingType: type,
    tier: resolvedLimit.tier,
    limit: effectiveLimit,
  };
}

async function countPublishedActiveUsage({
  listingType,
  businessId,
  models = {},
} = {}) {
  const type = normalizeListingType(listingType);
  const dependencies = { ...DEFAULT_MODELS, ...models };

  if (type === 'product') {
    return dependencies.Product.countDocuments({
      businessId,
      ...PUBLIC_PRODUCT_FILTER,
    });
  }

  if (type === 'food') {
    return dependencies.Food.countDocuments({
      businessId,
      ...PUBLIC_FOOD_FILTER,
    });
  }

  const rows = await dependencies.Service.aggregate([
    { $match: { businessId, ...PUBLIC_SERVICE_FILTER } },
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

  const total = Number(rows && rows[0] && rows[0].total);
  return Number.isInteger(total) && total > 0 ? total : 0;
}

function evaluateListingQuota({
  listingType,
  tier,
  limit,
  current,
  attemptedIncrease,
} = {}) {
  const type = normalizeListingType(listingType);
  const safeLimit = Number(limit);
  const safeCurrent = Number(current);
  const increase = Number(attemptedIncrease);

  if (
    !Number.isFinite(safeLimit) || safeLimit < 0 ||
    !Number.isInteger(safeCurrent) || safeCurrent < 0 ||
    !Number.isInteger(increase)
  ) {
    return failure(500, 'LISTING_QUOTA_EVALUATION_INVALID', 'Listing quota inputs are invalid.', {
      listingType: type,
      tier,
    });
  }

  const projected = safeCurrent + increase;
  const remaining = Math.max(safeLimit - safeCurrent, 0);
  const details = {
    listingType: type,
    tier,
    limit: safeLimit,
    current: safeCurrent,
    attemptedIncrease: increase,
    projected,
    remaining,
  };

  if (increase <= 0 || projected <= safeLimit) {
    return { ok: true, ...details };
  }

  const label = type === 'food' ? 'Food' : `${type[0].toUpperCase()}${type.slice(1)}`;
  return failure(
    403,
    LISTING_LIMIT_REACHED,
    `${label} listing limit reached for ${tier}. Limit ${safeLimit}, current ${safeCurrent}, attempted increase ${increase}.`,
    details
  );
}

async function checkBusinessListingQuota({
  business,
  userId,
  listingType,
  attemptedIncrease,
  models = {},
  now = new Date(),
  env,
  nodeEnv,
} = {}) {
  const type = normalizeListingType(listingType);
  const increase = Number(attemptedIncrease);
  if (!Number.isInteger(increase)) {
    return failure(500, 'LISTING_QUOTA_DELTA_INVALID', 'Listing quota increase must be a whole number.', {
      listingType: type,
    });
  }

  if (increase <= 0) {
    return {
      ok: true,
      listingType: type,
      attemptedIncrease: increase,
    };
  }

  const entitlement = await resolveBusinessListingEntitlement({
    business,
    userId,
    listingType: type,
    models,
    now,
    env,
    nodeEnv,
  });
  if (!entitlement.ok) return entitlement;

  if (entitlement.limit === Number.POSITIVE_INFINITY) {
    return {
      ok: true,
      listingType: type,
      tier: entitlement.tier,
      limit: Number.POSITIVE_INFINITY,
      current: null,
      attemptedIncrease: increase,
      projected: null,
      remaining: Number.POSITIVE_INFINITY,
      unlimited: true,
      entitlement,
    };
  }

  const current = await countPublishedActiveUsage({
    listingType: type,
    businessId: business._id,
    models,
  });
  const result = evaluateListingQuota({
    listingType: type,
    tier: entitlement.tier,
    limit: entitlement.limit,
    current,
    attemptedIncrease: increase,
  });

  return { ...result, entitlement };
}

module.exports = {
  APPROVED_TIER_LIMITS,
  LISTING_LIMIT_REACHED,
  PLAN_LIMIT_CONFIGURATION_INVALID,
  checkBusinessListingQuota,
  countPublishedActiveUsage,
  evaluateListingQuota,
  normalizeListingType,
  resolveBusinessListingEntitlement,
  resolvePlanListingLimit,
  tierFromPlanName,
};
