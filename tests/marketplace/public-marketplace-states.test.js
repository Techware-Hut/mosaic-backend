const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const statesPath = path.resolve(__dirname, '../../lib/listing/publicMarketplaceStates.js');

const APPROVED_ACTIVE_BUSINESSES = [
  { _id: 'b1', isApproved: true, isActive: true, address: { state: 'Maryland' } },
  { _id: 'b2', isApproved: true, isActive: true, address: { state: ' maryland  ' } },
  { _id: 'b3', isApproved: true, isActive: true, address: { state: 'Virginia' } },
  { _id: 'b4', isApproved: true, isActive: true, address: { state: 'Texas' } },
  { _id: 'b5', isApproved: true, isActive: true, address: { state: '' } },
  { _id: 'b6', isApproved: true, isActive: true, address: { state: 'Delaware' } },
];

function wrapModelFind(mock) {
  return {
    find: (filter) => ({
      select: () => ({
        lean: async () => (mock && typeof mock.find === 'function' ? mock.find(filter) : []),
      }),
    }),
    distinct: async (field, filter) =>
      mock && typeof mock.distinct === 'function' ? mock.distinct(field, filter) : [],
  };
}

function loadStatesWithMocks(mocks) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/Business')) return wrapModelFind(mocks.Business);
    if (String(request).includes('models/Product')) return wrapModelFind(mocks.Product);
    if (String(request).includes('models/Service')) return wrapModelFind(mocks.Service);
    if (String(request).includes('models/Food')) return wrapModelFind(mocks.Food);
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[statesPath];
  const loaded = require(statesPath);
  Module._load = originalLoad;
  return loaded;
}

test('returns [] when no approved active businesses exist', async () => {
  const { getPublicMarketplaceStates } = loadStatesWithMocks({
    Business: { find: async () => [] },
    Product: { distinct: async () => [] },
    Service: { distinct: async () => [] },
    Food: { distinct: async () => [] },
  });

  assert.deepEqual(await getPublicMarketplaceStates(), []);
});

test('queries businesses with the public marketplace visibility filter', async () => {
  let capturedFilter = null;
  const { getPublicMarketplaceStates } = loadStatesWithMocks({
    Business: {
      find: async (filter) => {
        capturedFilter = filter;
        return [];
      },
    },
    Product: { distinct: async () => [] },
    Service: { distinct: async () => [] },
    Food: { distinct: async () => [] },
  });

  await getPublicMarketplaceStates();
  assert.equal(capturedFilter.isApproved, true);
  assert.equal(capturedFilter.isActive, true);
});

test('only businesses with at least one eligible listing contribute states', async () => {
  const { getPublicMarketplaceStates } = loadStatesWithMocks({
    Business: { find: async () => APPROVED_ACTIVE_BUSINESSES },
    // b1/b2 (Maryland) own a published product; b6 (Delaware) owns a service.
    Product: { distinct: async () => ['b1'] },
    Service: { distinct: async () => ['b6'] },
    Food: { distinct: async () => [] },
  });

  // b3 Virginia (no listings), b4 Texas (no listings), b5 (blank state) excluded.
  // Maryland appears once despite two differently-cased/spaced values.
  assert.deepEqual(await getPublicMarketplaceStates(), ['Delaware', 'Maryland']);
});

test('food listings also make a state eligible', async () => {
  const { getPublicMarketplaceStates } = loadStatesWithMocks({
    Business: { find: async () => APPROVED_ACTIVE_BUSINESSES },
    Product: { distinct: async () => [] },
    Service: { distinct: async () => [] },
    Food: { distinct: async () => ['b3'] },
  });

  assert.deepEqual(await getPublicMarketplaceStates(), ['Virginia']);
});

test('listing queries enforce the public listing visibility filters', async () => {
  const captured = {};
  const { getPublicMarketplaceStates } = loadStatesWithMocks({
    Business: { find: async () => APPROVED_ACTIVE_BUSINESSES },
    Product: {
      distinct: async (field, filter) => {
        captured.product = filter;
        return [];
      },
    },
    Service: {
      distinct: async (field, filter) => {
        captured.service = filter;
        return [];
      },
    },
    Food: {
      distinct: async (field, filter) => {
        captured.food = filter;
        return [];
      },
    },
  });

  await getPublicMarketplaceStates();

  assert.equal(captured.product.isDeleted, false);
  assert.equal(captured.product.isPublished, true);
  assert.deepEqual(captured.product.isActive, { $ne: false });
  assert.equal(captured.service.isPublished, true);
  assert.deepEqual(captured.service.isActive, { $ne: false });
  assert.equal(captured.food.isPublished, true);
  assert.deepEqual(captured.food.isActive, { $ne: false });
});

test('normalizeStateValue trims and collapses whitespace', () => {
  const { normalizeStateValue } = require(statesPath);
  assert.equal(normalizeStateValue('  New   York '), 'New York');
  assert.equal(normalizeStateValue(''), '');
  assert.equal(normalizeStateValue(null), '');
});
