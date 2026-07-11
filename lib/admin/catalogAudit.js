const {
  productHasPublishablePrice,
  serviceHasPublishablePrice,
  foodHasPublishablePrice,
  parseListingPrice,
} = require('../marketplace/listingPricePolicy');

const PLACEHOLDER_TITLES = new Set(['product', 'service', 'food']);
const MIN_DESCRIPTION_LENGTH = 10;

const CATALOG_AUDIT_FLAGS = Object.freeze([
  'missing_description',
  'missing_image',
  'missing_price',
  'suspicious_title',
  'published_incomplete',
]);

function isBlankImage(value) {
  const url = String(value || '').trim();
  if (!url) return true;
  if (url === 'null' || url === 'undefined') return true;
  return /^https?:\/\/via\.placeholder\.com/i.test(url);
}

function hasSuspiciousTitle(title, listingType) {
  const normalized = String(title || '').trim();
  if (normalized.length < 3) return true;
  if (PLACEHOLDER_TITLES.has(normalized.toLowerCase())) return true;
  if (listingType && normalized.toLowerCase() === String(listingType).toLowerCase()) return true;
  return false;
}

function evaluateCatalogListingFlags(listing, listingType, options = {}) {
  const flags = [];
  const description = String(listing?.description || '').trim();

  if (description.length < MIN_DESCRIPTION_LENGTH) {
    flags.push('missing_description');
  }

  if (isBlankImage(listing?.coverImage)) {
    flags.push('missing_image');
  }

  if (listingType === 'product') {
    if (!productHasPublishablePrice({
      ...listing,
      variants: options.variants || [],
    })) {
      flags.push('missing_price');
    }
  } else if (listingType === 'service') {
    if (!serviceHasPublishablePrice(listing)) {
      flags.push('missing_price');
    }
  } else if (listingType === 'food') {
    if (!foodHasPublishablePrice(listing)) {
      flags.push('missing_price');
    }
  }

  if (hasSuspiciousTitle(listing?.title, listingType)) {
    flags.push('suspicious_title');
  }

  if (listing?.isPublished === true && flags.length > 0) {
    flags.push('published_incomplete');
  }

  return flags;
}

function severityFromFlags(flags = []) {
  if (flags.includes('published_incomplete')) return 'high';
  if (flags.includes('missing_price') || flags.includes('missing_image')) return 'medium';
  if (flags.length) return 'low';
  return 'none';
}

function matchesRequestedFlags(flags, requestedFlags = []) {
  if (!requestedFlags.length) return flags.length > 0;
  return requestedFlags.some((flag) => flags.includes(flag));
}

function buildAuditItem(listing, listingType, options = {}) {
  const flags = evaluateCatalogListingFlags(listing, listingType, options);
  const business = listing.businessId;

  return {
    listingType,
    id: String(listing._id),
    title: listing.title || '',
    description: listing.description || '',
    coverImage: listing.coverImage || '',
    price: parseListingPrice(listing?.price),
    isPublished: Boolean(listing.isPublished),
    isActive: listing.isActive !== false,
    businessId: business?._id ? String(business._id) : listing.businessId ? String(listing.businessId) : null,
    businessName: business?.businessName || business?.name || null,
    flags,
    severity: severityFromFlags(flags),
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

module.exports = {
  CATALOG_AUDIT_FLAGS,
  MIN_DESCRIPTION_LENGTH,
  evaluateCatalogListingFlags,
  severityFromFlags,
  matchesRequestedFlags,
  buildAuditItem,
};
