const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const {
  expandStateMatchValues,
  buildAddressStateFilter,
} = require('../../lib/marketplace/usStateMatch');

const queryPath = path.resolve(
  __dirname,
  '../../lib/marketplace/vendorDirectoryQuery.js'
);

test('expandStateMatchValues maps VA and Virginia both ways', () => {
  assert.deepEqual(
    expandStateMatchValues('VA').map((v) => v.toLowerCase()).sort(),
    ['va', 'virginia']
  );
  assert.deepEqual(
    expandStateMatchValues('Virginia').map((v) => v.toLowerCase()).sort(),
    ['va', 'virginia']
  );
});

test('buildAddressStateFilter matches abbreviation or full name', () => {
  const filter = buildAddressStateFilter('Virginia');
  assert.ok(filter.test('VA'));
  assert.ok(filter.test('Virginia'));
  assert.ok(filter.test('virginia'));
  assert.equal(filter.test('Maryland'), false);
});

function wrapDistinct(mockIds) {
  return {
    distinct: async () => mockIds,
  };
}

function loadQueryWithMocks(mocks) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/Product')) {
      return wrapDistinct(mocks.productIds || []);
    }
    if (String(request).includes('models/Service')) {
      return wrapDistinct(mocks.serviceIds || []);
    }
    if (String(request).includes('models/Food')) {
      return wrapDistinct(mocks.foodIds || []);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[queryPath];
  // Also bust publicMarketplaceStates + usStateMatch if already cached via query
  delete require.cache[
    path.resolve(__dirname, '../../lib/listing/publicMarketplaceStates.js')
  ];
  const loaded = require(queryPath);
  Module._load = originalLoad;
  return loaded;
}

test('filterDirectoryBusinessesWithPublicListings keeps type-matching owners only', async () => {
  const { filterDirectoryBusinessesWithPublicListings } = loadQueryWithMocks({
    productIds: ['p1'],
    serviceIds: ['s1'],
    foodIds: [],
  });

  const eligible = await filterDirectoryBusinessesWithPublicListings([
    { _id: 'p1', listingType: 'product' },
    { _id: 'p2', listingType: 'product' },
    { _id: 's1', listingType: 'service' },
    { _id: 's2', listingType: 'service' },
    { _id: 'f1', listingType: 'food' },
  ]);

  assert.deepEqual(eligible, ['p1', 's1']);
});

test('resolveListingTypeFilter keeps service independent of product', () => {
  const { resolveListingTypeFilter } = loadQueryWithMocks({});
  assert.equal(resolveListingTypeFilter('service'), 'service');
  assert.deepEqual(resolveListingTypeFilter(''), {
    $in: ['product', 'service', 'food'],
  });
});
