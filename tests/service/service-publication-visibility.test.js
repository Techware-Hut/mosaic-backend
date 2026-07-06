const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const serviceControllerPath = path.resolve(__dirname, '../../controllers/serviceController.js');
const publicListingPath = path.resolve(__dirname, '../../controllers/publicListing.js');

const ownerId = '507f1f77bcf86cd799439011';
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

function awsMocks() {
  return {
    S3Client: class S3Client {},
    PutObjectCommand: class PutObjectCommand {},
  };
}

function buildServiceDoc(overrides = {}) {
  return {
    _id: serviceId,
    ownerId,
    businessId,
    title: 'Hair Styling',
    description: 'Salon menu',
    isPublished: false,
    services: [{ name: 'Cut', price: 45, durationMinutes: 60 }],
    price: 45,
    duration: '',
    save: async function save() { return this; },
    toObject() { return { ...this }; },
    ...overrides,
  };
}

function loadServiceController(options = {}) {
  const {
    existingService = null,
    business = { _id: businessId, owner: ownerId, isActive: true, minorityType: 'none' },
    subscription = { subscriptionPlanId: 'plan-1', status: 'active' },
    serviceLimit = 10,
  } = options;

  const savedDocs = [];
  let createCalled = false;

  const Service = {
    startSession: async () => ({
      startTransaction: () => {},
      commitTransaction: async () => {},
      abortTransaction: async () => {},
      endSession: () => {},
    }),
    findOne: async (query) => {
      if (query._id === serviceId || (query.businessId && query.ownerId)) {
        if (existingService === 'missing') return null;
        if (existingService) return existingService;
        if (query.businessId && createCalled) {
          return buildServiceDoc({ isPublished: true });
        }
        return existingService;
      }
      return null;
    },
    find: () => ({
      select: () => ({
        lean: async () => [],
      }),
    }),
    findById: () => ({
      populate: () => ({
        populate: () => ({
          populate: () => Promise.resolve(buildServiceDoc()),
        }),
      }),
    }),
    findByIdAndUpdate: async () => buildServiceDoc({ isPublished: true }),
  };

  Service.prototype = function ServiceModel(data) {
    Object.assign(this, data);
    this.save = async () => {
      savedDocs.push(this);
      createCalled = true;
      return this;
    };
    this.toObject = () => ({ ...this, _id: serviceId });
  };

  const resolveFindOne = (query) => {
    if (query._id === serviceId && query.ownerId) {
      if (existingService === 'missing') return null;
      return existingService || buildServiceDoc();
    }
    if (query.businessId && query.ownerId) {
      if (existingService === 'missing') return null;
      return existingService || null;
    }
    return null;
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Service')) {
      const ServiceExport = function ServiceModel(data) {
        Object.assign(this, data);
        this._id = serviceId;
        this.save = async () => {
          savedDocs.push(this);
          createCalled = true;
          return this;
        };
        this.toObject = () => ({ ...this, _id: serviceId });
      };
      ServiceExport.startSession = Service.startSession;
      ServiceExport.findOne = (query) => {
        const exec = async () => resolveFindOne(query);
        const chain = {
          select: () => chain,
          exec,
          then: (resolve, reject) => exec().then(resolve, reject),
        };
        return chain;
      };
      ServiceExport.find = Service.find;
      ServiceExport.findById = Service.findById;
      ServiceExport.findByIdAndUpdate = Service.findByIdAndUpdate;
      return ServiceExport;
    }
    if (request.endsWith('models/Business')) {
      return {
        findOne: () => ({
          select: () => ({
            exec: async () => business,
            then: (resolve, reject) => Promise.resolve(business).then(resolve, reject),
          }),
        }),
        find: () => ({
          select: () => ({
            lean: async () => [business],
          }),
        }),
        findById: async () => business,
      };
    }
    if (request.endsWith('models/Subscription')) {
      return {
        findOne: () => ({
          sort: async () => subscription,
        }),
      };
    }
    if (request.endsWith('models/SubscriptionPlan')) {
      return {
        findById: async () => ({ limits: { serviceListings: serviceLimit, imageLimit: 5 } }),
      };
    }
    if (request.endsWith('models/PendingImage')) {
      return { deleteMany: async () => {}, deleteOne: async () => {} };
    }
    if (request.endsWith('utils/deleteCloudinaryFile')) return async () => {};
    if (request.endsWith('@aws-sdk/client-s3')) return awsMocks();
    if (request.endsWith('@aws-sdk/s3-request-presigner')) return { getSignedUrl: async () => 'url' };
    if (request.endsWith('models/ServiceCategory')) return {};
    if (request.endsWith('models/ServiceSubcategory')) return {};
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[serviceControllerPath];
  const controller = require(serviceControllerPath);
  Module._load = originalLoad;
  return { controller, savedDocs };
}

