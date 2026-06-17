/**
 * Product listing quota helpers (product + variant entries per subscription plan).
 * See docs/tier-listing-limit-implementation.md
 */

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
  countProductListingUsage,
  assertProductListingQuota,
};
