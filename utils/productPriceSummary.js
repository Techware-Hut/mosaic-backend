const mongoose = require('mongoose');
const { parseListingPrice } = require('../lib/marketplace/listingPricePolicy');

const { Decimal128 } = mongoose.Types;

// A sale price only counts when it is a finite number greater than zero.
// Decimal128("0"), 0, "", null, negative or unparseable values fall back to the
// variant's base price (a Decimal128 object is truthy, so a plain truthiness
// check would otherwise turn a $0 sale into a $0 product price).
function getVariantSummaryPrice(variant = {}) {
  const sale = parseListingPrice(variant.salePrice);
  if (sale !== null && sale > 0) return sale;

  const price = parseListingPrice(variant.price);
  return price !== null && price >= 0 ? price : null;
}

// Pure summary of the product-level price fields from a list of variants.
// Soft-deleted variants are excluded. Returns nulls when no usable variants
// remain, matching Product.price's "null if no variants yet" default.
function summarizeVariantPrices(variants = []) {
  const prices = (Array.isArray(variants) ? variants : [])
    .filter((variant) => variant && variant.isDeleted !== true)
    .map(getVariantSummaryPrice)
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
// Note: maxPrice is not currently a Product schema path, so Mongoose strict
// mode drops it on write (same as the pre-existing controller code).
async function recomputeProductPriceSummary(productId, { session } = {}) {
  // Required lazily so the pure helpers above can be unit-tested without models.
  // eslint-disable-next-line global-require
  const Product = require('../models/Product');
  // eslint-disable-next-line global-require
  const ProductVariant = require('../models/ProductVariant');

  const query = ProductVariant.find({ productId, isDeleted: { $ne: true } })
    .select('price salePrice isDeleted');
  if (session) query.session(session);
  const variants = await query;

  const summary = summarizeVariantPrices(variants);
  await Product.updateOne(
    { _id: productId },
    { $set: { price: summary.price, maxPrice: summary.maxPrice } },
    session ? { session } : {}
  );
  return summary;
}

module.exports = {
  getVariantSummaryPrice,
  summarizeVariantPrices,
  recomputeProductPriceSummary,
};
