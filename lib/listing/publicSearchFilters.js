/**
 * Public marketplace search/filter helpers.
 * No geospatial radius, lat/lng, or fake distance fields — ZIP exact match only.
 */
const mongoose = require('mongoose');
const Business = require('../../models/Business');
const VendorOnboardingStage1 = require('../../models/VendorOnboardingStage1');
const MinorityType = require('../../models/MinorityType');
const {
  publicMarketplaceBusinessFilter,
} = require('../marketplace/businessEligibility');

const GEO_UNSUPPORTED_KEYS = ['radius', 'lat', 'lng', 'nearMe', 'nearme', 'longitude', 'latitude'];
const BADGE_VALUE_MAP = Object.freeze({
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
});

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordRegex(value = '') {
  return new RegExp(escapeRegex(String(value).trim()), 'i');
}

function buildFlexibleMatchRegex(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/[-_,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ').filter(Boolean);

  if (tokens.length > 1) {
    return new RegExp(tokens.map(escapeRegex).join('[\\s,-]*'), 'i');
  }

  if (normalized.length >= 5) {
    return new RegExp(normalized.split('').map(escapeRegex).join('[\\s,-]*'), 'i');
  }

  return new RegExp(escapeRegex(normalized), 'i');
}

function normalizeZip(value = '') {
  return String(value || '').trim();
}

function parseTagList(tag, tags) {
  const raw = String((tags && String(tags).trim()) || (tag && String(tag).trim()) || '').trim();
  if (!raw) return [];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function parsePublicSearchQuery(query = {}) {
  const keyword = String(query.keyword || query.search || '').trim();
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(50, parseInt(query.limit, 10) || 10));
  const listingType = String(query.listingType || 'all').trim().toLowerCase();

  return {
    keyword,
    location: String(query.location || '').trim(),
    city: String(query.city || '').trim(),
    state: String(query.state || '').trim(),
    country: String(query.country || '').trim(),
    zip: normalizeZip(query.zip),
    minorityType: String(query.minorityType || '').trim(),
    categoryId: query.categoryId ? String(query.categoryId).trim() : '',
    categorySlug: String(query.categorySlug || '').trim(),
    tag: String(query.tag || '').trim(),
    tags: String(query.tags || '').trim(),
    verified: String(query.verified || '').trim().toLowerCase() === 'true',
    listingType: ['product', 'service', 'food', 'all'].includes(listingType) ? listingType : 'all',
    page,
    limit,
  };
}

function detectUnsupportedGeoParams(query = {}) {
  const unsupported = [];
  for (const key of GEO_UNSUPPORTED_KEYS) {
    if (query[key] != null && String(query[key]).trim() !== '') {
      unsupported.push({
        param: key,
        reason: 'geolocation not implemented',
      });
    }
  }
  return unsupported;
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (mongoose.Types.ObjectId.isValid(String(id))) {
    return new mongoose.Types.ObjectId(String(id));
  }
  return null;
}

function intersectBusinessIdSets(...sets) {
  const normalized = sets
    .filter((set) => Array.isArray(set))
    .map((set) => new Set(set.map((id) => String(id))));

  if (!normalized.length) return null;
  const [first, ...rest] = normalized;
  const result = [...first].filter((id) => rest.every((set) => set.has(id)));
  return result.map((id) => new mongoose.Types.ObjectId(id));
}

function shouldIncludeListingType(listingType, type) {
  if (listingType === 'all') return true;
  return listingType === type;
}

async function filterPublicMarketplaceBusinessIds(ids = []) {
  const objectIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))]
    .map((id) => toObjectId(id))
    .filter(Boolean);

  if (!objectIds.length) return [];

  const businesses = await Business.find(
    publicMarketplaceBusinessFilter({ _id: { $in: objectIds } })
  ).select('_id').lean();

  return businesses.map((business) => business._id);
}

async function resolveBusinessIdsByKeyword(keyword) {
  const keywordRegex = buildFlexibleMatchRegex(keyword);
  if (!keywordRegex) return [];

  const [businessMatches, vendorMatches] = await Promise.all([
    Business.find(publicMarketplaceBusinessFilter({
      $or: [
        { businessName: keywordRegex },
        { description: keywordRegex },
        { tags: keywordRegex },
      ],
    })).select('_id').lean(),
    VendorOnboardingStage1.find({
      businessId: { $exists: true, $ne: null },
      $or: [
        { businessName: keywordRegex },
        { businessBio: keywordRegex },
      ],
    }).select('businessId').lean(),
  ]);

  const vendorBusinessIds = vendorMatches
    .map((item) => item.businessId?.toString())
    .filter(Boolean);
  if (!vendorBusinessIds.length) {
    return businessMatches.map((item) => item._id);
  }

  const ids = [...new Set([
    ...businessMatches.map((item) => item._id.toString()),
    ...vendorBusinessIds,
  ])];

  return filterPublicMarketplaceBusinessIds(ids);
}

