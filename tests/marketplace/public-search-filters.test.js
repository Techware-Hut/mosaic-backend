const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const filtersPath = path.resolve(__dirname, '../../lib/listing/publicSearchFilters.js');
const dtoPath = path.resolve(__dirname, '../../lib/listing/publicListingDto.js');
const controllerPath = path.resolve(__dirname, '../../controllers/publicListing.js');

const {
  parsePublicSearchQuery,
  detectUnsupportedGeoParams,
  parseTagList,
  intersectBusinessIdSets,
  shouldIncludeListingType,
  buildFlexibleMatchRegex,
  normalizeBadgeValues,
  mergeBusinessIdFilter,
} = require(filtersPath);

test('parsePublicSearchQuery leaves keyword empty when absent', () => {
  const parsed = parsePublicSearchQuery({});
  assert.equal(parsed.keyword, '');
  assert.equal(parsed.city, '');
  assert.equal(parsed.state, '');
});

test('parsePublicSearchQuery defaults invalid listingType to all', () => {
  const parsed = parsePublicSearchQuery({ listingType: 'invalid-type' });
  assert.equal(parsed.listingType, 'all');
});

test('parsePublicSearchQuery preserves city and state filters', () => {
  const parsed = parsePublicSearchQuery({ city: ' Austin ', state: ' TX ' });
  assert.equal(parsed.city, 'Austin');
  assert.equal(parsed.state, 'TX');
});

test('parsePublicSearchQuery preserves country filters', () => {
  const parsed = parsePublicSearchQuery({ country: ' United States ' });
  assert.equal(parsed.country, 'United States');
});

test('resolveBusinessIdsForMinorityType returns null for empty input', async () => {
  const filters = loadFiltersWithMocks({
    Business: { find: async () => [] },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: { find: async () => [] },
  });

  const result = await filters.resolveBusinessIdsForMinorityType('');
  assert.equal(result, null);
});

test('resolveBusinessIdsByLocation applies city and state with approved active business scope', async () => {
  const id = '507f1f77bcf86cd799439012';
  let capturedFilter = null;
  const filters = loadFiltersWithMocks({
    Business: {
      find: async (filter) => {
        capturedFilter = filter;
        return [{ _id: id }];
      },
    },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: { find: async () => [] },
  });

  const result = await filters.resolveBusinessIdsByLocation({ city: 'Austin', state: 'TX' });
  assert.equal(result.length, 1);
  assert.equal(String(result[0]), id);
  assert.equal(capturedFilter.isActive, true);
  assert.equal(capturedFilter.isApproved, true);
  assert.equal(capturedFilter.$and.length, 2);
});

test('resolveBusinessIdsByLocation applies country with approved active business scope', async () => {
  const id = '507f1f77bcf86cd799439012';
  let capturedFilter = null;
  const filters = loadFiltersWithMocks({
    Business: {
      find: async (filter) => {
        capturedFilter = filter;
        return [{ _id: id }];
      },
    },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: { find: async () => [] },
  });

  const result = await filters.resolveBusinessIdsByLocation({ country: 'United States' });
  assert.equal(result.length, 1);
  assert.equal(String(result[0]), id);
  assert.equal(capturedFilter.isActive, true);
  assert.equal(capturedFilter.isApproved, true);
  assert.equal(capturedFilter.$and.length, 1);
});

test('searchPublicListings returns empty data for unknown categorySlug', async () => {
  const controller = loadSearchController({
    Business: { find: async () => [] },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: {},
    ProductCategory: { findOne: async () => null },
    ServiceCategory: { findOne: async () => null },
    FoodCategory: { findOne: async () => null },
  });

  const res = mockResponse();
  await controller.searchPublicListings({ query: { categorySlug: 'does-not-exist' } }, res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.totals.all, 0);
  assert.deepEqual(res.body.data, { products: [], services: [], foods: [] });
});

test('parsePublicSearchQuery normalizes search alias and clamps limit', () => {
  const parsed = parsePublicSearchQuery({ search: ' hats ', limit: '999', page: '0' });
  assert.equal(parsed.keyword, 'hats');
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.listingType, 'all');
});

test('detectUnsupportedGeoParams flags geolocation params', () => {
  const unsupported = detectUnsupportedGeoParams({ lat: '40.7', radius: '10' });
  assert.ok(unsupported.some((item) => item.param === 'lat'));
  assert.ok(unsupported.some((item) => item.param === 'radius'));
  assert.equal(unsupported[0].reason, 'geolocation not implemented');
});

test('parseTagList supports comma-separated tags', () => {
  assert.deepEqual(parseTagList('', 'organic, local'), ['organic', 'local']);
});

test('intersectBusinessIdSets returns shared business ids', () => {
  const mongoose = require('mongoose');
  const a = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const b = [a[0], new mongoose.Types.ObjectId()];
  const result = intersectBusinessIdSets(a, b);
  assert.equal(result.length, 1);
  assert.equal(String(result[0]), String(a[0]));
});

