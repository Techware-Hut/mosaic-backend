"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const productControllerPath = path.resolve(__dirname, '../../controllers/productController.js');
const listingQuotaServicePath = path.resolve(__dirname, '../../services/listingQuotaService.js');
const publicMarketplaceStatesPath = path.resolve(
  __dirname,
  '../../lib/listing/publicMarketplaceStates.js'
);

const ownerId = '507f1f77bcf86cd799439011';
const businessId = '507f1f77bcf86cd799439012';
const subscriptionId = '507f1f77bcf86cd799439013';
const planId = '507f1f77bcf86cd799439014';
const productId = '507f1f77bcf86cd799439015';
const newProductId = '507f1f77bcf86cd799439016';

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

function productRecord(index, overrides = {}) {
  return {
    _id: `record-${index}`,
    businessId,
    isDeleted: false,
    isPublished: true,
    isActive: true,
    ...overrides,
  };
}

function publishedRecords(count) {
  return Array.from({ length: count }, (_, index) => productRecord(`published-${index}`));
}

function draftRecords(count) {
  return Array.from({ length: count }, (_, index) => productRecord(`draft-${index}`, {
    isPublished: false,
  }));
}

function inactiveRecords(count) {
  return Array.from({ length: count }, (_, index) => productRecord(`inactive-${index}`, {
    isActive: false,
  }));
}

function matchesQuotaQuery(record, query) {
  if (String(record.businessId) !== String(query.businessId)) return false;
  if (query.isDeleted !== undefined && record.isDeleted !== query.isDeleted) return false;
  if (query.isPublished !== undefined && record.isPublished !== query.isPublished) return false;
  if (query.isActive && '$ne' in query.isActive && record.isActive === query.isActive.$ne) {
    return false;
  }
  if (query._id && '$ne' in query._id && String(record._id) === String(query._id.$ne)) {
    return false;
  }
  return true;
}

function buildVariant(index = 0) {
  return {
    attributes: { Size: `Size-${index}` },
    sku: `SKU-${index}`,
    price: 10 + index,
    stock: 2,
    images: [],
  };
}

function buildExistingProduct(captured, overrides = {}) {
  return {
    _id: productId,
    ownerId,
    businessId,
    title: 'Existing product',
    description: 'Existing description',
    categoryId: 'category-1',
    subcategoryId: 'subcategory-1',
    taxCategory: null,
    attributes: [],
    shipping: { standard: 0, overnight: 0, local: 0 },
    coverImage: 'cover.jpg',
    galleryImages: [],
    metaFields: [],
    discount: null,
    price: 10,
    isPublished: false,
    isActive: true,
    isDeleted: false,
    async save() {
      captured.productSaveCalls += 1;
      return this;
    },
    ...overrides,
  };
}

