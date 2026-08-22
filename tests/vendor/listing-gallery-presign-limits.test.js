const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ownerId = '507f1f77bcf86cd799439011';
const otherOwnerId = '507f1f77bcf86cd799439099';
const businessId = '507f1f77bcf86cd799439012';
const listingId = '507f1f77bcf86cd799439013';
const missingListingId = '507f1f77bcf86cd799439014';
const subscriptionId = '507f1f77bcf86cd799439015';
const subscriptionPlanId = '507f1f77bcf86cd799439016';

const listingQuotaServicePath = path.resolve(
  __dirname,
  '../../services/listingQuotaService.js'
);
const publicMarketplaceStatesPath = path.resolve(
  __dirname,
  '../../lib/listing/publicMarketplaceStates.js'
);

const LISTING_CASES = [
  {
    type: 'product',
    controllerPath: path.resolve(__dirname, '../../controllers/productController.js'),
    handlerName: 'getProductUploadUrl',
    idParam: 'productId',
    galleryField: 'galleryImages',
    documentType: 'product-gallery',
    notFoundCode: 'PRODUCT_NOT_FOUND',
  },
  {
    type: 'service',
    controllerPath: path.resolve(__dirname, '../../controllers/serviceController.js'),
    handlerName: 'getServiceUploadUrl',
    idParam: 'serviceId',
    galleryField: 'images',
    documentType: 'service-gallery',
    notFoundCode: 'SERVICE_NOT_FOUND',
  },
  {
    type: 'food',
    controllerPath: path.resolve(__dirname, '../../controllers/foodController.js'),
    handlerName: 'getFoodUploadUrl',
    idParam: 'foodId',
    galleryField: 'images',
    documentType: 'food-gallery',
    notFoundCode: 'FOOD_NOT_FOUND',
  },
];