async function resolveBusinessIdsByTags(tag, tags) {
  const tagList = parseTagList(tag, tags);
  if (!tagList.length) return null;

  const matches = await Business.find(publicMarketplaceBusinessFilter({
    $or: tagList.map((item) => ({ tags: new RegExp(`^${escapeRegex(item)}$`, 'i') })),
  })).select('_id').lean();

  return matches.map((business) => business._id);
}

async function resolveVerifiedBusinessIds() {
  const rows = await VendorOnboardingStage1.find({
    status: 'verified',
    businessId: { $exists: true, $ne: null },
  }).select('businessId').lean();

  return filterPublicMarketplaceBusinessIds(
    rows.map((row) => row.businessId?.toString()).filter(Boolean)
  );
}

async function resolveBusinessIdsByZip(zip) {
  const normalizedZip = normalizeZip(zip);
  if (!normalizedZip) return null;

  const zipRegex = new RegExp(`^${escapeRegex(normalizedZip)}$`, 'i');
  const [businessMatches, vendorMatches] = await Promise.all([
    Business.find(publicMarketplaceBusinessFilter({
      'address.zipCode': zipRegex,
    })).select('_id').lean(),
    VendorOnboardingStage1.find({
      businessId: { $exists: true, $ne: null },
      'address.zipCode': zipRegex,
    }).select('businessId').lean(),
  ]);

  const vendorBusinessIds = vendorMatches
    .map((item) => item.businessId?.toString())
    .filter(Boolean);
  if (!vendorBusinessIds.length) {
    return businessMatches.map((item) => item._id);
  }

  const ids = [...new Set([
    ...businessMatches.map((item) => item._id.toString()),
    ...vendorBusinessIds,
  ])];

  return filterPublicMarketplaceBusinessIds(ids);
}

async function resolveBusinessIdsByDedicatedLocation({ city, state, country }) {
  const clauses = [];
  if (city) clauses.push({ 'address.city': buildFlexibleMatchRegex(city) });
  if (state) clauses.push({ 'address.state': buildFlexibleMatchRegex(state) });
  if (country) clauses.push({ 'address.country': buildFlexibleMatchRegex(country) });

  if (!clauses.length) return null;

  const businessFilter = publicMarketplaceBusinessFilter({ $and: clauses });
  const vendorFilter = {
    businessId: { $exists: true, $ne: null },
    $and: clauses.map((clause) => {
      const key = Object.keys(clause)[0];
      return { [key]: clause[key] };
    }),
  };

  const [businessMatches, vendorMatches] = await Promise.all([
    Business.find(businessFilter).select('_id').lean(),
    VendorOnboardingStage1.find(vendorFilter).select('businessId').lean(),
  ]);

  const vendorBusinessIds = vendorMatches
    .map((item) => item.businessId?.toString())
    .filter(Boolean);
  if (!vendorBusinessIds.length) {
    return businessMatches.map((item) => item._id);
  }

  const ids = [...new Set([
    ...businessMatches.map((item) => item._id.toString()),
    ...vendorBusinessIds,
  ])];

  return filterPublicMarketplaceBusinessIds(ids);
}

async function resolveBusinessIdsForMinorityType(minorityType) {
  if (!minorityType) return null;

  const normalizedMinority = minorityType.replace(/-/g, ' ').trim();
  const minorityRegex = buildFlexibleMatchRegex(normalizedMinority);

  let minorityTypeIds = [];
  if (mongoose.Types.ObjectId.isValid(minorityType)) {
    minorityTypeIds.push(new mongoose.Types.ObjectId(minorityType));
  }

  const minorityMatches = await MinorityType.find({
    name: minorityRegex,
    isActive: true,
  }).select('_id').lean();

  minorityTypeIds.push(...minorityMatches.map((item) => item._id));
  minorityTypeIds = [...new Set(minorityTypeIds.map((id) => id.toString()))]
    .map((id) => new mongoose.Types.ObjectId(id));

  const [businessMinorityMatches, vendorMinorityMatches] = await Promise.all([
    Business.find(publicMarketplaceBusinessFilter({
      ...(minorityTypeIds.length ? { minorityType: { $in: minorityTypeIds } } : { _id: null }),
    })).select('_id').lean(),
    VendorOnboardingStage1.find({
      businessId: { $exists: true, $ne: null },
      minorityCategories: { $elemMatch: { $regex: minorityRegex } },
    }).select('businessId').lean(),
  ]);

  const vendorBusinessIds = vendorMinorityMatches
    .map((item) => item.businessId?.toString())
    .filter(Boolean);
  if (!vendorBusinessIds.length) {
    return businessMinorityMatches.map((item) => item._id);
  }

  const ids = [...new Set([
    ...businessMinorityMatches.map((item) => item._id.toString()),
    ...vendorBusinessIds,
  ])];

  return filterPublicMarketplaceBusinessIds(ids);
}

