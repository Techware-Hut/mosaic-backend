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
    subscriptionId: '507f1f77bcf86cd799439016',
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

function buildSubscription(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439016',
    userId: ownerId,
    businessId,
    subscriptionPlanId: '507f1f77bcf86cd799439017',
    status: 'active',
    endDate: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

function buildSubscriptionPlan(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439017',
    name: 'Silver Plan',
    limits: {
      productListings: 10,
      serviceListings: 5,
      foodListings: 5,
      imageLimit: 10,
      videoLimit: 1,
    },
    ...overrides,
  };
}

function buildCreateBody(overrides = {}) {
  return {
    title: 'Published supper',
    description: 'Freshly prepared',
    price: 20,
    categoryId: '507f1f77bcf86cd799439014',
    subcategoryId: '507f1f77bcf86cd799439015',
    businessId,
    images: [],
    ...overrides,
  };
}

function quotaFailure(overrides = {}) {
  return {
    ok: false,
    status: 403,
    code: 'LISTING_LIMIT_REACHED',
    error: 'Food listing limit reached for Silver Plan.',
    message: 'Food listing limit reached for Silver Plan.',
    listingType: 'food',
    tier: 'Silver',
    limit: 5,
    current: 5,
    attemptedIncrease: 1,
    projected: 6,
    remaining: 0,
    ...overrides,
  };
}

