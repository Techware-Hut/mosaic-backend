"use strict";

/**
 * Public marketplace states helper.
 *
 * Single source of truth for the homepage/marketplace "Filter by state"
 * dropdown. Returns the unique, normalized list of state values that can
 * actually produce public results: the vendor Business must be approved and
 * active (publicMarketplaceBusinessFilter) AND own at least one eligible
 * public listing (published, not deleted, not inactive product/service/food).
 *
 * Draft, rejected, inactive, deleted, or hidden records never contribute a
 * state value, and a state with no eligible public results is absent.
 */
const Business = require('../../models/Business');
const Product = require('../../models/Product');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const {
  publicMarketplaceBusinessFilter,
} = require('../marketplace/businessEligibility');

// Mirrors the visibility rules used by the public list endpoints in
// controllers/publicListing.js (getAllProducts / getAllServices / getAllFood).
const PUBLIC_PRODUCT_FILTER = Object.freeze({
  isDeleted: false,
  isPublished: true,
  isActive: { $ne: false },
});
const PUBLIC_SERVICE_FILTER = Object.freeze({
  isPublished: true,
  isActive: { $ne: false },
});
const PUBLIC_FOOD_FILTER = Object.freeze({
  isPublished: true,
  isActive: { $ne: false },
});

function normalizeStateValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {Promise<string[]>} unique normalized state labels, sorted A-Z.
 */
async function getPublicMarketplaceStates() {
  const businesses = await Business.find(publicMarketplaceBusinessFilter())
    .select('_id address.state')
    .lean();

  if (!businesses.length) return [];

  const visibleIds = businesses.map((business) => business._id);

  const [productOwnerIds, serviceOwnerIds, foodOwnerIds] = await Promise.all([
    Product.distinct('businessId', {
      businessId: { $in: visibleIds },
      ...PUBLIC_PRODUCT_FILTER,
    }),
    Service.distinct('businessId', {
      businessId: { $in: visibleIds },
      ...PUBLIC_SERVICE_FILTER,
    }),
    Food.distinct('businessId', {
      businessId: { $in: visibleIds },
      ...PUBLIC_FOOD_FILTER,
    }),
  ]);

  const eligibleOwnerIds = new Set(
    [...productOwnerIds, ...serviceOwnerIds, ...foodOwnerIds].map((id) => String(id))
  );

  // Case-insensitive dedupe; the first-seen casing is kept as the label.
  const seenLowercaseKeys = new Set();
  const states = [];
  for (const business of businesses) {
    if (!eligibleOwnerIds.has(String(business._id))) continue;

    const label = normalizeStateValue(business.address && business.address.state);
    if (!label) continue;

    const key = label.toLowerCase();
    if (seenLowercaseKeys.has(key)) continue;

    seenLowercaseKeys.add(key);
    states.push(label);
  }

  return states.sort((a, b) => a.localeCompare(b));
}

module.exports = {
  getPublicMarketplaceStates,
  normalizeStateValue,
  PUBLIC_PRODUCT_FILTER,
  PUBLIC_SERVICE_FILTER,
  PUBLIC_FOOD_FILTER,
};