function loadProductQuotaController(options = {}) {
  const records = options.records || [];
  const galleryImageLimit = options.galleryImageLimit ?? 3;
  const captured = {
    businessQueries: [],
    subscriptionFindById: [],
    subscriptionFallbackCalls: 0,
    planFindById: [],
    productCountQueries: [],
    productConstructCalls: 0,
    productSaveCalls: 0,
    productUpdateCalls: [],
    productDeleteCalls: [],
    variantCountCalls: 0,
    variantFindOneCalls: [],
    variantInsertCalls: [],
    variantDeleteCalls: [],
  };

  const existingProduct = options.existingProduct
    ? buildExistingProduct(captured, options.existingProduct)
    : null;
  let createdProduct = null;

  function ProductModel(data) {
    captured.productConstructCalls += 1;
    Object.assign(this, data);
    this._id = newProductId;
    this.save = async () => {
      captured.productSaveCalls += 1;
      createdProduct = this;
      return this;
    };
    createdProduct = this;
  }

  ProductModel.countDocuments = async (query) => {
    captured.productCountQueries.push(query);
    return records.filter((record) => matchesQuotaQuery(record, query)).length;
  };
  ProductModel.findById = async (id) => {
    if (existingProduct && String(id) === String(existingProduct._id)) return existingProduct;
    if (createdProduct && String(id) === String(createdProduct._id)) return createdProduct;
    return null;
  };
  ProductModel.findByIdAndUpdate = async (id, update) => {
    captured.productUpdateCalls.push([id, update]);
    if (createdProduct && String(id) === String(createdProduct._id)) {
      for (const [field, value] of Object.entries(update)) {
        if (!field.startsWith('$')) createdProduct[field] = value;
      }
    }
    return createdProduct || existingProduct;
  };
  ProductModel.findByIdAndDelete = async (id) => {
    captured.productDeleteCalls.push(id);
  };

  function ProductVariantModel(data) {
    Object.assign(this, data);
    this._id = '507f1f77bcf86cd799439099';
    this.save = async () => this;
  }

  ProductVariantModel.countDocuments = async () => {
    captured.variantCountCalls += 1;
    return 999;
  };
  ProductVariantModel.findOne = async (query) => {
    captured.variantFindOneCalls.push(query);
    return null;
  };
  ProductVariantModel.insertMany = async (docs) => {
    captured.variantInsertCalls.push(docs);
    return docs.map((doc, index) => ({
      ...doc,
      _id: `507f1f77bcf86cd7994391${String(index).padStart(2, '0')}`,
    }));
  };
  ProductVariantModel.deleteMany = async (query) => {
    captured.variantDeleteCalls.push(query);
    return { deletedCount: 0 };
  };
  ProductVariantModel.find = async () => options.existingVariants || [];
  ProductVariantModel.updateMany = async () => ({ modifiedCount: 0 });

  const business = {
    _id: businessId,
    owner: ownerId,
    subscriptionId,
    subscriptionPlanId: planId,
  };
  const subscription = {
    _id: subscriptionId,
    userId: ownerId,
    businessId,
    subscriptionPlanId: planId,
    status: 'active',
    paymentStatus: 'PENDING',
    endDate: new Date('2099-01-01T00:00:00.000Z'),
  };
  const subscriptionPlan = {
    _id: planId,
    name: 'Silver Plan',
    limits: {
      productListings: 1,
      serviceListings: 1,
      foodListings: 1,
      galleryImageLimit,
      imageLimit: galleryImageLimit,
    },
  };

  const Business = {
    async findOne(query) {
      captured.businessQueries.push(query);
      return business;
    },
  };
  const Subscription = {
    async findById(id) {
      captured.subscriptionFindById.push(id);
      return subscription;
    },
    findOne() {
      captured.subscriptionFallbackCalls += 1;
      return { sort: async () => null };
    },
  };
  const SubscriptionPlan = {
    async findById(id) {
      captured.planFindById.push(id);
      return subscriptionPlan;
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Product')) return ProductModel;
    if (request.endsWith('models/ProductVariant')) return ProductVariantModel;
    if (request.endsWith('models/Business')) return Business;
    if (request.endsWith('models/Subscription')) return Subscription;
    if (request.endsWith('models/SubscriptionPlan')) return SubscriptionPlan;
    if (request.endsWith('models/Service')) return {};
    if (request.endsWith('models/Food')) return {};
    if (request.endsWith('models/VendorOnboardingStage1')) {
      return { findOne: async () => null };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) return async () => {};
    if (request.endsWith('@aws-sdk/client-s3')) return awsMocks();
    if (request.endsWith('@aws-sdk/s3-request-presigner')) {
      return { getSignedUrl: async () => 'https://signed.example/upload' };
    }
    if (request === 'express-validator') {
      return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
    }
    return originalLoad(request, parent, isMain);
  };

  let controller;
  try {
    delete require.cache[productControllerPath];
    delete require.cache[listingQuotaServicePath];
    delete require.cache[publicMarketplaceStatesPath];
    controller = require(productControllerPath);
  } finally {
    Module._load = originalLoad;
  }

  return { controller, captured, existingProduct };
}

function createRequest(overrides = {}) {
  return {
    user: { _id: ownerId },
    body: {
      title: 'New product',
      description: 'Product description',
      categoryId: 'category-1',
      subcategoryId: 'subcategory-1',
      businessId,
      coverImage: 'cover.jpg',
      galleryImages: [],
      variants: [buildVariant()],
      isPublished: true,
      ...overrides,
    },
  };
}

function updateRequest(body) {
  return {
    params: { productId },
    user: { _id: ownerId },
    body,
  };
}

function assertExactBusinessEntitlement(captured) {
  assert.deepEqual(captured.businessQueries, [{ _id: businessId, owner: ownerId }]);
  assert.deepEqual(captured.subscriptionFindById, [subscriptionId]);
  assert.equal(captured.subscriptionFallbackCalls, 0);
  assert.deepEqual(captured.planFindById, [planId]);
}

function assertPublicProductCountQuery(captured) {
  assert.deepEqual(captured.productCountQueries, [{
    businessId,
    isDeleted: false,
    isPublished: true,
    isActive: { $ne: false },
  }]);
}

test('9 published products plus 20 drafts allows the tenth published product', async () => {
  const { controller, captured } = loadProductQuotaController({
    records: [...publishedRecords(9), ...draftRecords(20)],
  });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.productConstructCalls, 1);
  assert.equal(captured.productSaveCalls, 1);
  assert.equal(captured.variantInsertCalls.length, 1);
  assertPublicProductCountQuery(captured);
  assertExactBusinessEntitlement(captured);
});

test('9 published products plus 5 inactive products allows another published product', async () => {
  const { controller, captured } = loadProductQuotaController({
    records: [...publishedRecords(9), ...inactiveRecords(5)],
  });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.productConstructCalls, 1);
  assertPublicProductCountQuery(captured);
  assertExactBusinessEntitlement(captured);
});

