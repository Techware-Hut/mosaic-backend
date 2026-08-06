/**
 * Product listing quota helpers (product + variant entries per subscription plan).
 * See docs/tier-listing-limit-implementation.md
 *
 * Dev/staging override:
 * - PRODUCT_LISTING_LIMIT_OVERRIDE=100 → force limit 100
 * - PRODUCT_LISTING_LIMIT_OVERRIDE=unlimited → no cap
 * - Unset + NODE_ENV !== production → unlimited (local/staging convenience)
 * - Unset + production → use the subscription plan limit
 */

function parseListingLimitOverride(raw) {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === 'unlimited' || value === 'none' || value === 'inf' || value === 'infinity') {
    return Number.POSITIVE_INFINITY;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Resolve effective product listing limit from plan + env/NODE_ENV.
 * @param {number} planLimit
 * @param {{ env?: NodeJS.ProcessEnv, nodeEnv?: string }} [options]
 * @returns {number} Finite limit, or Infinity when unlimited.
 */
function resolveProductListingLimit(planLimit, options = {}) {
  const env = options.env || process.env;
  const nodeEnv = String(options.nodeEnv ?? env.NODE_ENV ?? 'development').toLowerCase();

  const override = parseListingLimitOverride(env.PRODUCT_LISTING_LIMIT_OVERRIDE);
  if (override !== null) {
    return override;
  }

  if (nodeEnv !== 'production') {
    return Number.POSITIVE_INFINITY;
  }

  const safePlan = Number(planLimit);
  return Number.isFinite(safePlan) ? safePlan : 0;
}

function isUnlimitedListingLimit(limit) {
  return !Number.isFinite(limit) || limit === Number.POSITIVE_INFINITY;
}

async function countProductListingUsage({ Product, ProductVariant, businessId }) {
  const [productCount, variantCount] = await Promise.all([
    Product.countDocuments({ businessId, isDeleted: false }),
    ProductVariant.countDocuments({ businessId, isDeleted: false }),
  ]);

  return {
    productCount,
    variantCount,
    total: productCount + variantCount,
  };
}

function assertProductListingQuota({ total, incomingCount, limit }) {
  if (isUnlimitedListingLimit(limit)) {
    return { ok: true, unlimited: true };
  }

  const safeIncoming = Number.isFinite(incomingCount) ? incomingCount : 0;
  const safeLimit = Number.isFinite(limit) ? limit : 0;
  const projected = total + safeIncoming;

  if (projected > safeLimit) {
    const remaining = Math.max(safeLimit - total, 0);
    return {
      ok: false,
      status: 403,
      error:
        remaining === 0
          ? `Product listing limit reached. Your plan allows ${safeLimit} total product/variant entries.`
          : `Product listing limit reached. You can add only ${remaining} more product/variant entries.`,
    };
  }

  return { ok: true };
}

module.exports = {
  parseListingLimitOverride,
  resolveProductListingLimit,
  isUnlimitedListingLimit,
  countProductListingUsage,
  assertProductListingQuota,
};
