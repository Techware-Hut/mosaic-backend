const LISTING_PRICE_REQUIRED_MESSAGE =
  'A price greater than $0 is required before publishing this listing.';

const LISTING_PRICE_REQUIRED_CODE = 'LISTING_PRICE_REQUIRED';

function parseListingPrice(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'object' && value.$numberDecimal != null) {
    const parsed = Number(value.$numberDecimal);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'object' && value != null && typeof value.toString === 'function') {
    const parsed = Number(value.toString());
    if (Number.isFinite(parsed)) return parsed;
  }

  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPositiveListingPrice(value) {
  const price = parseListingPrice(value);
  return price !== null && price > 0;
}

function getVariantEffectivePrice(variant = {}) {
  const salePrice = parseListingPrice(variant.salePrice);
  if (salePrice !== null && salePrice > 0) return salePrice;

  const price = parseListingPrice(variant.price);
  if (price !== null && price > 0) return price;

  return null;
}

function getServiceEffectivePrice(service = {}) {
  const children = Array.isArray(service.services) ? service.services : [];
  const childPrices = children
    .map((child) => parseListingPrice(child?.price))
    .filter((price) => price !== null && price > 0);

  if (childPrices.length) {
    return Math.min(...childPrices);
  }

  const parentPrice = parseListingPrice(service.price);
  return parentPrice !== null && parentPrice > 0 ? parentPrice : null;
}

function productHasPublishablePrice(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const publishedVariants = variants.filter(
    (variant) => variant?.isDeleted !== true && variant?.isPublished !== false
  );

  if (publishedVariants.length) {
    return publishedVariants.some((variant) => getVariantEffectivePrice(variant) !== null);
  }

  return hasPositiveListingPrice(product.price);
}

function serviceHasPublishablePrice(service = {}) {
  return getServiceEffectivePrice(service) !== null;
}

function foodHasPublishablePrice(food = {}) {
  return hasPositiveListingPrice(food.price);
}

function validateProductPublishState({ product, variants, isPublished }) {
  if (!isPublished) {
    return { ok: true };
  }

  const candidate = {
    ...product,
    variants: Array.isArray(variants) ? variants : [],
  };

  if (!productHasPublishablePrice(candidate)) {
    return {
      ok: false,
      code: LISTING_PRICE_REQUIRED_CODE,
      message: LISTING_PRICE_REQUIRED_MESSAGE,
    };
  }

  return { ok: true };
}

function validateServicePublishState({ service, isPublished }) {
  if (!isPublished) {
    return { ok: true };
  }

  if (!serviceHasPublishablePrice(service)) {
    return {
      ok: false,
      code: LISTING_PRICE_REQUIRED_CODE,
      message: LISTING_PRICE_REQUIRED_MESSAGE,
    };
  }

  return { ok: true };
}

function validateFoodPublishState({ food, isPublished }) {
  if (!isPublished) {
    return { ok: true };
  }

  if (!foodHasPublishablePrice(food)) {
    return {
      ok: false,
      code: LISTING_PRICE_REQUIRED_CODE,
      message: LISTING_PRICE_REQUIRED_MESSAGE,
    };
  }

  return { ok: true };
}

function filterPublishableListings(listingType, listings = []) {
  const type = String(listingType || '').trim().toLowerCase();

  if (type === 'product') {
    return listings.filter((product) => productHasPublishablePrice(product));
  }

  if (type === 'service') {
    return listings.filter(
      (service) =>
        Array.isArray(service.services) &&
        service.services.length > 0 &&
        serviceHasPublishablePrice(service)
    );
  }

  if (type === 'food') {
    return listings.filter((food) => foodHasPublishablePrice(food));
  }

  return [];
}

module.exports = {
  LISTING_PRICE_REQUIRED_MESSAGE,
  LISTING_PRICE_REQUIRED_CODE,
  parseListingPrice,
  hasPositiveListingPrice,
  getVariantEffectivePrice,
  getServiceEffectivePrice,
  productHasPublishablePrice,
  serviceHasPublishablePrice,
  foodHasPublishablePrice,
  validateProductPublishState,
  validateServicePublishState,
  validateFoodPublishState,
  filterPublishableListings,
};