test('mergeBusinessIdFilter intersects explicit businessId lists', () => {
  const keep = '507f1f77bcf86cd799439011';
  const drop = '507f1f77bcf86cd799439012';
  const result = mergeBusinessIdFilter({ $in: [keep, drop] }, [keep]);

  assert.equal(result.empty, false);
  assert.deepEqual(result.filter.$in.map(String), [keep]);
});

test('normalizeBadgeValues supports Bronze and comma-separated case normalization', () => {
  assert.deepEqual(normalizeBadgeValues('bronze, GOLD'), ['Bronze', 'Gold']);
});

test('shouldIncludeListingType respects listingType filter', () => {
  assert.equal(shouldIncludeListingType('product', 'product'), true);
  assert.equal(shouldIncludeListingType('product', 'service'), false);
  assert.equal(shouldIncludeListingType('all', 'food'), true);
});

test('buildFlexibleMatchRegex matches flexible location tokens', () => {
  const regex = buildFlexibleMatchRegex('New York');
  assert.match('New-York', regex);
});

function buildFindChain(rows = []) {
  const chain = {
    populate() { return chain; },
    select() { return chain; },
    sort() { return chain; },
    skip() { return chain; },
    limit() { return chain; },
    lean() { return Promise.resolve(rows); },
  };
  return chain;
}

function buildSelectLeanChain(rows = []) {
  return buildFindChain(rows);
}

function wrapModelFind(model, fallbackRows = []) {
  if (!model) {
    return { find: () => buildSelectLeanChain(fallbackRows) };
  }

  const userFind = model.find;
  return {
    ...model,
    find: (...args) => {
      if (typeof userFind !== 'function') {
        return buildSelectLeanChain(fallbackRows);
      }

      const result = userFind(...args);
      if (result && typeof result.select === 'function') {
        return result;
      }

      if (result && typeof result.then === 'function') {
        return {
          select() { return this; },
          lean() { return result; },
        };
      }

      return buildSelectLeanChain(Array.isArray(result) ? result : fallbackRows);
    },
  };
}

function loadFiltersWithMocks(mocks) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/Business')) {
      return wrapModelFind(mocks.Business);
    }
    if (String(request).includes('models/VendorOnboardingStage1')) {
      return wrapModelFind(mocks.VendorOnboardingStage1);
    }
    if (String(request).includes('models/MinorityType')) return mocks.MinorityType;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[filtersPath];
  const loaded = require(filtersPath);
  Module._load = originalLoad;
  return loaded;
}

function loadSearchController(mocks) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/Product')) return { find: () => buildFindChain(mocks.products || []) };
    if (String(request).includes('models/Service')) return { find: () => buildFindChain(mocks.services || []) };
    if (String(request).includes('models/Food')) return { find: () => buildFindChain(mocks.foods || []) };
    if (String(request).includes('models/Business')) return wrapModelFind(mocks.Business);
    if (String(request).includes('models/VendorOnboardingStage1')) return wrapModelFind(mocks.VendorOnboardingStage1);
    if (String(request).includes('models/MinorityType')) return mocks.MinorityType;
    if (String(request).includes('models/ProductCategory')) return mocks.ProductCategory;
    if (String(request).includes('models/ServiceCategory')) return mocks.ServiceCategory;
    if (String(request).includes('models/FoodCategory')) return mocks.FoodCategory;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const loaded = require(controllerPath);
  Module._load = originalLoad;
  return loaded;
}

test('resolveBusinessIdsByTags uses exact case-insensitive tag match', async () => {
  const id = '507f1f77bcf86cd799439011';
  const filters = loadFiltersWithMocks({
    Business: {
      find: async () => [{ _id: id }],
    },
    VendorOnboardingStage1: {},
    MinorityType: {},
  });

  const result = await filters.resolveBusinessIdsByTags('Organic', '');
  assert.equal(result.length, 1);
  assert.equal(String(result[0]), id);
});

test('resolveBusinessIdsByZip matches address.zipCode exactly', async () => {
  const id = '507f1f77bcf86cd799439012';
  let capturedFilter = null;
  const filters = loadFiltersWithMocks({
    Business: {
      find: async (filter) => {
        capturedFilter = filter;
        return [{ _id: id }];
      },
    },
    VendorOnboardingStage1: {
      find: async () => [],
    },
    MinorityType: {},
  });

  const result = await filters.resolveBusinessIdsByZip('90210');
  assert.equal(result.length, 1);
  assert.ok(capturedFilter['address.zipCode']);
});

test('resolveVerified ignores Stripe onboardingStatus field', () => {
  delete require.cache[dtoPath];
  const { toPublicListingCard } = require(dtoPath);
  const card = toPublicListingCard({
    _id: '507f1f77bcf86cd799439011',
    title: 'Sample',
    onboardingStatus: 'completed',
  }, { listingType: 'product' });

  assert.equal(card.verified, null);
});

test('resolveVerified uses explicit verified option', () => {
  delete require.cache[dtoPath];
  const { toPublicListingCard } = require(dtoPath);
  const card = toPublicListingCard({
    _id: '507f1f77bcf86cd799439011',
    title: 'Sample',
  }, { listingType: 'product', verified: true });

  assert.equal(card.verified, true);
});

