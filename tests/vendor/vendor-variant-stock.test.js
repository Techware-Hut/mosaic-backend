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