test('10 published products blocks before save with deterministic LISTING_LIMIT_REACHED metadata', async () => {
  const { controller, captured } = loadProductQuotaController({ records: publishedRecords(10) });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    code: 'LISTING_LIMIT_REACHED',
    error: 'Product listing limit reached for Silver. Limit 10, current 10, attempted increase 1.',
    message: 'Product listing limit reached for Silver. Limit 10, current 10, attempted increase 1.',
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 10,
    attemptedIncrease: 1,
    remaining: 0,
  });
  assert.equal(captured.productConstructCalls, 0);
  assert.equal(captured.productSaveCalls, 0);
  assert.equal(captured.variantInsertCalls.length, 0);
  assertPublicProductCountQuery(captured);
  assertExactBusinessEntitlement(captured);
});

test('draft creation is allowed at the published cap and variants never consume product quota', async () => {
  const variants = Array.from({ length: 12 }, (_, index) => buildVariant(index));
  const { controller, captured } = loadProductQuotaController({ records: publishedRecords(10) });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest({
    isPublished: false,
    variants,
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.productCountQueries.length, 0);
  assert.equal(captured.variantCountCalls, 0);
  assert.equal(captured.variantInsertCalls.length, 1);
  assert.equal(captured.variantInsertCalls[0].length, 12);
  assert.ok(captured.variantInsertCalls[0].every((variant) => variant.isPublished === false));
  assertExactBusinessEntitlement(captured);
});

test('draft to published update blocks at the Silver cap before saving', async () => {
  const { controller, captured } = loadProductQuotaController({
    records: publishedRecords(10),
    existingProduct: { isPublished: false, galleryImages: [] },
  });
  const res = mockResponse();

  await controller.updateProduct(updateRequest({ isPublished: true }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(res.body.current, 10);
  assert.equal(res.body.attemptedIncrease, 1);
  assert.equal(captured.productSaveCalls, 0);
  assert.equal(captured.variantDeleteCalls.length, 0);
  assertPublicProductCountQuery(captured);
  assertExactBusinessEntitlement(captured);
});

test('already-published metadata edit remains allowed above downgraded listing and image limits', async () => {
  const galleryImages = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'];
  const { controller, captured, existingProduct } = loadProductQuotaController({
    records: publishedRecords(15),
    galleryImageLimit: 3,
    existingProduct: {
      isPublished: true,
      galleryImages,
      price: 10,
    },
  });
  const res = mockResponse();

  await controller.updateProduct(updateRequest({ title: 'Metadata edit' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(existingProduct.title, 'Metadata edit');
  assert.equal(existingProduct.isPublished, true);
  assert.deepEqual(existingProduct.galleryImages, galleryImages);
  assert.equal(existingProduct.price, 10);
  assert.equal(captured.variantDeleteCalls.length, 0);
  assert.equal(captured.productCountQueries.length, 0);
  assert.ok(captured.productSaveCalls > 0);
  assertExactBusinessEntitlement(captured);
});

test('reducing an over-limit gallery remains allowed after downgrade', async () => {
  const { controller, captured, existingProduct } = loadProductQuotaController({
    records: publishedRecords(15),
    galleryImageLimit: 3,
    existingProduct: {
      isPublished: true,
      galleryImages: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'],
      price: 10,
    },
  });
  const res = mockResponse();
  const reducedGallery = ['1.jpg', '2.jpg', '3.jpg', '4.jpg'];

  await controller.updateProduct(updateRequest({ galleryImages: reducedGallery }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(existingProduct.galleryImages, reducedGallery);
  assert.equal(existingProduct.isPublished, true);
  assert.equal(captured.productCountQueries.length, 0);
  assertExactBusinessEntitlement(captured);
});

test('creating a product with a gallery above the plan limit blocks before construction', async () => {
  const { controller, captured } = loadProductQuotaController({
    records: publishedRecords(10),
    galleryImageLimit: 3,
  });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest({
    isPublished: false,
    galleryImages: ['1.jpg', '2.jpg', '3.jpg', '4.jpg'],
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'IMAGE_LIMIT_REACHED');
  assert.equal(res.body.limit, 3);
  assert.equal(res.body.current, 0);
  assert.equal(res.body.next, 4);
  assert.equal(res.body.attemptedIncrease, 4);
  assert.equal(captured.productConstructCalls, 0);
  assert.equal(captured.productSaveCalls, 0);
  assert.equal(captured.productCountQueries.length, 0);
  assertExactBusinessEntitlement(captured);
});

test('increasing an existing gallery above the plan limit blocks before save', async () => {
  const { controller, captured } = loadProductQuotaController({
    galleryImageLimit: 3,
    existingProduct: {
      isPublished: true,
      galleryImages: ['1.jpg', '2.jpg'],
      price: 10,
    },
  });
  const res = mockResponse();

  await controller.updateProduct(updateRequest({
    galleryImages: ['1.jpg', '2.jpg', '3.jpg', '4.jpg'],
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'IMAGE_LIMIT_REACHED');
  assert.equal(res.body.limit, 3);
  assert.equal(res.body.current, 2);
  assert.equal(res.body.next, 4);
  assert.equal(res.body.attemptedIncrease, 2);
  assert.equal(captured.productSaveCalls, 0);
  assert.equal(captured.variantDeleteCalls.length, 0);
  assertExactBusinessEntitlement(captured);
});
