const mongoose = require('mongoose');
const Product = require('../../models/Product');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const {
  PUBLIC_PRODUCT_FILTER,
  PUBLIC_SERVICE_FILTER,
  PUBLIC_FOOD_FILTER,
} = require('../listing/publicMarketplaceStates');
const { buildAddressStateFilter } = require('./usStateMatch');

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

/**
 * Keep only businesses that own ≥1 eligible public listing for their listingType.
 * Product/service/food filters stay independent so service vendors are not
 * dropped when they lack products (and vice versa).
 *
 * @param {Array<{ _id: unknown, listingType?: string }>} candidates
 * @returns {Promise<string[]>} eligible business id strings (stable input order)
 */
async function filterDirectoryBusinessesWithPublicListings(candidates = []) {
  if (!candidates.length) return [];

  const productIds = [];
  const serviceIds = [];
  const foodIds = [];

  for (const business of candidates) {
    const id = business?._id;
    if (!id) continue;
    if (business.listingType === 'service') serviceIds.push(id);
    else if (business.listingType === 'food') foodIds.push(id);
    else productIds.push(id);
  }

  const [productOwnerIds, serviceOwnerIds, foodOwnerIds] = await Promise.all([
    productIds.length
      ? Product.distinct('businessId', {
          businessId: { $in: productIds },
          ...PUBLIC_PRODUCT_FILTER,
        })
      : [],
    serviceIds.length
      ? Service.distinct('businessId', {
          businessId: { $in: serviceIds },
          ...PUBLIC_SERVICE_FILTER,
        })
      : [],
    foodIds.length
      ? Food.distinct('businessId', {
          businessId: { $in: foodIds },
          ...PUBLIC_FOOD_FILTER,
        })
      : [],
  ]);

  const eligible = new Set(
    [...productOwnerIds, ...serviceOwnerIds, ...foodOwnerIds].map((id) =>
      String(id)
    )
  );

  return candidates
    .map((business) => String(business._id))
    .filter((id) => eligible.has(id));
}

module.exports = {
  VALID_MARKETPLACE_LISTING_TYPES,
  parseObjectIdCsv,
  resolveListingTypeFilter,
  applyListingTypeCategoryFilter,
  buildStorefrontPath,
  mapFirstListingIdByBusiness,
  filterDirectoryBusinessesWithPublicListings,
  buildAddressStateFilter,
  PUBLIC_PRODUCT_FILTER,
  PUBLIC_SERVICE_FILTER,
  PUBLIC_FOOD_FILTER,
};
