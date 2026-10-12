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

const LISTING_LIMIT_REACHED = 'LISTING_LIMIT_REACHED';

const LISTING_TYPE_LIMIT_FIELDS = Object.freeze({
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
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'product' || normalized === 'products') return 'product';
  if (normalized === 'service' || normalized === 'services') return 'service';
  if (normalized === 'food' || normalized === 'foods') return 'food';
  throw new TypeError(`Unsupported listing type: ${value}`);
}

function tierFromPlanName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (normalized === 'silver' || normalized === 'silver plan') return 'Silver';
  if (normalized === 'gold' || normalized === 'gold plan') return 'Gold';
  if (normalized === 'platinum' || normalized === 'platinum plan') return 'Platinum';
  return null;
}

function parseListingLimitOverride(raw) {
  if (raw === undefined || raw === null) return null;

  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === 'unlimited' || value === 'none' || value === 'inf' || value === 'infinity') {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function resolveProductLimitWithOverride(planLimit) {
  if (planLimit === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number(planLimit);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function hasStoredLimit(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Resolve the approved effective limit from SubscriptionPlan.name.
 * Silver and Gold are exact business-rule values. Platinum values may be
 * raised in the stored plan, but are never lowered below the approved floor.
 * A missing Platinum value is intentionally unlimited: 50+/25+/25+ does not
 * authorize inventing a finite technical cap.
 */
function resolvePlanListingLimit({ plan, listingType } = {}) {
  const type = normalizeListingType(listingType);
  const tier = tierFromPlanName(plan && plan.name);
  const field = LISTING_TYPE_LIMIT_FIELDS[type];
  const storedValue = plan && plan.limits ? plan.limits[field] : undefined;

  let limit;
  if (tier === 'Silver' || tier === 'Gold') {
    limit = APPROVED_TIER_LIMITS[tier][type];
  } else if (tier === 'Platinum') {
    if (!hasStoredLimit(storedValue) || !Number.isFinite(Number(storedValue))) {
      limit = Number.POSITIVE_INFINITY;
    } else {
      limit = Math.max(APPROVED_TIER_LIMITS.Platinum[type], Number(storedValue));
    }
  } else {
    const parsed = Number(storedValue);
    limit = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  return type === 'product' ? resolveProductLimitWithOverride(limit) : limit;
}

function idString(value) {
  if (value === undefined || value === null) return null;
  // Mongoose ObjectId exposes an `_id` getter that returns itself. Guard that
  // identity before unwrapping populated documents to avoid infinite recursion.
  if (
    typeof value === 'object' &&
    value._id !== undefined &&
    value._id !== value
  ) {
    return idString(value._id);
  }
  return String(value);
}

function sameId(left, right) {
  const leftId = idString(left);
  const rightId = idString(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function entitlementFailure(code, message) {
  return {
    ok: false,
    code,
    status: 403,
    error: message,
    message,
  };
}

function validateSubscriptionForBusiness({ subscription, business, userId, now }) {
  if (!subscription) {
    return entitlementFailure('VALID_SUBSCRIPTION_NOT_FOUND', 'Valid subscription not found.');
  }

  if (!sameId(subscription.userId, userId)) {
    return entitlementFailure(
      'SUBSCRIPTION_USER_MISMATCH',
      'The subscription does not belong to the authenticated user.'
    );
  }

  if (subscription.status !== 'active') {
    return entitlementFailure('SUBSCRIPTION_INACTIVE', 'The subscription is not active.');
  }

  const endTime = new Date(subscription.endDate).getTime();
  if (!Number.isFinite(endTime) || endTime < now.getTime()) {
    return entitlementFailure('SUBSCRIPTION_EXPIRED', 'The subscription has expired.');
  }

  if (
    subscription.businessId !== undefined &&
    subscription.businessId !== null &&
    !sameId(subscription.businessId, business._id)
  ) {
    return entitlementFailure(
      'SUBSCRIPTION_BUSINESS_MISMATCH',
      'The subscription belongs to a different business.'
    );
  }

  return { ok: true };
}

async function awaitSortedLatest(query) {
  if (query && typeof query.sort === 'function') {
    return query.sort({ createdAt: -1 });
  }
  return query;
}

/**
 * Resolve the subscription/plan that belongs to this exact Business.
 *
 * The Business.subscriptionId reference is authoritative when it resolves.
 * A businessId lookup is only a compatibility fallback for a missing/dangling
 * legacy reference. An invalid exact subscription never falls through to a
 * different subscription. Payment status is deliberately not inspected so
 * this preserves the existing active/nonexpired behavior.
 */
async function resolveBusinessListingEntitlement({
  business,
  userId,
  listingType,
  models = {},
  now = new Date(),
  env,
} = {}) {
  if (!business || business._id === undefined || business._id === null) {
    return entitlementFailure('BUSINESS_REQUIRED', 'Business is required to resolve listing limits.');
  }

  const dependencies = { ...DEFAULT_MODELS, ...models };
  const referenceId = business.subscriptionId;
  let subscription = null;
  let source = null;

  if (referenceId !== undefined && referenceId !== null) {
    subscription = await dependencies.Subscription.findById(referenceId);
    if (subscription) {
      source = 'business.subscriptionId';
      const validation = validateSubscriptionForBusiness({ subscription, business, userId, now });
      if (!validation.ok) return validation;
    }
  }

  if (!subscription) {
    const fallbackQuery = dependencies.Subscription.findOne({
      businessId: business._id,
      userId,
      status: 'active',
      endDate: { $gte: now },
    });
    subscription = await awaitSortedLatest(fallbackQuery);
    source = 'subscription.businessId';

    const validation = validateSubscriptionForBusiness({ subscription, business, userId, now });
    if (!validation.ok) return validation;
  }

  const planReference = subscription.subscriptionPlanId;
  const populatedPlan =
    planReference && typeof planReference === 'object' && planReference.name
      ? planReference
      : null;
  const plan = populatedPlan || await dependencies.SubscriptionPlan.findById(planReference);
  if (!plan) {
    return entitlementFailure('SUBSCRIPTION_PLAN_NOT_FOUND', 'Subscription plan not found.');
  }

  const tier = tierFromPlanName(plan.name) || String(plan.name || 'Unknown');
  const limits = {
    product: resolvePlanListingLimit({ plan, listingType: 'product', env }),
    service: resolvePlanListingLimit({ plan, listingType: 'service', env }),
    food: resolvePlanListingLimit({ plan, listingType: 'food', env }),
  };

  const result = {
    ok: true,
    source,
    subscription,
    plan,
    tier,
    limits,
  };

  if (listingType !== undefined && listingType !== null) {
    const type = normalizeListingType(listingType);
    result.listingType = type;
    result.limit = limits[type];
  }

  return result;
}

function withOptionalExclusion(query, excludeId) {
  if (excludeId === undefined || excludeId === null) return query;
  return { ...query, _id: { $ne: excludeId } };
}

/**
 * Count only listings that consume approved quota.
 * Products are parent Product documents; variants never consume product quota.
 * Services are embedded offerings under eligible public parent documents.
 */
async function countPublishedActiveUsage({
  listingType,
  businessId,
  excludeId,
  models = {},
} = {}) {
  const type = normalizeListingType(listingType);
  const dependencies = { ...DEFAULT_MODELS, ...models };

  if (type === 'product') {
    const query = withOptionalExclusion(
      { businessId, ...PUBLIC_PRODUCT_FILTER },
      excludeId
    );
    return dependencies.Product.countDocuments(query);
  }

  if (type === 'food') {
    const query = withOptionalExclusion(
      { businessId, ...PUBLIC_FOOD_FILTER },
      excludeId
    );
    return dependencies.Food.countDocuments(query);
  }

  const match = withOptionalExclusion(
    { businessId, ...PUBLIC_SERVICE_FILTER },
    excludeId
  );
  const rows = await dependencies.Service.aggregate([
    { $match: match },
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
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function isUnlimitedListingLimit(limit) {
  return limit === Number.POSITIVE_INFINITY;
}

function nonNegativeFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function attemptedIncreaseValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listingLabel(type) {
  return type === 'food' ? 'Food' : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function evaluateListingQuota({
  listingType,
  tier,
  limit,
  current,
  attemptedIncrease = 1,
} = {}) {
  const type = normalizeListingType(listingType);
  const safeCurrent = nonNegativeFinite(current);
  const safeIncrease = attemptedIncreaseValue(attemptedIncrease);
  const unlimited = isUnlimitedListingLimit(limit);
  const safeLimit = unlimited ? Number.POSITIVE_INFINITY : nonNegativeFinite(limit);
  const remaining = unlimited ? Number.POSITIVE_INFINITY : Math.max(safeLimit - safeCurrent, 0);

  const base = {
    listingType: type,
    tier,
    limit: safeLimit,
    current: safeCurrent,
    attemptedIncrease: safeIncrease,
    remaining,
  };

  // Editing, unpublishing, deleting, and other non-increasing changes remain
  // legal even when a downgrade leaves current usage above the new limit.
  if (safeIncrease <= 0 || unlimited || safeCurrent + safeIncrease <= safeLimit) {
    return { ok: true, ...base, unlimited };
  }

  const message = `${listingLabel(type)} listing limit reached for ${tier}. ` +
    `Limit ${safeLimit}, current ${safeCurrent}, attempted increase ${safeIncrease}.`;

  return {
    ok: false,
    code: LISTING_LIMIT_REACHED,
    status: 403,
    ...base,
    error: message,
    message,
  };
}

async function checkBusinessListingQuota({
  business,
  userId,
  listingType,
  attemptedIncrease = 1,
  excludeId,
  models = {},
  now = new Date(),
  env,
} = {}) {
  const entitlement = await resolveBusinessListingEntitlement({
    business,
    userId,
    listingType,
    models,
    now,
    env,
  });
  if (!entitlement.ok) return entitlement;

  const current = await countPublishedActiveUsage({
    listingType: entitlement.listingType,
    businessId: business._id,
    excludeId,
    models,
  });
  const result = evaluateListingQuota({
    listingType: entitlement.listingType,
    tier: entitlement.tier,
    limit: entitlement.limit,
    current,
    attemptedIncrease,
  });

  return { ...result, entitlement };
}

module.exports = {
  APPROVED_TIER_LIMITS,
  LISTING_LIMIT_REACHED,
  LISTING_TYPE_LIMIT_FIELDS,
  checkBusinessListingQuota,
  countPublishedActiveUsage,
  evaluateListingQuota,
  isUnlimitedListingLimit,
  normalizeListingType,
  parseListingLimitOverride,
  resolveBusinessListingEntitlement,
  resolvePlanListingLimit,
  resolveProductLimitWithOverride,
  tierFromPlanName,
  validateSubscriptionForBusiness,
};