async function resolveBusinessIdsByLocation({ location, city, state, country, zip }) {
  const sets = [];

  const zipIds = await resolveBusinessIdsByZip(zip);
  if (zip != null && String(zip).trim() !== '') {
    sets.push(zipIds || []);
  }

  const dedicatedIds = await resolveBusinessIdsByDedicatedLocation({ city, state, country });
  if (dedicatedIds) sets.push(dedicatedIds);

  const locationText = String(location || '').trim();
  if (locationText) {
    const locationRegex = buildFlexibleMatchRegex(locationText);
    const [businessLocationMatches, vendorLocationMatches] = await Promise.all([
      Business.find(publicMarketplaceBusinessFilter({
        $or: [
          { businessName: locationRegex },
          { 'address.street': locationRegex },
          { 'address.city': locationRegex },
          { 'address.state': locationRegex },
          { 'address.country': locationRegex },
          { 'address.zipCode': locationRegex },
        ],
      })).select('_id').lean(),
      VendorOnboardingStage1.find({
        businessId: { $exists: true, $ne: null },
        $or: [
          { businessName: locationRegex },
          { 'address.street': locationRegex },
          { 'address.city': locationRegex },
          { 'address.state': locationRegex },
          { 'address.country': locationRegex },
          { 'address.zipCode': locationRegex },
        ],
      }).select('businessId').lean(),
    ]);

    const vendorBusinessIds = vendorLocationMatches
      .map((item) => item.businessId?.toString())
      .filter(Boolean);
    if (!vendorBusinessIds.length) {
      sets.push(businessLocationMatches.map((item) => item._id));
    } else {
      sets.push(await filterPublicMarketplaceBusinessIds([...new Set([
        ...businessLocationMatches.map((item) => item._id.toString()),
        ...vendorBusinessIds,
      ])]));
    }
  }

  if (!sets.length) return null;
  return intersectBusinessIdSets(...sets);
}

async function resolveCombinedBusinessFilters({
  location,
  city,
  state,
  country,
  zip,
  minorityType,
  tag,
  tags,
  verified,
}) {
  const sets = [];

  const locationIds = await resolveBusinessIdsByLocation({ location, city, state, country, zip });
  if (locationIds) sets.push(locationIds);

  const minorityIds = await resolveBusinessIdsForMinorityType(minorityType);
  if (minorityIds) sets.push(minorityIds);

  const tagIds = await resolveBusinessIdsByTags(tag, tags);
  if (tagIds) sets.push(tagIds);

  if (verified) {
    sets.push(await resolveVerifiedBusinessIds());
  }

  if (!sets.length) return null;
  return intersectBusinessIdSets(...sets);
}

async function loadVerifiedByBusinessIds(businessIds = []) {
  const ids = [...new Set(businessIds.map((id) => String(id)).filter(Boolean))];
  const map = new Map(ids.map((id) => [id, null]));
  if (!ids.length) return map;

  const objectIds = ids.map((id) => toObjectId(id)).filter(Boolean);
  const rows = await VendorOnboardingStage1.find({
    businessId: { $in: objectIds },
  }).select('businessId status').lean();

  for (const row of rows) {
    const key = String(row.businessId);
    if (!map.has(key)) continue;
    map.set(key, row.status === 'verified');
  }

  return map;
}

