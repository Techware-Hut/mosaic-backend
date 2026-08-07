const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const publicListingPath = path.resolve(
  __dirname,
  '../../controllers/publicListing.js'
);
const businessControllerPath = path.resolve(
  __dirname,
  '../../controllers/businessController.js'
);

const businessId = '507f1f77bcf86cd799439012';

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

function makeQuery(value) {
  const exec = async () => value;
  const query = {
    sort: () => query,
    populate: () => query,
    select: () => query,
    lean: () => exec(),
    exec,
    then: (resolve, reject) => exec().then(resolve, reject),
  };
  return query;
}

function loadPublicListingController({ eligibleIds = [] } = {}) {
  const business = {
    _id: businessId,
    businessName: 'Empty Storefront Co',
    listingType: 'product',
    isApproved: true,
    isActive: true,
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Business')) {
      return {
        findOne: () => makeQuery(business),
        find: () => makeQuery([]),
      };
    }
    if (request.endsWith('models/VendorOnboardingStage1')) {
      return { findOne: () => makeQuery(null) };
    }
    if (request.endsWith('../lib/marketplace/vendorDirectoryQuery')) {
      const real = originalLoad(request, parent, isMain);
      return {
        ...real,
        filterDirectoryBusinessesWithPublicListings: async () => eligibleIds,
      };
    }
    if (
      request.endsWith('models/Service') ||
      request.endsWith('models/Food') ||
      request.endsWith('models/Product') ||
      request.endsWith('models/Review') ||
      request.endsWith('models/ServiceCategory') ||
      request.endsWith('models/ServiceSubcategory') ||
      request.endsWith('models/FoodCategory') ||
      request.endsWith('models/FoodSubcategory') ||
      request.endsWith('models/ProductCategory') ||
      request.endsWith('models/ProductSubcategory') ||
      request.endsWith('models/ProductVariant')
    ) {
      return {
        find: () => makeQuery([]),
        findOne: () => makeQuery(null),
        findById: () => makeQuery(null),
        distinct: async () => [],
        countDocuments: async () => 0,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[publicListingPath];
  const controller = require(publicListingPath);
  Module._load = originalLoad;
  return controller;
}

function loadBusinessController({ eligibleIds = [] } = {}) {
  const business = {
    _id: businessId,
    businessName: 'Empty Product Shop',
    slug: 'empty-product-shop',
    listingType: 'product',
    isApproved: true,
    isActive: true,
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Business') || request === '../models/Business') {
      return {
        findOne: () => makeQuery(business),
        find: () => makeQuery([]),
      };
    }
    if (
      request.endsWith('../lib/marketplace/vendorDirectoryQuery') ||
      request.endsWith('lib/marketplace/vendorDirectoryQuery')
    ) {
      const real = originalLoad(request, parent, isMain);
      return {
        ...real,
        filterDirectoryBusinessesWithPublicListings: async () => eligibleIds,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[businessControllerPath];
  // businessController pulls many heavy deps — only exercise getBusinessBySlugPublic.
  const controller = require(businessControllerPath);
  Module._load = originalLoad;
  return controller;
}

test('getVendorProfile 404s when approved business has no live public listings', async () => {
  const controller = loadPublicListingController({ eligibleIds: [] });
  const res = mockResponse();

  await controller.getVendorProfile({ params: { businessId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});

test('getVendorProfile returns card when business has live type-matching listings', async () => {
  const controller = loadPublicListingController({
    eligibleIds: [businessId],
  });
  const res = mockResponse();

  await controller.getVendorProfile({ params: { businessId } }, res);

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.business.businessName, 'Empty Storefront Co');
});

test('getBusinessBySlugPublic 404s when product storefront has no live listings', async () => {
  const controller = loadBusinessController({ eligibleIds: [] });
  const res = mockResponse();

  await controller.getBusinessBySlugPublic(
    { params: { slug: 'empty-product-shop' } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});
