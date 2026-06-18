const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/productListingController.js'
);

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

function loadRankedController(options = {}) {
  const {
    visibleBusinessIds = ['507f1f77bcf86cd799439014'],
    capturedFindQuery = { value: null },
  } = options;

  const chain = {
    populate() {
      return chain;
    },
    sort() {
      return chain;
    },
    skip() {
      return chain;
    },
    limit() {
      return Promise.resolve([]);
    },
  };

  const Product = {
    find: (query) => {
      capturedFindQuery.value = query;
      return chain;
    },
    countDocuments: async (query) => {
      capturedFindQuery.value = query;
      return 0;
    },
    aggregate: async () => [],
  };

  const Business = {
    find: () => ({
      select: () => ({
        lean: async () => visibleBusinessIds.map((id) => ({ _id: id })),
      }),
    }),
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Product') return Product;
    if (request === '../models/Business') return Business;
    if (request === '../models/ProductCategory') return {};
    if (request === '../models/ProductSubcategory') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const loaded = require(controllerPath);
  Module._load = originalLoad;
  return { controller: loaded, capturedFindQuery };
}

test('listProductsRanked requires published products on simple path', async () => {
  const { controller, capturedFindQuery } = loadRankedController();
  const res = mockResponse();

  await controller.listProductsRanked({ query: { page: 1, pageSize: 24 } }, res);

  assert.ok(capturedFindQuery.value);
  assert.equal(capturedFindQuery.value.isDeleted, false);
  assert.equal(capturedFindQuery.value.isPublished, true);
  assert.ok(Array.isArray(capturedFindQuery.value.businessId.$in));
});
