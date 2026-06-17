const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const syncUtilPath = path.resolve(
  __dirname,
  '../../utils/syncBusinessFromOnboarding.js'
);
const profileFieldsPath = path.resolve(
  __dirname,
  '../../utils/vendorOnboardingProfileFields.js'
);
const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);

const userId = '507f1f77bcf86cd799439011';
const subscriptionId = '507f1f77bcf86cd799439022';

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

function buildOnboarding(overrides = {}) {
  return {
    userId,
    businessName: 'Synced Business',
    businessBio: 'Bio text',
    businessType: 'product',
    businessProfileImage: { url: 'https://example.com/logo.png' },
    featureBanner: { url: 'https://example.com/banner.png' },
    businessEmail: 'shop@example.com',
    businessPhone: '5551234567',
    save: async () => {},
    ...overrides,
  };
}

function buildBusinessMocks({ existingBusiness = null, saveError = null } = {}) {
  let createdBusiness = null;

  class Business {
    constructor(data = {}) {
      Object.assign(this, data);
      this._id = this._id || '507f1f77bcf86cd799439099';
      createdBusiness = this;
    }

    async save() {
      if (saveError) {
        throw saveError;
      }
      return this;
    }
  }

  Business.findOne = async () => existingBusiness;

  const Subscription = {
    findOne: () => ({
      sort: async () => ({
        _id: subscriptionId,
        subscriptionPlanId: '507f1f77bcf86cd799439033',
        status: 'active',
      }),
    }),
  };

  return { Business, Subscription, getCreatedBusiness: () => createdBusiness };
}

test('syncBusinessFromOnboarding creates Business when none exists', async () => {
  const { syncBusinessFromOnboarding } = require(syncUtilPath);
  const onboarding = buildOnboarding();
  const { Business, Subscription, getCreatedBusiness } = buildBusinessMocks();

  const business = await syncBusinessFromOnboarding({
    userId,
    onboarding,
    Business,
    Subscription,
  });

  const created = getCreatedBusiness();
  assert.equal(created.businessName, 'Synced Business');
  assert.equal(created.owner, userId);
  assert.equal(created.subscriptionId, subscriptionId);
  assert.equal(onboarding.businessId, business._id);
});

test('syncBusinessFromOnboarding updates existing Business', async () => {
  const { syncBusinessFromOnboarding } = require(syncUtilPath);
  const onboarding = buildOnboarding();
  const existingBusiness = {
    _id: '507f1f77bcf86cd799439088',
    owner: userId,
    businessName: 'Old Name',
    description: 'Old bio',
    save: async function save() {
      return this;
    },
  };
  const { Business, Subscription } = buildBusinessMocks({ existingBusiness });

  await syncBusinessFromOnboarding({
    userId,
    onboarding,
    Business,
    Subscription,
  });

  assert.equal(existingBusiness.businessName, 'Synced Business');
  assert.equal(existingBusiness.description, 'Bio text');
  assert.equal(onboarding.businessId, existingBusiness._id);
});

test('syncBusinessFromOnboarding propagates Business save failures', async () => {
  const { syncBusinessFromOnboarding } = require(syncUtilPath);
  const onboarding = buildOnboarding({ businessId: null });
  const saveError = new Error('Business validation failed');
  const { Business, Subscription } = buildBusinessMocks({ saveError });

  await assert.rejects(
    () =>
      syncBusinessFromOnboarding({
        userId,
        onboarding,
        Business,
        Subscription,
      }),
    /Business validation failed/
  );

  assert.equal(onboarding.businessId, null);
});

function loadController({ onboarding, businessMocks }) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';

  const vendorOnboardingMock = {
    findOne: async () => onboarding,
  };

  const mailerMock = {
    sendAdminOnboardingSubmissionEmail: async () => {},
    sendVendorSubmissionConfirmationEmail: async () => {},
    sendAdminVendorProfileCompletedEmail: async () => {},
  };

  const stripeMock = () => ({
    paymentIntents: {
      create: async () => ({ id: 'pi_test' }),
    },
  });

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return stripeMock;
    }
    if (request === '../models/VendorOnboardingStage1') {
      return vendorOnboardingMock;
    }
    if (request === '../models/Business') {
      return businessMocks.Business;
    }
    if (request === '../models/Subscription') {
      return businessMocks.Subscription;
    }
    if (request === '../utils/WellcomeMailer') {
      return mailerMock;
    }
    if (request === '../utils/vendorOnboardingProfileFields') {
      return require(profileFieldsPath);
    }
    if (request === '../utils/syncBusinessFromOnboarding') {
      return require(syncUtilPath);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const vendorOnboardingPath = path.resolve(
    __dirname,
    '../../models/VendorOnboardingStage1.js'
  );
  const businessPath = path.resolve(__dirname, '../../models/Business.js');
  const subscriptionPath = path.resolve(__dirname, '../../models/Subscription.js');

  delete require.cache[controllerPath];
  delete require.cache[vendorOnboardingPath];
  delete require.cache[businessPath];
  delete require.cache[subscriptionPath];

  const loaded = require(controllerPath);
  Module._load = originalLoad;

  require.cache[vendorOnboardingPath] = {
    id: vendorOnboardingPath,
    filename: vendorOnboardingPath,
    loaded: true,
    exports: vendorOnboardingMock,
  };
  require.cache[businessPath] = {
    id: businessPath,
    filename: businessPath,
    loaded: true,
    exports: businessMocks.Business,
  };
  require.cache[subscriptionPath] = {
    id: subscriptionPath,
    filename: subscriptionPath,
    loaded: true,
    exports: businessMocks.Subscription,
  };

  return loaded;
}

test('updateBusinessProfile returns error when business sync fails', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({
    saveError: new Error('subscriptionId is required'),
  });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.updateBusinessProfile(
    {
      user: { _id: userId },
      body: { businessBio: 'Updated bio' },
    },
    res
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Failed to sync business profile data/);
  assert.equal(onboarding.businessId, null);
  assert.equal(onboarding.businessBio, 'Updated bio');
});

test('updateBusinessProfile succeeds when business sync succeeds', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks();
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.updateBusinessProfile(
    {
      user: { _id: userId },
      body: { businessBio: 'Synced bio' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(onboarding.businessBio, 'Synced bio');
  assert.equal(onboarding.businessId, '507f1f77bcf86cd799439099');
});