function loadPublicListingController(options = {}) {
  const {
    service = buildServiceDoc({ isPublished: false }),
    businessActive = true,
    capturedFindById = { called: false },
  } = options;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Service')) {
      return {
        find: () => ({
          populate: () => ({
            sort: () => ({
              skip: () => ({
                limit: async () => [],
              }),
            }),
          }),
        }),
        countDocuments: async () => 0,
        findById: () => {
          capturedFindById.called = true;
          return {
            populate: () => ({
              populate: () => ({
                populate: async () => service,
              }),
            }),
          };
        },
        findOne: async () => null,
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        find: () => ({
          select: () => ({
            lean: async () => (businessActive ? [{ _id: businessId }] : []),
          }),
        }),
        findOne: () => ({
          select: () => ({
            lean: async () => (businessActive ? { _id: businessId } : null),
          }),
        }),
      };
    }
    if (request.endsWith('models/VendorOnboardingStage1')) {
      return { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
    }
    if (request.endsWith('models/Review')) return { find: () => ({ populate: async () => [] }) };
    if (request.endsWith('models/ServiceCategory')) return { findOne: async () => null };
    if (request.endsWith('models/ServiceSubcategory')) return { findOne: async () => null };
    if (request.endsWith('lib/listing/publicListingDto')) {
      return {
        toPublicListingCard: (doc) => doc,
        toPublicListingDetail: (doc) => doc,
        toPublicBusinessCard: (doc) => doc,
      };
    }
    if (request.endsWith('lib/listing/publicSearchFilters')) {
      return {
        parsePublicSearchQuery: () => ({}),
        detectUnsupportedGeoParams: () => false,
        shouldIncludeListingType: () => true,
        resolveBusinessIdsByKeyword: async () => [],
        resolveCombinedBusinessFilters: async () => ({ businessIds: [], empty: false }),
        intersectBusinessIdSets: () => [],
        loadVerifiedByBusinessIds: async () => new Map(),
        loadTagsByBusinessIds: async () => new Map(),
        narrowVisibleBusinessIds: async () => ({ businessIds: [businessId], empty: false }),
        mergeBusinessIdFilter: () => ({ filter: { $in: [businessId] }, empty: false }),
        buildKeywordRegex: () => /./,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[publicListingPath];
  const controller = require(publicListingPath);
  Module._load = originalLoad;
  return { controller, capturedFindById };
}

test('createService returns 409 when parent service already exists', async () => {
  const { controller } = loadServiceController({
    existingService: buildServiceDoc(),
  });
  const res = mockResponse();

  await controller.createService(
    {
      user: { _id: ownerId },
      body: {
        businessId,
        categoryId: '507f1f77bcf86cd799439014',
        subcategoryId: '507f1f77bcf86cd799439015',
        title: 'Hair Styling',
        services: [{ name: 'Cut', price: 45, durationMinutes: 60 }],
      },
    },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.ok(res.body.existingServiceId);
});

test('createService returns field errors for frontend name-only child without top-level backfill', async () => {
  const { controller } = loadServiceController({ existingService: null });
  const res = mockResponse();

  await controller.createService(
    {
      user: { _id: ownerId },
      body: {
        businessId,
        categoryId: '507f1f77bcf86cd799439014',
        subcategoryId: '507f1f77bcf86cd799439015',
        services: [{ name: 'Cut' }],
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.fieldErrors['services[0].price']);
  assert.ok(res.body.fieldErrors['services[0].durationMinutes']);
});

test('createService persists normalized listing features on first save', async () => {
  const { controller, savedDocs } = loadServiceController({ existingService: null });
  const res = mockResponse();

  await controller.createService(
    {
      user: { _id: ownerId },
      body: {
        businessId,
        categoryId: '507f1f77bcf86cd799439014',
        subcategoryId: '507f1f77bcf86cd799439015',
        title: 'Hair Styling',
        features: [' Mobile appointments ', '', 'Consultation included'],
        services: [{ name: 'Cut', price: 45, durationMinutes: 60 }],
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.deepEqual(savedDocs[0].features, ['Mobile appointments', 'Consultation included']);
  assert.deepEqual(res.body.data.service.features, ['Mobile appointments', 'Consultation included']);
});

test('public getServiceById excludes unpublished services', async () => {
  const { controller } = loadPublicListingController({
    service: buildServiceDoc({ isPublished: false }),
  });
  const res = mockResponse();

  await controller.getServiceById({ params: { id: serviceId } }, res);

  assert.equal(res.statusCode, 404);
});

test('public getServiceById returns published service for active business', async () => {
  const { controller } = loadPublicListingController({
    service: {
      ...buildServiceDoc({ isPublished: true }),
      businessId: { _id: businessId, toObject: () => ({ _id: businessId }) },
      toObject() {
        return { ...this, businessId: { _id: businessId } };
      },
    },
  });
  const res = mockResponse();

  await controller.getServiceById({ params: { id: serviceId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

test('updateService publish response exposes publication block without duplicate create', async () => {
  const draft = buildServiceDoc({ isPublished: false });
  const { controller } = loadServiceController({
    existingService: draft,
  });
  const res = mockResponse();

  await controller.updateService(
    {
      user: { _id: ownerId },
      params: { id: serviceId },
      body: { isPublished: true },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.publication.isPublished, true);
});

test('updateService returns clear validation when publishing without child services', async () => {
  const draft = buildServiceDoc({ isPublished: false, services: [] });
  const { controller } = loadServiceController({
    existingService: draft,
  });
  const res = mockResponse();

  await controller.updateService(
    {
      user: { _id: ownerId },
      params: { id: serviceId },
      body: { isPublished: true },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Add at least one service offering before publishing.');
  assert.equal(res.body.fieldErrors.services, 'Add at least one service offering before publishing.');
});
