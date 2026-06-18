const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/featuredProducts.controller.js'
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

function loadController(mockProduct, total = 1, options = {}) {
  const {
    visibleBusinessIds = ['507f1f77bcf86cd799439014'],
    capturedFindQuery = { value: null },
    capturedLimit = { value: null },
  } = options;

  const chain = {
    populate() {
      return chain;
    },
    select() {
      return chain;
    },
    sort() {
      return chain;
    },
    skip() {
      return chain;
    },
    limit(value) {
      capturedLimit.value = value;
      return Promise.resolve([mockProduct]);
    },
  };

  const Product = {
    find: (query) => {
      capturedFindQuery.value = query;
      return chain;
    },
    countDocuments: async () => total,
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
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const loaded = require(controllerPath);
  Module._load = originalLoad;
  return { controller: loaded, capturedFindQuery, capturedLimit };
}

test('getFeaturedProducts maps products through toPublicListingCard', async () => {
  const mockProduct = {
    toObject() {
      return {
        _id: '507f1f77bcf86cd799439011',
        title: 'Featured Widget',
        slug: 'featured-widget',
        description: 'A featured item',
        coverImage: 'https://cdn.example.com/p.jpg',
        price: { toString: () => '19.99' },
        categoryId: { _id: '507f1f77bcf86cd799439012', name: 'Apparel' },
        subcategoryId: { _id: '507f1f77bcf86cd799439013', name: 'Shirts' },
        businessId: { _id: '507f1f77bcf86cd799439014', businessName: 'Acme Co' },
      };
    },
  };

  const { controller } = loadController(mockProduct);
  const res = mockResponse();

  await controller.getFeaturedProducts({ query: { page: 1, limit: 12 } }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.products));
  assert.equal(res.body.products.length, 1);

  const product = res.body.products[0];
  assert.equal(product.id, '507f1f77bcf86cd799439011');
  assert.equal(product.imageUrl, 'https://cdn.example.com/p.jpg');
  assert.equal(product.priceLabel, '$19.99');
  assert.equal(product.vendorName, 'Acme Co');
  assert.equal(product.listingType, 'product');
  assert.equal(product._id, '507f1f77bcf86cd799439011');
});

test('getFeaturedProducts preserves products and pagination wrapper', async () => {
  const mockProduct = {
    toObject() {
      return {
        _id: '507f1f77bcf86cd799439011',
        title: 'No Price Item',
        categoryId: null,
        subcategoryId: null,
        businessId: null,
      };
    },
  };

  const { controller } = loadController(mockProduct, 5);
  const res = mockResponse();

  await controller.getFeaturedProducts({ query: { page: 2, limit: 2 } }, res);

  assert.equal(res.statusCode, 200);
  assert.ok('products' in res.body);
  assert.ok('pagination' in res.body);
  assert.equal(res.body.pagination.currentPage, 2);
  assert.equal(res.body.pagination.totalProducts, 5);
  assert.equal(res.body.pagination.totalPages, 3);
  assert.equal(res.body.products[0].price, null);
  assert.equal(res.body.products[0].priceLabel, 'Contact for price');
});

test('getFeaturedProducts scopes query to active businesses', async () => {
  const mockProduct = {
    toObject() {
      return { _id: '507f1f77bcf86cd799439011', title: 'Featured' };
    },
  };
  const activeBusinessId = '507f1f77bcf86cd799439014';
  const { controller, capturedFindQuery } = loadController(mockProduct, 1, {
    visibleBusinessIds: [activeBusinessId],
  });
  const res = mockResponse();

  await controller.getFeaturedProducts({ query: { page: 1, limit: 12 } }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(capturedFindQuery.value);
  assert.equal(capturedFindQuery.value.isFeatured, true);
  assert.equal(capturedFindQuery.value.isPublished, true);
  assert.deepEqual(capturedFindQuery.value.businessId.$in, [activeBusinessId]);
});

test('getFeaturedProducts returns empty list when no active businesses', async () => {
  const { controller } = loadController(null, 0, { visibleBusinessIds: [] });
  const res = mockResponse();

  await controller.getFeaturedProducts({ query: { page: 1, limit: 12 } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.products, []);
  assert.equal(res.body.pagination.totalProducts, 0);
});

test('getFeaturedProducts caps limit at 50', async () => {
  const mockProduct = {
    toObject() {
      return { _id: '507f1f77bcf86cd799439011', title: 'Featured' };
    },
  };
  const { controller, capturedLimit } = loadController(mockProduct, 1);
  const res = mockResponse();

  await controller.getFeaturedProducts({ query: { page: 1, limit: 500 } }, res);

  assert.equal(capturedLimit.value, 50);
});
