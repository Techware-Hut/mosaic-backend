const mongoose = require('mongoose');
const { getVariantEffectivePrice } = require('../lib/marketplace/listingPricePolicy');

const { Decimal128 } = mongoose.Types;

// Pure summary of the product-level price fields from a list of variants.
// Uses the listing policy's effective price (sale if > 0, else price if > 0,
// else null), so Decimal128("0") sales and $0 base prices never become the
// card price. Soft-deleted variants and variants without a positive price are
// skipped. Returns nulls when none remain, matching Product.price's
// "null if no variants yet" default.
function summarizeVariantPrices(variants = []) {
  const prices = (Array.isArray(variants) ? variants : [])
    .filter((variant) => variant && variant.isDeleted !== true)
    .map((variant) => getVariantEffectivePrice(variant))
    .filter((price) => price !== null);

  if (prices.length === 0) {
    return { price: null, maxPrice: null };
  }

  return {
    price: Decimal128.fromString(String(Math.min(...prices))),
    maxPrice: Decimal128.fromString(String(Math.max(...prices))),
  };
}

// Re-reads the product's non-deleted variants and persists the summary.
// Callers pass their own Product/ProductVariant models (so test doubles of the
// caller apply here too). Note: maxPrice is not currently a Product schema
// path, so Mongoose strict mode drops it on write (same as the pre-existing
// controller code).
async function recomputeProductPriceSummary(
  productId,
  { Product, ProductVariant, session } = {}
) {
  if (!Product || !ProductVariant) {
    throw new Error('recomputeProductPriceSummary requires Product and ProductVariant models');
  }

  const variants = await ProductVariant.find(
    { productId, isDeleted: { $ne: true } },
    'price salePrice isDeleted',
    session ? { session } : undefined
  );

  const summary = summarizeVariantPrices(variants);
  await Product.updateOne(
    { _id: productId },
    { $set: { price: summary.price, maxPrice: summary.maxPrice } },
    session ? { session } : {}
  );
  return summary;
}

// Best-effort variant for error paths that already wrote variants: a recompute
// failure is logged and swallowed so it never masks the caller's response.
async function recomputeProductPriceSummarySafe(productId, options) {
  try {
    return await recomputeProductPriceSummary(productId, options);
  } catch (err) {
    console.error('[product-price-summary] recompute failed:', {
      productId: String(productId),
      message: err?.message,
    });
    return null;
  }
}

module.exports = {
  summarizeVariantPrices,
  recomputeProductPriceSummary,
  recomputeProductPriceSummarySafe,
};
