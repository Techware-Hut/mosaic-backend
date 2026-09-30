const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/foodController.js');
const listingQuotaServicePath = path.resolve(
  __dirname,
  '../../services/listingQuotaService.js'
);

const ownerId = '507f1f77bcf86cd799439011';
const businessId = '507f1f77bcf86cd799439012';
const foodId = '507f1f77bcf86cd799439013';
const categoryId = '507f1f77bcf86cd799439014';
const subcategoryId = '507f1f77bcf86cd799439015';
const subscriptionId = '507f1f77bcf86cd799439016';
const subscriptionPlanId = '507f1f77bcf86cd799439017';

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

function idString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value._id !== undefined) {
    return idString(value._id);
  }
  return String(value);
}

function sameId(left, right) {
  const leftId = idString(left);
  const rightId = idString(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function matchesQuery(record, query) {
  return Object.entries(query).every(([field, expected]) => {
    const actual = record[field];

    if (expected && typeof expected === 'object' && '$ne' in expected) {
      return !sameId(actual, expected.$ne);
    }

    return sameId(actual, expected);
  });
}

function buildBusiness(overrides = {}) {
  return {
    _id: businessId,
    owner: ownerId,
    subscriptionId,
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
    categoryId: { _id: categoryId, name: 'Meals' },
    subcategoryId: { _id: subcategoryId, name: 'Dinner' },
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
    _id: subscriptionId,
    userId: ownerId,
    businessId,
    subscriptionPlanId,
    status: 'active',
    endDate: new Date('2099-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildSubscriptionPlan(overrides = {}) {
  return {
    _id: subscriptionPlanId,
    name: 'Silver Plan',
    limits: {
      productListings: 10,
      serviceListings: 5,
      foodListings: 5,
      imageLimit: 3,
    },
    ...overrides,
  };
}

function buildCreateRequest(overrides = {}) {
  return {
    user: { _id: ownerId },
    body: {
      title: 'New supper',
      description: 'A food listing used by the quota regression tests.',
      price: 20,
      categoryId,
      subcategoryId,
      businessId,
      images: [],
      isPublished: true,
      ...overrides,
    },
  };
}

function publishedFoods(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `published-food-${index}`,
    businessId,
    isPublished: true,
    isActive: true,
    ...overrides,
  }));
}

function loadController(options = {}) {
  const {
    food = buildFood(),
    business = buildBusiness(),
    subscription = buildSubscription(),
    subscriptionPlan = buildSubscriptionPlan(),
    quotaFoods = [],
    countQueries = [],
    saveCalls = [],
    businessQueries = [],
    subscriptionFindByIdCalls = [],
    subscriptionPlanFindByIdCalls = [],
  } = options;

  let createdFoodSequence = 0;

  function attachFoodDocument(document, { isNew = false } = {}) {
    if (!document) return null;

    document.toObject = () => Object.fromEntries(
      Object.entries(document).filter(([, value]) => typeof value !== 'function')
    );
    document.save = async () => {
      saveCalls.push(document);
      if (isNew && !quotaFoods.includes(document)) {
        quotaFoods.push(document);
      }
      return document;
    };
    return document;
  }

  const existingFood = attachFoodDocument(food);

  function FoodModel(data) {
    createdFoodSequence += 1;
    return attachFoodDocument({
      _id: `created-food-${createdFoodSequence}`,
      isActive: true,
      ...data,
    }, { isNew: true });
  }

  FoodModel.findOne = (query) => makeQuery(
    existingFood && matchesQuery(existingFood, query) ? existingFood : null
  );
  FoodModel.findById = (id) => makeQuery(
    existingFood && sameId(existingFood._id, id) ? existingFood : null
  );
  FoodModel.countDocuments = async (query) => {
    countQueries.push(query);
    return quotaFoods.filter((record) => matchesQuery(record, query)).length;
  };

  const BusinessModel = {
    findOne(query) {
      businessQueries.push(query);
      return makeQuery(matchesQuery(business, query) ? business : null);
    },
  };

  const SubscriptionModel = {
    findById(id) {
      subscriptionFindByIdCalls.push(id);
      return makeQuery(sameId(subscription?._id, id) ? subscription : null);
    },
    findOne(query) {
      return makeQuery(
        subscription &&
        sameId(subscription.businessId, query.businessId) &&
        sameId(subscription.userId, query.userId) &&
        subscription.status === query.status
          ? subscription
          : null
      );
    },
  };

  const SubscriptionPlanModel = {
    findById(id) {
      subscriptionPlanFindByIdCalls.push(id);
      return makeQuery(sameId(subscriptionPlan?._id, id) ? subscriptionPlan : null);
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Food')) {
      return FoodModel;
    }
    if (request.endsWith('models/Business')) {
      return BusinessModel;
    }
    if (request.endsWith('models/Subscription')) {
      return SubscriptionModel;
    }
    if (request.endsWith('models/SubscriptionPlan')) {
      return SubscriptionPlanModel;
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
  delete require.cache[listingQuotaServicePath];

  try {
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
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

test('food create counts only published active listings so drafts and inactive foods do not block Silver creation', async () => {
  const quotaFoods = [
    ...publishedFoods(4),
    ...Array.from({ length: 20 }, (_, index) => ({
      _id: `draft-food-${index}`,
      businessId,
      isPublished: false,
      isActive: true,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      _id: `inactive-food-${index}`,
      businessId,
      isPublished: true,
      isActive: false,
    })),
  ];
  const countQueries = [];
  const saveCalls = [];
  const businessQueries = [];
  const subscriptionFindByIdCalls = [];
  const subscriptionPlanFindByIdCalls = [];
  const controller = loadController({
    quotaFoods,
    countQueries,
    saveCalls,
    businessQueries,
    subscriptionFindByIdCalls,
    subscriptionPlanFindByIdCalls,
  });
  const res = mockResponse();

  await controller.createFood(buildCreateRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.food.isPublished, true);
  assert.equal(saveCalls.length, 1);
  assert.deepEqual(countQueries, [{
    businessId,
    isPublished: true,
    isActive: { $ne: false },
  }]);
  assert.deepEqual(businessQueries[0], { _id: businessId, owner: ownerId });
  assert.deepEqual(subscriptionFindByIdCalls, [subscriptionId]);
  assert.deepEqual(subscriptionPlanFindByIdCalls, [subscriptionPlanId]);
});

test('five published active Silver foods deterministically block another published food', async () => {
  const saveCalls = [];
  const controller = loadController({
    quotaFoods: publishedFoods(5),
    saveCalls,
  });
  const res = mockResponse();

  await controller.createFood(buildCreateRequest(), res);

  const message = 'Food listing limit reached for Silver. Limit 5, current 5, attempted increase 1.';
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    code: 'LISTING_LIMIT_REACHED',
    error: message,
    message,
    listingType: 'food',
    tier: 'Silver',
    limit: 5,
    current: 5,
    attemptedIncrease: 1,
    remaining: 0,
  });
  assert.equal(saveCalls.length, 0);
});

test('draft food creation neither consumes quota nor blocks the next published food', async () => {
  const quotaFoods = publishedFoods(4);
  const countQueries = [];
  const saveCalls = [];
  const controller = loadController({ quotaFoods, countQueries, saveCalls });
  const draftRes = mockResponse();
  const publishedRes = mockResponse();

  await controller.createFood(buildCreateRequest({
    title: 'Quota-free draft',
    isPublished: false,
  }), draftRes);
  await controller.createFood(buildCreateRequest({
    title: 'Fifth published food',
    isPublished: true,
  }), publishedRes);

  assert.equal(draftRes.statusCode, 201);
  assert.equal(draftRes.body.food.isPublished, false);
  assert.equal(publishedRes.statusCode, 201);
  assert.equal(publishedRes.body.food.isPublished, true);
  assert.equal(saveCalls.length, 2);
  assert.equal(countQueries.length, 1);
  assert.equal(
    quotaFoods.filter((record) => record.isPublished === true && record.isActive !== false).length,
    5
  );
});

test('publishing a draft food at the Silver cap is blocked without saving the draft', async () => {
  const food = buildFood({ isPublished: false, isActive: true });
  const countQueries = [];
  const saveCalls = [];
  const controller = loadController({
    food,
    quotaFoods: publishedFoods(5),
    countQueries,
    saveCalls,
  });
  const res = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { isPublished: true },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(res.body.current, 5);
  assert.equal(res.body.attemptedIncrease, 1);
  assert.equal(food.isPublished, false);
  assert.equal(saveCalls.length, 0);
  assert.deepEqual(countQueries, [{
    businessId,
    isPublished: true,
    isActive: { $ne: false },
  }]);
});

test('metadata-only update keeps an existing published food visible above a downgraded Silver cap', async () => {
  const food = buildFood({
    isPublished: true,
    isActive: true,
    metaFields: [{ key: 'old', value: 'value' }],
  });
  const countQueries = [];
  const saveCalls = [];
  const controller = loadController({
    food,
    quotaFoods: publishedFoods(8),
    countQueries,
    saveCalls,
  });
  const res = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: {
      isPublished: true,
      metaFields: [{ key: ' cuisine ', value: ' soul food ' }],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(saveCalls.length, 1);
  assert.equal(countQueries.length, 0);
  assert.equal(food.isPublished, true);
  assert.equal(food.isActive, true);
  assert.equal(food._id, foodId);
  assert.deepEqual(food.metaFields, [{ key: 'cuisine', value: 'soul food' }]);
});

test('food create rejects a persisted gallery above the Silver image limit', async () => {
  const saveCalls = [];
  const countQueries = [];
  const controller = loadController({ saveCalls, countQueries });
  const res = mockResponse();

  await controller.createFood(buildCreateRequest({
    isPublished: false,
    images: ['one', 'two', 'three', 'four'],
  }), res);

  const message = 'Food gallery image limit reached. Your plan allows 3 gallery images.';
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    code: 'IMAGE_LIMIT_REACHED',
    error: message,
    message,
    listingType: 'food',
    limit: 3,
    current: 0,
    next: 4,
    attemptedIncrease: 4,
    remaining: 3,
  });
  assert.equal(saveCalls.length, 0);
  assert.equal(countQueries.length, 0);
});

test('unchanged and reduced over-limit food galleries remain editable after downgrade', async () => {
  const food = buildFood({
    isPublished: false,
    images: ['one', 'two', 'three', 'four', 'five'],
  });
  const saveCalls = [];
  const countQueries = [];
  const controller = loadController({ food, saveCalls, countQueries });
  const unchangedRes = mockResponse();
  const reducedRes = mockResponse();

  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { metaFields: [{ key: 'note', value: 'unchanged gallery' }] },
  }, unchangedRes);
  await controller.updateFood({
    user: { _id: ownerId },
    params: { id: foodId },
    body: { images: ['one', 'two', 'three', 'four'] },
  }, reducedRes);

  assert.equal(unchangedRes.statusCode, 200);
  assert.equal(reducedRes.statusCode, 200);
  assert.equal(saveCalls.length, 2);
  assert.equal(countQueries.length, 0);
  assert.deepEqual(food.images, ['one', 'two', 'three', 'four']);
  assert.equal(food.isPublished, false);
  assert.equal(food.isActive, true);
});
