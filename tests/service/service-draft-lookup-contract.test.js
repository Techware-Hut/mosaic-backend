const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/serviceController.js');

const ownerId = '507f1f77bcf86cd799439011';
const otherOwnerId = '507f1f77bcf86cd799439099';
const businessId = '507f1f77bcf86cd799439012';
const serviceId = '507f1f77bcf86cd799439013';

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
    businessName: 'QA Services',
    isActive: true,
    isApproved: true,
    ...overrides,
  };
}

function buildService(overrides = {}) {
  const service = {
    _id: serviceId,
    ownerId,
    businessId: {
      _id: businessId,
      owner: ownerId,
      businessName: 'QA Services',
    },
    title: 'Draft services',
    description: 'Draft parent',
    categoryId: { _id: '507f1f77bcf86cd799439014', name: 'Beauty' },
    subcategoryId: { _id: '507f1f77bcf86cd799439015', name: 'Hair' },
    isPublished: false,
    coverImage: 'https://example.com/cover.jpg',
    images: ['https://example.com/gallery.jpg'],
    services: [],
    businessHours: [],
    save: async function save() { return this; },
    ...overrides,
  };
  service.toObject = () => ({ ...service });
  return service;
}

function loadController(options = {}) {
  const {
    service = buildService(),
    business = buildBusiness(),
    authorized = true,
  } = options;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Service')) {
      return {
        findById: () => makeQuery(null),
        findOne: (query) => {
          if (query.businessId === businessId && (!query.ownerId || query.ownerId === ownerId)) {
            return makeQuery(service);
          }
          return makeQuery(null);
        },
        find: () => makeQuery([]),
        startSession: async () => ({
          startTransaction: () => {},
          commitTransaction: async () => {},
          abortTransaction: async () => {},
          endSession: () => {},
        }),
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        findOne: (query) => {
          if (query._id === businessId && query.owner && query.owner !== ownerId) {
            return makeQuery(null);
          }
          if (query._id === businessId && query.owner === ownerId && authorized) {
            return makeQuery(business);
          }
          if (query._id === businessId && query.isActive === true) {
            return makeQuery(business);
          }
          return makeQuery(null);
        },
        findById: async () => business,
      };
    }
    if (request.endsWith('models/Subscription')) {
      return { findOne: () => ({ sort: async () => ({ subscriptionPlanId: 'plan-1' }) }) };
    }
    if (request.endsWith('models/SubscriptionPlan')) {
      return { findById: async () => ({ limits: { serviceListings: 10, imageLimit: 5 } }) };
    }
    if (request.endsWith('models/PendingImage')) {
      return { deleteMany: async () => {}, deleteOne: async () => {} };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) return async () => {};
    if (request.endsWith('@aws-sdk/client-s3')) {
      return {
        S3Client: class S3Client {},
        PutObjectCommand: class PutObjectCommand {},
      };
    }
    if (request.endsWith('@aws-sdk/s3-request-presigner')) {
      return { getSignedUrl: async () => 'signed-url' };
    }
    if (request.endsWith('models/ServiceCategory')) return {};
    if (request.endsWith('models/ServiceSubcategory')) return {};
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
}

test('private business service lookup returns unpublished parent service for owner', async () => {
  const controller = loadController({
    service: buildService({ isPublished: false, services: [] }),
  });
  const res = mockResponse();

  await controller.getPrivateBusinessServiceByBusinessId(
    { user: { _id: ownerId }, params: { businessId } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.service._id, serviceId);
  assert.equal(res.body.service.isPublished, false);
  assert.equal(res.body.hasChildServices, false);
});

test('private business service lookup rejects unauthorized owner', async () => {
  const controller = loadController();
  const res = mockResponse();

  await controller.getPrivateBusinessServiceByBusinessId(
    { user: { _id: otherOwnerId }, params: { businessId } },
    res
  );

  assert.equal(res.statusCode, 403);
});

test('public business-service lookup still hides unpublished parent service', async () => {
  const controller = loadController({
    service: buildService({ isPublished: false }),
  });
  const res = mockResponse();

  await controller.getBusinessServiceById({ params: { id: businessId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Business service not found.');
});

test('public business-service lookup returns persisted features for published service', async () => {
  const controller = loadController({
    service: buildService({
      isPublished: true,
      features: ['Online Booking', 'Offers Available'],
      services: [{ name: 'Cut', price: 45, durationMinutes: 60 }],
    }),
  });
  const res = mockResponse();

  await controller.getBusinessServiceById({ params: { id: businessId } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.service.features, ['Online Booking', 'Offers Available']);
});
