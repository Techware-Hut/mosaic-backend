const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const productControllerPath = path.resolve(__dirname, '../../controllers/productController.js');
const ownerId = '507f1f77bcf86cd799439011';
const otherOwnerId = '507f1f77bcf86cd799439012';

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

function loadProductController({
  productOwnerId = ownerId,
  productDeleted = false,
} = {}) {
  const originalLoad = Module._load;
  const productDoc = {
    _id: 'prod-1',
    ownerId: productOwnerId,
    isDeleted: productDeleted,
    businessId: 'biz-1',
    coverImage: null,
    galleryImages: [],
    saveCalled: false,
    async save() {
      this.saveCalled = true;
    },
  };
  const captured = {
    productDoc,
    variantUpdateManyCalls: [],
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Product')) {
      return {
        findById: async () => productDoc,
        findOne: async () => null,
        countDocuments: async () => 0,
      };
    }
    if (request.endsWith('models/ProductVariant')) {
      return {
        findOne: async () => null,
        deleteMany: async () => {},
        updateMany: async (...args) => {
          captured.variantUpdateManyCalls.push(args);
          return { modifiedCount: 2 };
        },
      };
    }
    if (request.endsWith('models/Business')) {
      return { findOne: async () => null };
    }
    if (request.endsWith('models/Subscription')) {
      return {
        findOne: () => ({
          sort: async () => ({
            subscriptionPlanId: 'plan-1',
            status: 'active',
          }),
        }),
      };
    }
    if (request.endsWith('models/SubscriptionPlan')) {
      return {
        findById: async () => ({ limits: { productListings: 10, imageLimit: 5 } }),
      };
    }
    if (request.endsWith('models/VendorOnboardingStage1')) {
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
  const controller = require(productControllerPath);
  Module._load = originalLoad;
  return {
    ...controller,
    __captured: captured,
  };
}

test('updateProduct returns 403 when ownerId does not match vendor', async () => {
  const { updateProduct } = loadProductController({ productOwnerId: otherOwnerId });
  const res = mockResponse();

  await updateProduct(
    {
      params: { productId: 'prod-1' },
      user: { _id: ownerId },
      body: { title: 'Updated title' },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Unauthorized');
});

test('updateProduct returns 404 when product is deleted', async () => {
  const { updateProduct } = loadProductController({ productDeleted: true });
  const res = mockResponse();

  await updateProduct(
    {
      params: { productId: 'prod-1' },
      user: { _id: ownerId },
      body: { title: 'Updated title' },
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Product not found');
});

test('deleteProduct is owner-scoped and soft-deletes product variants', async () => {
  const { deleteProduct, __captured } = loadProductController();
  const res = mockResponse();

  await deleteProduct(
    {
      params: { productId: 'prod-1' },
      user: { _id: ownerId },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(__captured.productDoc.isDeleted, true);
  assert.equal(__captured.productDoc.saveCalled, true);
  assert.deepEqual(__captured.variantUpdateManyCalls, [
    [
      { productId: 'prod-1' },
      { $set: { isDeleted: true } },
    ],
  ]);
});

test('deleteProduct rejects another vendor and leaves variants untouched', async () => {
  const { deleteProduct, __captured } = loadProductController({ productOwnerId: otherOwnerId });
  const res = mockResponse();

  await deleteProduct(
    {
      params: { productId: 'prod-1' },
      user: { _id: ownerId },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'Unauthorized');
  assert.equal(__captured.productDoc.isDeleted, false);
  assert.equal(__captured.productDoc.saveCalled, false);
  assert.deepEqual(__captured.variantUpdateManyCalls, []);
});
