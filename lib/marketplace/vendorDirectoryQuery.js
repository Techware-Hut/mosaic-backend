const mongoose = require('mongoose');

const VALID_MARKETPLACE_LISTING_TYPES = Object.freeze(['product', 'service', 'food']);

function parseObjectIdCsv(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => mongoose.Types.ObjectId.isValid(item))
    .map((item) => new mongoose.Types.ObjectId(item));
}

function resolveListingTypeFilter(listingType) {
  const normalized = String(listingType || '').trim().toLowerCase();
  if (VALID_MARKETPLACE_LISTING_TYPES.includes(normalized)) {
    return normalized;
  }
  return { $in: [...VALID_MARKETPLACE_LISTING_TYPES] };
}

function applyListingTypeCategoryFilter(filters, listingType, query = {}) {
  const {
    productCategory,
    serviceCategory,
    foodCategory,
  } = query;

  const activeListingType =
    typeof listingType === 'string' ? listingType : null;

  if (activeListingType === 'product' || !activeListingType) {
    const productCategoryIds = parseObjectIdCsv(productCategory);
    if (productCategoryIds.length) {
      filters.productCategories = { $in: productCategoryIds };
    }
  }

  if (activeListingType === 'service' || !activeListingType) {
    const serviceCategoryIds = parseObjectIdCsv(serviceCategory);
    if (serviceCategoryIds.length) {
      filters.serviceCategories = { $in: serviceCategoryIds };
    }
  }

  if (activeListingType === 'food' || !activeListingType) {
    const foodCategoryIds = parseObjectIdCsv(foodCategory);
    if (foodCategoryIds.length) {
      filters.foodCategories = { $in: foodCategoryIds };
    }
  }
}

function buildStorefrontPath(listingType, businessId, listingId) {
  const businessKey = String(businessId);
  if (listingType === 'service') {
    return listingId ? `/vendor-profile/service-vendor/${listingId}` : null;
  }
  if (listingType === 'food') {
    return listingId ? `/vendor-profile/food-vendor/${listingId}` : null;
  }
  return `/vendor-profile/product-vendor/${businessKey}`;
}

function mapFirstListingIdByBusiness(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const businessId = String(row.businessId?._id || row.businessId || '');
    if (!businessId || map.has(businessId)) continue;
    map.set(businessId, String(row._id));
  }
  return map;
}

module.exports = {
  VALID_MARKETPLACE_LISTING_TYPES,
  parseObjectIdCsv,
  resolveListingTypeFilter,
  applyListingTypeCategoryFilter,
  buildStorefrontPath,
  mapFirstListingIdByBusiness,
};