test('parseTagList uses tag when tags query is empty string', () => {
  assert.deepEqual(parseTagList('Organic', ''), ['Organic']);
});

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('searchPublicListings returns safe empty arrays when tag filter matches nothing', async () => {
  const controller = loadSearchController({
    Business: {
      find: async () => [],
    },
    VendorOnboardingStage1: {
      find: async () => [],
    },
    MinorityType: {},
    ProductCategory: { findOne: async () => null },
    ServiceCategory: { findOne: async () => null },
    FoodCategory: { findOne: async () => null },
  });

  const res = mockResponse();
  await controller.searchPublicListings({ query: { tag: 'missing-tag' } }, res);

  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, { products: [], services: [], foods: [] });
  assert.equal(res.body.totals.all, 0);
});

test('searchPublicListings reports unsupported geolocation params', async () => {
  const controller = loadSearchController({
    Business: { find: async () => [] },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: {},
    ProductCategory: { findOne: async () => null },
    ServiceCategory: { findOne: async () => null },
    FoodCategory: { findOne: async () => null },
  });

  const res = mockResponse();
  await controller.searchPublicListings({ query: { nearMe: 'true', lat: '1', lng: '2' } }, res);

  assert.ok(Array.isArray(res.body.filters.unsupported));
  assert.ok(res.body.filters.unsupported.length >= 3);
});

test('searchPublicListings listingType product skips service and food queries', async () => {
  let serviceFindCalled = false;

  const controller = loadSearchController({
    Business: { find: async () => [] },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: {},
    ProductCategory: { findOne: async () => null },
    ServiceCategory: { findOne: async () => null },
    FoodCategory: { findOne: async () => null },
    products: [],
    services: [],
    foods: [],
  });

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/Service')) {
      return {
        find: () => {
          serviceFindCalled = true;
          return buildFindChain([]);
        },
      };
    }
    if (String(request).includes('models/Product')) return { find: () => buildFindChain([]) };
    if (String(request).includes('models/Food')) return { find: () => buildFindChain([]) };
    if (String(request).includes('models/Business')) return wrapModelFind({ find: async () => [] });
    if (String(request).includes('models/VendorOnboardingStage1')) return wrapModelFind({ find: async () => [] });
    if (String(request).includes('models/MinorityType')) return { find: async () => [] };
    if (String(request).includes('models/ProductCategory')) return { findOne: async () => null };
    if (String(request).includes('models/ServiceCategory')) return { findOne: async () => null };
    if (String(request).includes('models/FoodCategory')) return { findOne: async () => null };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const reloaded = require(controllerPath);
  Module._load = originalLoad;

  const res = mockResponse();
  await reloaded.searchPublicListings({ query: { listingType: 'product' } }, res);

  assert.equal(serviceFindCalled, false);
  assert.equal(res.body.filters.listingType, 'product');
});

test('searchPublicListings preserves backward compatible response shape', async () => {
  const controller = loadSearchController({
    Business: { find: async () => [] },
    VendorOnboardingStage1: { find: async () => [] },
    MinorityType: {},
    ProductCategory: { findOne: async () => null },
    ServiceCategory: { findOne: async () => null },
    FoodCategory: { findOne: async () => null },
  });

  const res = mockResponse();
  await controller.searchPublicListings({ query: { keyword: 'test' } }, res);

  assert.ok('success' in res.body);
  assert.ok('filters' in res.body);
  assert.ok('totals' in res.body);
  assert.ok('data' in res.body);
  assert.ok(Array.isArray(res.body.data.products));
  assert.ok(Array.isArray(res.body.data.services));
  assert.ok(Array.isArray(res.body.data.foods));
});

test('searchPublicListings defaults to approved active business scope when no filters', async () => {
  const activeBusinessId = '507f1f77bcf86cd799439011';
  let productFindFilter = null;

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/Product')) {
      return {
        find: (filter) => {
          productFindFilter = filter;
          return buildFindChain([]);
        },
      };
    }
    if (String(request).includes('models/Service')) return { find: () => buildFindChain([]) };
    if (String(request).includes('models/Food')) return { find: () => buildFindChain([]) };
    if (String(request).includes('models/Business')) {
      return wrapModelFind({
        find: async (filter) => {
          if (filter?.isActive === true && filter?.isApproved === true) {
            return [{ _id: activeBusinessId }];
          }
          return [];
        },
      });
    }
    if (String(request).includes('models/VendorOnboardingStage1')) {
      return wrapModelFind({ find: async () => [] });
    }
    if (String(request).includes('models/MinorityType')) return { find: async () => [] };
    if (String(request).includes('models/ProductCategory')) return { findOne: async () => null };
    if (String(request).includes('models/ServiceCategory')) return { findOne: async () => null };
    if (String(request).includes('models/FoodCategory')) return { findOne: async () => null };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  const res = mockResponse();
  await controller.searchPublicListings({ query: {} }, res);

  assert.equal(res.body.success, true);
  assert.ok(productFindFilter);
  assert.equal(productFindFilter.isPublished, true);
  assert.deepEqual(productFindFilter.businessId.$in, [activeBusinessId]);
});
