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
const variantId = '507f1f77bcf86cd799439017';
const originalProductListingLimitOverride = process.env.PRODUCT_LISTING_LIMIT_OVERRIDE;

test.before(() => {
  process.env.PRODUCT_LISTING_LIMIT_OVERRIDE = '10';
});

test.after(() => {
  if (originalProductListingLimitOverride === undefined) {
    delete process.env.PRODUCT_LISTING_LIMIT_OVERRIDE;
  } else {
    process.env.PRODUCT_LISTING_LIMIT_OVERRIDE = originalProductListingLimitOverride;
  }
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

function productRecord(index, overrides = {}) {
  return {
    _id: `product-${index}`,
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
  return Array.from({ length: count }, (_, index) =>
    productRecord(`draft-${index}`, { isPublished: false })
  );
}

function inactiveRecords(count) {
  return Array.from({ length: count }, (_, index) =>
    productRecord(`inactive-${index}`, { isActive: false })
  );
}

function matchesProductQuery(record, query) {
  if (String(record.businessId) !== String(query.businessId)) return false;
  if (query.isDeleted !== undefined && record.isDeleted !== query.isDeleted) return false;
  if (query.isPublished !== undefined && record.isPublished !== query.isPublished) return false;
  if (query.isActive?.$ne !== undefined && record.isActive === query.isActive.$ne) return false;
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

function loadProductController(options = {}) {
  const records = options.records || [];
  const captured = {
    productCountQueries: [],
    productConstructCalls: 0,
    productSaveCalls: 0,
    productUpdateCalls: [],
    productDeleteCalls: [],
    variantCountCalls: 0,
    variantInsertCalls: [],
    variantSaveCalls: 0,
    serviceCountCalls: 0,
    foodCountCalls: 0,
    businessFindOneCalls: [],
    businessFindByIdCalls: [],
    subscriptionFindOneCalls: 0,
    subscriptionFindByIdCalls: [],
  };

  const existingProduct = options.existingProduct
    ? {
        _id: productId,
        ownerId,
        businessId,
        title: 'Existing product',
        description: 'Existing description',
        categoryId: 'category-1',
        subcategoryId: 'subcategory-1',
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
        ...options.existingProduct,
      }
    : null;

  const existingVariant = options.existingVariant
    ? {
        _id: variantId,
        productId,
        ownerId,
        businessId,
        attributes: new Map([['Size', 'M']]),
        sku: 'EXISTING-SKU',
        price: 10,
        salePrice: null,
        stock: 2,
        images: [],
        isPublished: false,
        isDeleted: false,
        toObject() {
          return { ...this };
        },
        async save() {
          captured.variantSaveCalls += 1;
          return this;
        },
        ...options.existingVariant,
      }
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
    return records.filter((record) => matchesProductQuery(record, query)).length;
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
    this._id = variantId;
    this.save = async () => {
      captured.variantSaveCalls += 1;
      return this;
    };
  }

  ProductVariantModel.countDocuments = async () => {
    captured.variantCountCalls += 1;
    return 999;
  };
  ProductVariantModel.findOne = async (query) => {
    if (existingVariant && String(query._id) === String(existingVariant._id)) {
      return existingVariant;
    }
    return null;
  };
  ProductVariantModel.insertMany = async (docs) => {
    captured.variantInsertCalls.push(docs);
    return docs.map((doc, index) => ({ ...doc, _id: `variant-${index}` }));
  };
  ProductVariantModel.deleteMany = async () => ({ deletedCount: 0 });
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
    paymentStatus: 'PAID',
    endDate: new Date('2099-01-01T00:00:00.000Z'),
  };
  const plan = {
    _id: planId,
    name: 'Silver Plan',
    limits: {
      productListings: 10,
      serviceListings: 5,
      foodListings: 5,
      galleryImageLimit: 100,
      imageLimit: 100,
    },
  };

  const Business = {
    async findOne(query) {
      captured.businessFindOneCalls.push(query);
      return business;
    },
    async findById(id) {
      captured.businessFindByIdCalls.push(id);
      return business;
    },
  };
  const Subscription = {
    findOne() {
      captured.subscriptionFindOneCalls += 1;
      return { sort: async () => subscription };
    },
    async findById(id) {
      captured.subscriptionFindByIdCalls.push(id);
      return subscription;
    },
  };
  const SubscriptionPlan = {
    async findById() {
      return plan;
    },
  };
  const Service = {
    async countDocuments() {
      captured.serviceCountCalls += 1;
      return 100;
    },
  };
  const Food = {
    async countDocuments() {
      captured.foodCountCalls += 1;
      return 100;
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Product')) return ProductModel;
    if (request.endsWith('models/ProductVariant')) return ProductVariantModel;
    if (request.endsWith('models/Business')) return Business;
    if (request.endsWith('models/Subscription')) return Subscription;
    if (request.endsWith('models/SubscriptionPlan')) return SubscriptionPlan;
    if (request.endsWith('models/Service')) return Service;
    if (request.endsWith('models/Food')) return Food;
    if (request.endsWith('models/VendorOnboardingStage1')) {
      return { findOne: async () => null };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) return async () => {};
    if (request.endsWith('@aws-sdk/client-s3')) {
      return {
        S3Client: class S3Client {},
        PutObjectCommand: class PutObjectCommand {},
      };
    }
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

  return { controller, captured, existingProduct, existingVariant };
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

function assertPublicProductQuery(captured) {
  assert.deepEqual(captured.productCountQueries, [{
    businessId,
    isDeleted: false,
    isPublished: true,
    isActive: { $ne: false },
  }]);
}

test('9 published products plus 20 drafts allows the tenth published product', async () => {
  const { controller, captured } = loadProductController({
    records: [...publishedRecords(9), ...draftRecords(20)],
  });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.productConstructCalls, 1);
  assertPublicProductQuery(captured);
});

test('9 published products plus 5 inactive products allows another published product', async () => {
  const { controller, captured } = loadProductController({
    records: [...publishedRecords(9), ...inactiveRecords(5)],
  });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.productConstructCalls, 1);
  assertPublicProductQuery(captured);
});

test('10 published Silver products block before product or variant writes', async () => {
  const { controller, captured } = loadProductController({ records: publishedRecords(10) });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(res.body.status, 403);
  assert.equal(res.body.listingType, 'product');
  assert.equal(res.body.tier, 'Silver');
  assert.equal(res.body.limit, 10);
  assert.equal(res.body.current, 10);
  assert.equal(res.body.attemptedIncrease, 1);
  assert.equal(res.body.projected, 11);
  assert.equal(res.body.remaining, 0);
  assert.equal(captured.productConstructCalls, 0);
  assert.equal(captured.productSaveCalls, 0);
  assert.equal(captured.variantInsertCalls.length, 0);
  assertPublicProductQuery(captured);
});

test('ProductVariants and other listing categories never consume product quota', async () => {
  const variants = Array.from({ length: 20 }, (_, index) => buildVariant(index));
  const { controller, captured } = loadProductController({ records: publishedRecords(9) });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest({ variants }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.variantCountCalls, 0);
  assert.equal(captured.serviceCountCalls, 0);
  assert.equal(captured.foodCountCalls, 0);
  assert.equal(captured.variantInsertCalls[0].length, 20);
  assertPublicProductQuery(captured);
});

test('string false creates a draft at the published cap without a quota count', async () => {
  const { controller, captured } = loadProductController({ records: publishedRecords(10) });
  const res = mockResponse();

  await controller.createProductWithVariants(createRequest({ isPublished: 'false' }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(captured.productCountQueries.length, 0);
  assert.equal(captured.variantInsertCalls.length, 1);
  assert.ok(captured.variantInsertCalls[0].every((variant) => variant.isPublished === false));
});

test('draft to published update blocks at the Silver cap before saving', async () => {
  const { controller, captured } = loadProductController({
    records: publishedRecords(10),
    existingProduct: { isPublished: false, isActive: true },
  });
  const res = mockResponse();

  await controller.updateProduct(
    {
      params: { productId },
      user: { _id: ownerId },
      body: { isPublished: 'true' },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(captured.productSaveCalls, 0);
  assertPublicProductQuery(captured);
});

test('unpublishing remains allowed after a downgrade leaves the business over cap', async () => {
  const { controller, captured, existingProduct } = loadProductController({
    records: publishedRecords(15),
    existingProduct: { isPublished: true, isActive: true },
  });
  const res = mockResponse();

  await controller.updateProduct(
    {
      params: { productId },
      user: { _id: ownerId },
      body: { isPublished: 'false' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(existingProduct.isPublished, false);
  assert.equal(captured.productCountQueries.length, 0);
});

test('variant auto-publish cannot publish its draft parent above the product cap', async () => {
  const { controller, captured } = loadProductController({
    records: publishedRecords(10),
    existingProduct: { isPublished: false, isActive: true },
    existingVariant: { isPublished: false },
  });
  const res = mockResponse();

  await controller.updateVariant(
    {
      params: { productId, variantId },
      user: { _id: ownerId },
      body: { isPublished: 'true' },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(captured.variantSaveCalls, 0);
  assert.equal(captured.productSaveCalls, 0);
  assertPublicProductQuery(captured);
});

test('adding variants to an existing published product preserves subscription gating but does not spend listing quota', async () => {
  const { controller, captured } = loadProductController({
    records: publishedRecords(10),
    existingProduct: { isPublished: true, isActive: true },
  });
  const res = mockResponse();

  await controller.addVariants(
    {
      params: { productId },
      user: { _id: ownerId },
      body: { variants: [buildVariant()] },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(captured.subscriptionFindOneCalls, 1);
  assert.equal(captured.productCountQueries.length, 0);
  assert.equal(captured.variantCountCalls, 0);
  assert.equal(captured.variantInsertCalls.length, 1);
});