function loadController(options = {}) {
  const {
    food = buildFood(),
    business = buildBusiness(),
    subscription = buildSubscription(),
    subscriptionPlan = buildSubscriptionPlan(),
    quotaResult = {
      ok: true,
      listingType: 'food',
      tier: 'Silver',
      limit: 5,
      current: 4,
      attemptedIncrease: 1,
      projected: 5,
      remaining: 0,
    },
    quotaCalls = [],
    savedFoods = [],
    foodCountQueries = [],
    directFoodCount = 0,
  } = options;

  if (typeof food.toObject !== 'function') {
    Object.defineProperty(food, 'toObject', {
      enumerable: false,
      value() {
        return { ...this };
      },
    });
  }
  if (typeof food.save !== 'function') {
    Object.defineProperty(food, 'save', {
      enumerable: false,
      async value() {
        savedFoods.push(this);
        return this;
      },
    });
  }

  function FoodModel(payload) {
    Object.assign(this, payload);
    this._id = foodId;
  }
  FoodModel.prototype.save = async function save() {
    savedFoods.push(this);
    return this;
  };
  FoodModel.findOne = (query) => {
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
  };
  FoodModel.findById = () => makeQuery(null);
  FoodModel.countDocuments = async (query) => {
    foodCountQueries.push(query);
    return directFoodCount;
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Food')) {
      return FoodModel;
    }
    if (request.endsWith('models/Business')) {
      return {
        findOne: (query) => {
          if (query._id === businessId && query.owner === ownerId) {
            return makeQuery(business);
          }
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
      return { findOne: () => makeQuery(subscription) };
    }
    if (request.endsWith('models/SubscriptionPlan')) {
      return { findById: async () => subscriptionPlan };
    }
    if (request.endsWith('services/listingQuotaService')) {
      return {
        checkBusinessListingQuota: async (input) => {
          quotaCalls.push(input);
          return typeof quotaResult === 'function'
            ? quotaResult(input)
            : quotaResult;
        },
      };
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

test('published food create uses only the food quota and allows four published plus drafts or inactive rows', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const foodCountQueries = [];
  const controller = loadController({
    quotaCalls,
    savedFoods,
    foodCountQueries,
    directFoodCount: 99,
    quotaResult: {
      ok: true,
      listingType: 'food',
      tier: 'Silver',
      limit: 5,
      current: 4,
      attemptedIncrease: 1,
      projected: 5,
      remaining: 0,
    },
  });
  const res = mockResponse();

  await controller.createFood({
    user: { _id: ownerId },
    body: buildCreateBody({ isPublished: 'true' }),
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(savedFoods.length, 1);
  assert.equal(savedFoods[0].isPublished, true);
  assert.equal(quotaCalls.length, 1);
  assert.equal(quotaCalls[0].business._id, businessId);
  assert.equal(quotaCalls[0].userId, ownerId);
  assert.equal(quotaCalls[0].listingType, 'food');
  assert.equal(quotaCalls[0].attemptedIncrease, 1);
  assert.deepEqual(Object.keys(quotaCalls[0].models), ['Food']);
  assert.equal(foodCountQueries.length, 0, 'controller must not count all owner food rows directly');
});

test('a sixth published food blocks with deterministic LISTING_LIMIT_REACHED details', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const controller = loadController({
    quotaCalls,
    savedFoods,
    quotaResult: quotaFailure(),
  });
  const res = mockResponse();

  await controller.createFood({
    user: { _id: ownerId },
    body: buildCreateBody({ isPublished: true }),
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(res.body.listingType, 'food');
  assert.equal(res.body.limit, 5);
  assert.equal(res.body.current, 5);
  assert.equal(res.body.attemptedIncrease, 1);
  assert.equal(res.body.projected, 6);
  assert.equal(res.body.remaining, 0);
  assert.equal(quotaCalls.length, 1);
  assert.equal(savedFoods.length, 0);
});

test('draft food create normalizes string false and does not consume or check quota', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const controller = loadController({
    quotaCalls,
    savedFoods,
    quotaResult: quotaFailure(),
  });
  const res = mockResponse();

  await controller.createFood({
    user: { _id: ownerId },
    body: buildCreateBody({ isPublished: 'false' }),
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(quotaCalls.length, 0);
  assert.equal(savedFoods.length, 1);
  assert.equal(savedFoods[0].isPublished, false);
});

test('active draft to published food transition checks a positive delta and blocks at cap', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const food = buildFood({ isPublished: false, isActive: true });
  const controller = loadController({
    food,
    quotaCalls,
    savedFoods,
    quotaResult: quotaFailure(),
  });
  const res = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { isPublished: 'true' },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(quotaCalls.length, 1);
  assert.equal(quotaCalls[0].listingType, 'food');
  assert.equal(quotaCalls[0].attemptedIncrease, 1);
  assert.equal(savedFoods.length, 0);
  assert.equal(food.isPublished, false);
});

test('active draft to published food transition saves when one food slot remains', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const food = buildFood({ isPublished: false, isActive: true });
  const controller = loadController({
    food,
    quotaCalls,
    savedFoods,
  });
  const res = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { isPublished: 'true' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(quotaCalls.length, 1);
  assert.equal(quotaCalls[0].attemptedIncrease, 1);
  assert.equal(savedFoods.length, 1);
  assert.equal(food.isPublished, true);
});

test('publishing an inactive draft is a zero-delta update and does not check quota', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const food = buildFood({ isPublished: false, isActive: false });
  const controller = loadController({
    food,
    quotaCalls,
    savedFoods,
    quotaResult: quotaFailure(),
  });
  const res = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { isPublished: 'true' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(quotaCalls.length, 0);
  assert.equal(savedFoods.length, 1);
  assert.equal(food.isPublished, true);
  assert.equal(food.isActive, false);
});

test('metadata update on an existing published food remains safe above a downgraded cap', async () => {
  const quotaCalls = [];
  const savedFoods = [];
  const food = buildFood({ isPublished: true, isActive: true });
  const controller = loadController({
    food,
    quotaCalls,
    savedFoods,
    quotaResult: quotaFailure({ current: 8, projected: 8, attemptedIncrease: 0 }),
  });
  const res = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { title: 'Updated without republishing' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(quotaCalls.length, 0);
  assert.equal(savedFoods.length, 1);
  assert.equal(food.title, 'Updated without republishing');
  assert.equal(food.isPublished, true);
});