function mockResponse() {
  return {
    statusCode: 200,
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

function baseQuery(listingCase, overrides = {}) {
  return {
    fileName: 'gallery.jpg',
    fileType: 'image/jpeg',
    fileSize: '1024',
    documentType: listingCase.documentType,
    ...overrides,
  };
}

function buildListing(listingCase, overrides = {}) {
  return {
    _id: listingId,
    ownerId,
    businessId,
    isDeleted: false,
    [listingCase.galleryField]: ['one.jpg', 'two.jpg'],
    ...overrides,
  };
}

function idsMatch(left, right) {
  return String(left) === String(right);
}

function matchesListingQuery(listingCase, listing, query) {
  if (!listing) return false;
  if (query._id !== undefined && !idsMatch(query._id, listing._id)) return false;
  if (query.ownerId !== undefined && !idsMatch(query.ownerId, listing.ownerId)) return false;
  if (
    listingCase.type === 'product' &&
    query.isDeleted === false &&
    listing.isDeleted === true
  ) {
    return false;
  }
  return true;
}

function buildUploadedMediaResponse(payload) {
  return {
    ...payload,
    url: payload.fileUrl,
    mediaUrl: payload.fileUrl,
    location: payload.fileUrl,
  };
}

function loadPresignHandler(listingCase, options = {}) {
  const listing = options.listing === undefined
    ? buildListing(listingCase)
    : options.listing;
  const business = options.business || {
    _id: businessId,
    owner: ownerId,
    subscriptionId,
  };
  const subscription = options.subscription || {
    _id: subscriptionId,
    userId: ownerId,
    businessId,
    subscriptionPlanId,
    paymentStatus: 'COMPLETED',
    status: 'active',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    endDate: new Date('2099-01-01T00:00:00.000Z'),
  };
  const subscriptionPlan = options.subscriptionPlan || {
    _id: subscriptionPlanId,
    name: 'Silver Plan',
    limits: {
      productListings: 10,
      serviceListings: 5,
      foodListings: 5,
      imageLimit: 2,
      videoLimit: 1,
    },
  };

  const state = {
    listingQueries: [],
    businessQueries: [],
    subscriptionFindByIds: [],
    subscriptionFallbackQueries: [],
    planFindByIds: [],
    signedUrlCalls: [],
    putObjectInputs: [],
  };

  function listingModelFor(type) {
    return {
      findOne: async (query) => {
        if (type === listingCase.type) state.listingQueries.push(query);
        const candidate = type === listingCase.type ? listing : null;
        return matchesListingQuery(listingCase, candidate, query) ? candidate : null;
      },
      countDocuments: async () => 0,
      aggregate: async () => [],
    };
  }

  const Product = listingModelFor('product');
  const Service = listingModelFor('service');
  const Food = listingModelFor('food');

  const Business = {
    findOne: async (query) => {
      state.businessQueries.push(query);
      if (!business) return null;
      if (query._id !== undefined && !idsMatch(query._id, business._id)) return null;
      if (query.owner !== undefined && !idsMatch(query.owner, business.owner)) return null;
      return business;
    },
  };

  const Subscription = {
    findById: async (id) => {
      state.subscriptionFindByIds.push(id);
      return subscription && idsMatch(id, subscription._id) ? subscription : null;
    },
    findOne: (query) => {
      state.subscriptionFallbackQueries.push(query);
      return {
        sort: async () => subscription,
      };
    },
  };

  const SubscriptionPlan = {
    findById: async (id) => {
      state.planFindByIds.push(id);
      return subscriptionPlan && idsMatch(id, subscriptionPlan._id)
        ? subscriptionPlan
        : null;
    },
  };

  class S3Client {}
  class PutObjectCommand {
    constructor(input) {
      this.input = input;
      state.putObjectInputs.push(input);
    }
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/ProductVariant')) return {};
    if (request.endsWith('models/Product')) return Product;
    if (request.endsWith('models/ServiceCategory')) return {};
    if (request.endsWith('models/ServiceSubcategory')) return {};
    if (request.endsWith('models/Service')) return Service;
    if (request.endsWith('models/Food')) return Food;
    if (request.endsWith('models/Business')) return Business;
    if (request.endsWith('models/SubscriptionPlan')) return SubscriptionPlan;
    if (request.endsWith('models/Subscription')) return Subscription;
    if (request.endsWith('models/PendingImage')) {
      return { deleteMany: async () => {}, deleteOne: async () => {} };
    }
    if (request.endsWith('models/VendorOnboardingStage1')) return {};
    if (request.endsWith('utils/deleteCloudinaryFile')) return async () => {};
    if (request.endsWith('utils/geocode')) return { safeGeocodeAddress: async () => null };
    if (request.endsWith('utils/bookingDeleteGuards')) {
      return {
        hasActiveFoodBookings: async () => false,
        hasActiveServiceBookings: async () => false,
      };
    }
    if (request.endsWith('utils/uploadDiagnostics')) {
      return {
        buildUploadedMediaResponse,
        buildUploadStorageConfigError: () => ({ success: false }),
        getMissingS3UploadEnvNames: () => [],
        logUploadConfigFailure: () => {},
        logUploadFailure: () => {},
      };
    }
    if (request === '@aws-sdk/client-s3') {
      return { S3Client, PutObjectCommand };
    }
    if (request === '@aws-sdk/s3-request-presigner') {
      return {
        getSignedUrl: async (client, command, presignOptions) => {
          state.signedUrlCalls.push({ client, command, presignOptions });
          return 'https://signed.example/upload';
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  let controller;
  try {
    delete require.cache[listingCase.controllerPath];
    delete require.cache[listingQuotaServicePath];
    delete require.cache[publicMarketplaceStatesPath];
    controller = require(listingCase.controllerPath);
  } finally {
    Module._load = originalLoad;
  }

  return {
    handler: controller[listingCase.handlerName],
    state,
  };
}

async function invoke(handler, query) {
  const res = mockResponse();
  await handler(
    {
      user: { _id: ownerId },
      query,
    },
    res
  );
  return res;
}

function assertExactBusinessEntitlement(state) {
  assert.equal(state.businessQueries.length, 1);
  assert.deepEqual(state.businessQueries[0], { _id: businessId, owner: ownerId });
  assert.deepEqual(state.subscriptionFindByIds.map(String), [subscriptionId]);
  assert.deepEqual(state.planFindByIds.map(String), [subscriptionPlanId]);
  assert.equal(state.subscriptionFallbackQueries.length, 0);
}

for (const listingCase of LISTING_CASES) {
  test(`${listingCase.type} existing presign uses persisted gallery count and blocks at cap`, async () => {
    const { handler, state } = loadPresignHandler(listingCase);
    const res = await invoke(
      handler,
      baseQuery(listingCase, {
        [listingCase.idParam]: listingId,
        currentImageCount: '0',
      })
    );

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'IMAGE_LIMIT_REACHED');
    assert.equal(res.body.listingType, listingCase.type);
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.current, 2);
    assert.equal(res.body.next, 3);
    assert.equal(res.body.attemptedIncrease, 1);
    assert.equal(state.signedUrlCalls.length, 0);
    assert.equal(state.listingQueries.length, 1);
    assert.equal(String(state.listingQueries[0]._id), listingId);
    assert.equal(String(state.listingQueries[0].ownerId), ownerId);
    if (listingCase.type === 'product') {
      assert.equal(state.listingQueries[0].isDeleted, false);
    }
    assertExactBusinessEntitlement(state);
  });

  test(`${listingCase.type} existing presign hides wrong-owner and missing IDs`, async (t) => {
    await t.test('wrong owner', async () => {
      const wrongOwnerListing = buildListing(listingCase, { ownerId: otherOwnerId });
      const { handler, state } = loadPresignHandler(listingCase, {
        listing: wrongOwnerListing,
      });
      const res = await invoke(
        handler,
        baseQuery(listingCase, {
          [listingCase.idParam]: listingId,
          currentImageCount: '0',
        })
      );

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.code, listingCase.notFoundCode);
      assert.equal(state.signedUrlCalls.length, 0);
      assert.equal(String(state.listingQueries[0].ownerId), ownerId);
      assert.equal(state.businessQueries.length, 0);
    });

    await t.test('missing ID', async () => {
      const { handler, state } = loadPresignHandler(listingCase);
      const res = await invoke(
        handler,
        baseQuery(listingCase, {
          [listingCase.idParam]: missingListingId,
          currentImageCount: '0',
        })
      );

      assert.equal(res.statusCode, 404);
      assert.equal(res.body.code, listingCase.notFoundCode);
      assert.equal(state.signedUrlCalls.length, 0);
      assert.equal(state.businessQueries.length, 0);
    });
  });

  test(`${listingCase.type} create-time presign rejects invalid currentImageCount`, async (t) => {
    for (const invalidCount of ['-1', 'not-a-number']) {
      await t.test(invalidCount, async () => {
        const { handler, state } = loadPresignHandler(listingCase);
        const res = await invoke(
          handler,
          baseQuery(listingCase, {
            businessId,
            currentImageCount: invalidCount,
          })
        );

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.code, 'INVALID_IMAGE_COUNT');
        assert.equal(state.signedUrlCalls.length, 0);
        assert.equal(state.listingQueries.length, 0);
        assertExactBusinessEntitlement(state);
      });
    }
  });
}

test('existing product below gallery cap is signed using persisted count, not forged client count', async () => {
  const productCase = LISTING_CASES.find((entry) => entry.type === 'product');
  const listing = buildListing(productCase, { galleryImages: ['one.jpg'] });
  const { handler, state } = loadPresignHandler(productCase, { listing });
  const res = await invoke(
    handler,
    baseQuery(productCase, {
      productId: listingId,
      currentImageCount: '999',
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.uploadUrl, 'https://signed.example/upload');
  assert.equal(state.signedUrlCalls.length, 1);
  assert.equal(state.putObjectInputs.length, 1);
  assertExactBusinessEntitlement(state);
});