async function loadTagsByBusinessIds(businessIds = []) {
  const ids = [...new Set(businessIds.map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const objectIds = ids.map((id) => toObjectId(id)).filter(Boolean);
  const rows = await Business.find({ _id: { $in: objectIds } }).select('_id tags').lean();
  for (const row of rows) {
    map.set(String(row._id), Array.isArray(row.tags) ? row.tags : []);
  }
  return map;
}

/**
 * Apply optional tag/zip/verified/location filters against visible business IDs.
 * Returns { empty: true } when intersection is empty, or { businessIds: string[] }.
 */
async function narrowVisibleBusinessIds(visibleBusinessIds, query = {}, options = {}) {
  const includeLocation = options.includeLocation === true;
  const {
    tag,
    tags,
    zip,
    verified,
    city,
    state,
    country,
  } = query;

  const hasBusinessFilters = parseTagList(tag, tags).length
    || normalizeZip(zip)
    || String(verified || '').toLowerCase() === 'true'
    || (includeLocation && (
      String(city || '').trim()
      || String(state || '').trim()
      || String(country || '').trim()
    ));

  if (!hasBusinessFilters) {
    return { businessIds: visibleBusinessIds, empty: false };
  }

  const filtered = await resolveCombinedBusinessFilters({
    city: includeLocation ? city : '',
    state: includeLocation ? state : '',
    country: includeLocation ? country : '',
    zip,
    tag,
    tags,
    verified: String(verified || '').toLowerCase() === 'true',
  });

  if (Array.isArray(filtered) && !filtered.length) {
    return { empty: true };
  }

  const visibleSet = new Set(visibleBusinessIds.map(String));
  const targetSet = filtered
    ? new Set(filtered.map((id) => String(id)))
    : visibleSet;

  const businessIds = [...visibleSet].filter((id) => targetSet.has(id));
  if (!businessIds.length) return { empty: true };
  return { businessIds, empty: false };
}

function mergeBusinessIdFilter(existingFilter, allowedBusinessIds) {
  const allowedIds = (allowedBusinessIds || []).filter(Boolean);
  const allowedSet = new Set(allowedIds.map(String));

  if (!allowedIds.length) {
    return { empty: true };
  }

  if (existingFilter && typeof existingFilter === 'object' && existingFilter.$in) {
    const narrowed = existingFilter.$in
      .map(String)
      .filter((id) => allowedSet.has(id));
    if (!narrowed.length) return { empty: true };
    return { filter: { $in: narrowed.map((id) => new mongoose.Types.ObjectId(id)) }, empty: false };
  }

  if (existingFilter) {
    const id = String(existingFilter);
    if (!allowedSet.has(id)) return { empty: true };
    return { filter: existingFilter, empty: false };
  }

  return {
    filter: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    empty: false,
  };
}

function normalizeBadgeValues(badge) {
  const values = (Array.isArray(badge) ? badge : [badge])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => BADGE_VALUE_MAP[value.toLowerCase()] || value);

  return [...new Set(values)];
}

async function applyBadgeBusinessIdFilter(filters, badge) {
  const requestedBadges = normalizeBadgeValues(badge);
  if (!requestedBadges.length) return { empty: false };

  const badgeBusinesses = await Business.find(
    publicMarketplaceBusinessFilter({ badge: { $in: requestedBadges } })
  ).select('_id').lean();

  const merged = mergeBusinessIdFilter(
    filters.businessId,
    badgeBusinesses.map((business) => business._id)
  );

  if (merged.empty) return { empty: true };

  filters.businessId = merged.filter;
  return { empty: false };
}

function attachBusinessMetadataToListings(items, { verifiedMap, tagsMap }) {
  return items.map((item) => {
    const plain = item && typeof item.toObject === 'function' ? item.toObject() : { ...item };
    const businessId = plain.businessId?._id || plain.businessId;
    const businessKey = businessId ? String(businessId) : null;

    if (plain.businessId && typeof plain.businessId === 'object' && businessKey && tagsMap?.has(businessKey)) {
      plain.businessId.tags = tagsMap.get(businessKey);
    }

    const cardOptions = { listingType: plain.listingType };
    if (businessKey && verifiedMap?.has(businessKey)) {
      cardOptions.verified = verifiedMap.get(businessKey);
    }

    return { plain, cardOptions };
  });
}

module.exports = {
  escapeRegex,
  buildKeywordRegex,
  buildFlexibleMatchRegex,
  parseTagList,
  parsePublicSearchQuery,
  detectUnsupportedGeoParams,
  intersectBusinessIdSets,
  shouldIncludeListingType,
  resolveBusinessIdsByKeyword,
  resolveBusinessIdsByTags,
  resolveVerifiedBusinessIds,
  resolveBusinessIdsByZip,
  resolveBusinessIdsByLocation,
  resolveBusinessIdsForMinorityType,
  resolveCombinedBusinessFilters,
  loadVerifiedByBusinessIds,
  loadTagsByBusinessIds,
  narrowVisibleBusinessIds,
  mergeBusinessIdFilter,
  normalizeBadgeValues,
  applyBadgeBusinessIdFilter,
  attachBusinessMetadataToListings,
};
