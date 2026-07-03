const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const productControllerPath = path.resolve(__dirname, '../../controllers/productController.js');
const ownerId = '507f1f77bcf86cd799439011';

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

function awsMocks() {
  return {
    S3Client: class S3Client {},
    PutObjectCommand: class PutObjectCommand {},
  };
}

function buildVariant(stock = 5) {
  return {
    _id: 'var-1',
    ownerId,
    stock,
    isDeleted: false,
    save: async function save() {
      return this;
    },
  };
}

function mockQueryResult(value) {
  return {
    sort: async () => value,
  };
}

function loadStockController(variant = buildVariant()) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/ProductVariant')) {
      return {
        findOne: async () => variant,
      };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) {
      return async () => {};
    }
    if (request.endsWith('@aws-sdk/client-s3')) {
      return awsMocks();
    }
    if (request.endsWith('@aws-sdk/s3-request-presigner')) {
      return { getSignedUrl: async () => 'https://signed.example/upload' };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[productControllerPath];
  const controller = require(productControllerPath);
  Module._load = originalLoad;
  return controller;
}

function loadProductControllerWithMocks(mocks) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Product')) return mocks.Product || {};
    if (request.endsWith('models/ProductVariant')) return mocks.ProductVariant || {};
    if (request.endsWith('models/Business')) return mocks.Business || {};
    if (request.endsWith('models/Subscription')) return mocks.Subscription || {};
    if (request.endsWith('models/SubscriptionPlan')) return mocks.SubscriptionPlan || {};
    if (request.endsWith('models/VendorOnboardingStage1')) {
      return mocks.VendorOnboardingStage1 || { findOne: async () => null };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) {
      return async () => {};
    }
    if (request.endsWith('@aws-sdk/client-s3')) {
      return awsMocks();
    }
    if (request.endsWith('@aws-sdk/s3-request-presigner')) {
      return { getSignedUrl: async () => 'https://signed.example/upload' };
    }
    if (request === 'express-validator') {
      return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[productControllerPath];
  const controller = require(productControllerPath);
  Module._load = originalLoad;
  return controller;
}

function buildVariantMutationMocks(captured) {
  const businessId = '507f1f77bcf86cd799439012';
  const productId = '507f1f77bcf86cd799439013';

  return {
    Product: {
      findById: async () => ({
        _id: productId,
        businessId,
        ownerId,
        isDeleted: false,
        isPublished: false,
      }),
      findByIdAndUpdate: async () => ({}),
      countDocuments: async () => 0,
    },
    ProductVariant: {
      countDocuments: async () => 0,
      insertMany: async (docs) => {
        captured.docs = docs;
        return docs.map((doc, index) => ({ ...doc, _id: `variant-${index}` }));
      },
    },
    Business: {
      findById: async () => ({ _id: businessId }),
    },
    Subscription: {
      findOne: () => mockQueryResult({
        subscriptionPlanId: '507f1f77bcf86cd799439014',
      }),
    },
    SubscriptionPlan: {
      findById: async () => ({ limits: { productListings: 10 } }),
    },
  };
}

