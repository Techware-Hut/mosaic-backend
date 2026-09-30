"use strict";

const {
  checkBusinessListingQuota,
  countPublishedActiveUsage,
  evaluateListingQuota,
  isUnlimitedListingLimit,
  parseListingLimitOverride,
  resolveBusinessListingEntitlement,
  resolvePlanListingLimit,
  resolveProductLimitWithOverride,
} = require('../services/listingQuotaService');

/**
 * Backward-compatible product override resolver.
 *
 * NODE_ENV and legacy environment overrides are intentionally irrelevant.
 * Every environment enforces the resolved subscription-plan limit.
 * @param {number} planLimit
 * @param {{ env?: NodeJS.ProcessEnv, nodeEnv?: string }} [options]
 * @returns {number} Finite limit, or Infinity when unlimited.
 */
function resolveProductListingLimit(planLimit, options = {}) {
  return resolveProductLimitWithOverride(planLimit, options);
}

async function countProductListingUsage({ Product, businessId, excludeId }) {
  const productCount = await countPublishedActiveUsage({
    listingType: 'product',
    businessId,
    excludeId,
    models: { Product },
  });

  return {
    productCount,
    variantCount: 0,
    total: productCount,
  };
}

function assertProductListingQuota({ total, incomingCount, limit }) {
  return evaluateListingQuota({
    listingType: 'product',
    tier: 'Subscription plan',
    limit,
    current: total,
    attemptedIncrease: Number.isFinite(incomingCount) ? incomingCount : 0,
  });
}

module.exports = {
  checkBusinessListingQuota,
  countPublishedActiveUsage,
  parseListingLimitOverride,
  resolveBusinessListingEntitlement,
  resolvePlanListingLimit,
  resolveProductListingLimit,
  isUnlimitedListingLimit,
  countProductListingUsage,
  assertProductListingQuota,
  evaluateListingQuota,
};
