const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/foodController.js');

const ownerId = '507f1f77bcf86cd799439011';
const businessId = '507f1f77bcf86cd799439012';
const foodId = '507f1f77bcf86cd799439013';

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

function buildBusiness(overrides = {}) {
  return {
    _id: businessId,
    owner: ownerId,
    businessName: 'QA Foods',
    isActive: true,
    isApproved: true,
    ...overrides,
  };
}

function buildFood(overrides = {}) {
  return {
    _id: foodId,
    ownerId,
    businessId: {
      _id: businessId,
      owner: ownerId,
      businessName: 'QA Foods',
    },
    title: 'Draft supper',
    description: 'Draft only',
    price: 20,
    categoryId: { _id: '507f1f77bcf86cd799439014', name: 'Meals' },
    subcategoryId: { _id: '507f1f77bcf86cd799439015', name: 'Dinner' },
    isPublished: false,
    isActive: true,
    coverImage: '',
    images: [],
    menuImage: '',
    businessHours: [],
    bookingToolLink: '',
    metaFields: [],
    location: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function loadController(options = {}) {
  const {
    food = buildFood(),
    business = buildBusiness(),
  } = options;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Food')) {
      return {
        findOne: (query) => {
          if (query.isPublished === true && food.isPublished !== true) {
            return makeQuery(null);
          }
          if (
            query.isActive &&
            query.isActive.$ne === false &&
            food.isActive === false
          ) {
            return makeQuery(null);
          }
          if (query._id === foodId || query._id === food._id) {
            return makeQuery(food);
          }
          if (query.businessId === businessId) {
            return makeQuery(food);
          }
          return makeQuery(null);
        },
        findById: () => makeQuery(null),
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        findOne: (query) => {
          if (
            query._id === businessId &&
            query.isActive === true &&
            query.isApproved === true
          ) {
            return makeQuery(
              business.isApproved === true && business.isActive === true
                ? business
                : null
            );
          }
          return makeQuery(null);
        },
      };
    }
    if (request.endsWith('models/Subscription')) {
      return { findOne: () => ({ sort: async () => null }) };
    }
    if (request.endsWith('models/SubscriptionPlan')) {
      return { findById: async () => null };
    }
    if (request.endsWith('@aws-sdk/client-s3')) {
      return {
        S3Client: class S3Client {},
        PutObjectCommand: class PutObjectCommand {},
      };
    }
    if (request.endsWith('@aws-sdk/s3-request-presigner')) {
      return { getSignedUrl: async () => 'signed-url' };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
}

test('legacy business-food lookup hides unpublished draft food', async () => {
  const controller = loadController({
    food: buildFood({ isPublished: false }),
  });
  const res = mockResponse();

  await controller.getBusinessFoodById({ params: { id: foodId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Business food not found.');
});

test('legacy business-food lookup hides inactive published food', async () => {
  const controller = loadController({
    food: buildFood({ isPublished: true, isActive: false }),
  });
  const res = mockResponse();

  await controller.getBusinessFoodById({ params: { id: businessId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Business food not found.');
});

test('legacy business-food lookup returns published active food for eligible business', async () => {
  const controller = loadController({
    food: buildFood({ isPublished: true, isActive: true, title: 'Live Brunch' }),
  });
  const res = mockResponse();

  await controller.getBusinessFoodById({ params: { id: foodId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.food.title, 'Live Brunch');
  assert.equal(res.body.food.isPublished, true);
});