test('updateVariantStock sets stock with operation set', async () => {
  const variant = buildVariant(2);
  const { updateVariantStock } = loadStockController(variant);
  const res = mockResponse();

  await updateVariantStock(
    {
      params: { variantId: 'var-1' },
      user: { _id: ownerId },
      body: { stock: 10, operation: 'set' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(variant.stock, 10);
});

test('updateVariantStock increments stock', async () => {
  const variant = buildVariant(2);
  const { updateVariantStock } = loadStockController(variant);
  const res = mockResponse();

  await updateVariantStock(
    {
      params: { variantId: 'var-1' },
      user: { _id: ownerId },
      body: { stock: 3, operation: 'increment' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(variant.stock, 5);
  assert.equal(res.body.stock, 5);
});

test('updateVariantStock decrements stock', async () => {
  const variant = buildVariant(5);
  const { updateVariantStock } = loadStockController(variant);
  const res = mockResponse();

  await updateVariantStock(
    {
      params: { variantId: 'var-1' },
      user: { _id: ownerId },
      body: { stock: 2, operation: 'decrement' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(variant.stock, 3);
  assert.equal(res.body.stock, 3);
});

test('updateVariantStock rejects negative set values', async () => {
  const { updateVariantStock } = loadStockController();
  const res = mockResponse();

  await updateVariantStock(
    {
      params: { variantId: 'var-1' },
      user: { _id: ownerId },
      body: { stock: -1, operation: 'set' },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Stock cannot be negative');
});

test('updateVariantStock rejects insufficient decrement', async () => {
  const { updateVariantStock } = loadStockController(buildVariant(2));
  const res = mockResponse();

  await updateVariantStock(
    {
      params: { variantId: 'var-1' },
      user: { _id: ownerId },
      body: { stock: 5, operation: 'decrement' },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Insufficient stock');
});

test('updateVariantStock rejects unknown operation', async () => {
  const { updateVariantStock } = loadStockController();
  const res = mockResponse();

  await updateVariantStock(
    {
      params: { variantId: 'var-1' },
      user: { _id: ownerId },
      body: { stock: 1, operation: 'multiply' },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Invalid operation/);
});

test('updateVariantStock returns 404 for missing variant', async () => {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/ProductVariant')) {
      return { findOne: async () => null };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) {
      return async () => {};
    }
    if (request.endsWith('@aws-sdk/client-s3')) {
      return awsMocks();
    }
    if (request.endsWith('@aws-sdk/s3-request-presigner')) {
      return { getSignedUrl: async () => 'https://signed.example/upload' };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[productControllerPath];
  const { updateVariantStock } = require(productControllerPath);
  Module._load = originalLoad;

  const res = mockResponse();
  await updateVariantStock(
    {
      params: { variantId: 'missing' },
      user: { _id: ownerId },
      body: { stock: 1, operation: 'set' },
    },
    res
  );

  assert.equal(res.statusCode, 404);
});

test('addVariants preserves top-level stock over nested size stock', async () => {
  const captured = {};
  const { addVariants } = loadProductControllerWithMocks(buildVariantMutationMocks(captured));
  const res = mockResponse();

  await addVariants(
    {
      params: { productId: '507f1f77bcf86cd799439013' },
      user: { _id: ownerId },
      body: {
        variants: [
          {
            attributes: { Size: 'M' },
            sku: 'TOP-STOCK',
            price: 12,
            stock: 7,
            sizes: [{ sku: 'NESTED-STOCK', price: 99, stock: 2 }],
          },
        ],
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(captured.docs[0].stock, 7);
  assert.equal(captured.docs[0].sku, 'TOP-STOCK');
  assert.equal(captured.docs[0].price.toString(), '12');
});

test('addVariants maps nested sizes[0] stock when top-level stock is absent', async () => {
  const captured = {};
  const { addVariants } = loadProductControllerWithMocks(buildVariantMutationMocks(captured));
  const res = mockResponse();

  await addVariants(
    {
      params: { productId: '507f1f77bcf86cd799439013' },
      user: { _id: ownerId },
      body: {
        variants: [
          {
            attributes: { Size: 'L' },
            sizes: [{ sku: 'NESTED-STOCK', price: '19.5', salePrice: '15.5', stock: '9' }],
          },
        ],
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(captured.docs[0].stock, 9);
  assert.equal(captured.docs[0].sku, 'NESTED-STOCK');
  assert.equal(captured.docs[0].price.toString(), '19.5');
  assert.equal(captured.docs[0].salePrice.toString(), '15.5');
});

test('getBusinessProducts includes stock metadata from real variant stock', async () => {
  const productId = '507f1f77bcf86cd799439013';
  const businessId = '507f1f77bcf86cd799439012';
  const productFindChain = {
    populate() { return this; },
    sort() { return this; },
    lean: async () => [
      {
        _id: productId,
        title: 'Stocked Product',
        businessId,
        ownerId,
        isDeleted: false,
      },
    ],
  };
  const variantFindChain = {
    lean: async () => [
      { _id: 'var-zero', stock: 0, price: 10, isDeleted: false },
      { _id: 'var-low', stock: 3, price: 11, isDeleted: false },
      { _id: 'var-ok', stock: 8, price: 12, isDeleted: false },
    ],
  };

  const { getBusinessProducts } = loadProductControllerWithMocks({
    Product: {
      find: () => productFindChain,
    },
    ProductVariant: {
      find: () => variantFindChain,
    },
    Business: {
      findOne: async () => ({ _id: businessId, owner: ownerId }),
    },
  });
  const res = mockResponse();

  await getBusinessProducts(
    {
      params: { businessId },
      user: { _id: ownerId },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.products[0].totalStock, 11);
  assert.equal(res.body.products[0].stockStatus, 'in_stock');
  assert.deepEqual(res.body.products[0].stockSummary, {
    in_stock: 1,
    low_stock: 1,
    out_of_stock: 1,
  });
  assert.equal(res.body.products[0].variants[0].stockStatus, 'out_of_stock');
  assert.equal(res.body.products[0].variants[1].stockStatus, 'low_stock');
  assert.equal(res.body.products[0].variants[2].stockStatus, 'in_stock');
});
