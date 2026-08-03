/**
 * P0 regression tests — new vendor reaches Stage 4 without a Business record.
 *
 * Defects covered:
 *  D1: GET /api/vendor-onboarding/status/:applicationId reported Stage 4 ready
 *      ("Onboarding Complete") based only on onboarding profile fields, without
 *      verifying that the REQUIRED Business sync succeeded.
 *  D2: PATCH /api/vendor-onboarding/business-profile saved profile fields
 *      without running the required Business sync (PUT already did).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);
const profileFieldsPath = path.resolve(
  __dirname,
  '../../utils/vendorOnboardingProfileFields.js'
);
const syncUtilPath = path.resolve(
  __dirname,
  '../../utils/syncBusinessFromOnboarding.js'
);
const vendorOnboardingPath = path.resolve(
  __dirname,
  '../../models/VendorOnboardingStage1.js'
);
const businessPath = path.resolve(__dirname, '../../models/Business.js');
const subscriptionPath = path.resolve(
  __dirname,
  '../../models/Subscription.js'
);

const userId = '507f1f77bcf86cd799439011';
const businessId = '507f1f77bcf86cd799439099';
const applicationId = 'APP-TEST-0001';

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
    applicationId,
    userId,
    status: 'verified',
    businessName: 'Synced Business',
    businessBio: 'Bio text',
    businessType: 'product',
    businessProfileImage: { url: 'https://example.com/logo.png' },
    featureBanner: { url: 'https://example.com/banner.png' },
    businessEmail: 'shop@example.com',
    businessPhone: '5551234567',
    verificationPayment: { status: 'paid' },
    businessId: null,
    save: async () => {},
    ...overrides,
  };
}

/**
 * existingBusiness === null  → no Business row for this owner
 * saveError                   → business.save() rejects (sync failure)
 */
function buildBusinessMocks({ existingBusiness = null, saveError = null } = {}) {
  let createdBusiness = null;
  let saveCount = 0;

  class Business {
    constructor(data = {}) {
      Object.assign(this, data);
      this._id = this._id || businessId;
      createdBusiness = this;
    }

    async save() {
      saveCount += 1;
      if (saveError) {
        throw saveError;
      }
      return this;
    }
  }

  // Supports both:
  //  - Business.findOne({ owner })                      (sync util)
  //  - Business.findOne({ owner }).select('_id').lean() (status gate)
  Business.findOne = () => {
    const doc = existingBusiness;
    return {
      then(resolve, reject) {
        return Promise.resolve(doc).then(resolve, reject);
      },
      select: () => ({
        lean: async () => doc,
      }),
    };
  };

  const Subscription = {
    findOne: () => ({
      sort: () => ({
        // Supports .populate() (status endpoint) and direct await (sync util)
        populate: async () => ({
          _id: '507f1f77bcf86cd799439022',
          subscriptionPlanId: { name: 'Starter', price: 10 },
          status: 'active',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        }),
        then(resolve, reject) {
          return Promise.resolve({
            _id: '507f1f77bcf86cd799439022',
            subscriptionPlanId: '507f1f77bcf86cd799439033',
            status: 'active',
          }).then(resolve, reject);
        },
      }),
    }),
  };

  return {
    Business,
    Subscription,
    getCreatedBusiness: () => createdBusiness,
    getSaveCount: () => saveCount,
  };
}

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
      retrieve: async () => ({ status: 'requires_payment_method' }),
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

// ---------------------------------------------------------------------------
// D2 — PATCH /business-profile must run the REQUIRED business sync
// ---------------------------------------------------------------------------

test('patchBusinessProfile creates Business when none exists', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks();
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.patchBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Patched bio' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(businessMocks.getCreatedBusiness(), 'Business must be created');
  assert.equal(businessMocks.getCreatedBusiness().owner, userId);
  assert.equal(onboarding.businessId, businessId);
});

test('patchBusinessProfile returns error when business sync fails', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({
    saveError: new Error('validation failed'),
  });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.patchBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Patched bio' } },
    res
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Failed to sync business profile data/);
  assert.equal(onboarding.businessId, null);
});

test('patchBusinessProfile retry is idempotent (no duplicate Business)', async () => {
  const existing = {
    _id: businessId,
    owner: userId,
    save: async () => existing,
  };
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({ existingBusiness: existing });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.patchBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Retry bio' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    businessMocks.getCreatedBusiness(),
    null,
    'must update the existing Business, never create a duplicate'
  );
  assert.equal(onboarding.businessId, businessId);
});

// ---------------------------------------------------------------------------
// D1 — status endpoint must not report Stage 4 ready without a Business
// ---------------------------------------------------------------------------

test('status endpoint keeps vendor at Stage 3 when profile complete but Business missing', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({ existingBusiness: null });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.getStatusByApplicationId(
    { params: { applicationId } },
    res
  );

  assert.equal(res.body.success, true);
  const { data } = res.body;
  assert.equal(data.currentStage, 3, 'must NOT advance to Stage 4');
  assert.equal(data.status, 'Stage 3 - Business Sync Pending');
  assert.match(data.nextAction, /Re-save your business profile/);
  assert.equal(data.details.stage3.isComplete, false);
  assert.equal(data.details.stage3.businessSyncFailed, true);
  assert.equal(data.details.stage3.businessId, null);
  assert.equal(data.details.stage4.status, 'locked');
});

test('status endpoint reports Stage 4 ready when Business exists (existing vendors unaffected)', async () => {
  const onboarding = buildOnboarding({ businessId });
  const businessMocks = buildBusinessMocks({
    existingBusiness: { _id: businessId, owner: userId },
  });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.getStatusByApplicationId(
    { params: { applicationId } },
    res
  );

  assert.equal(res.body.success, true);
  const { data } = res.body;
  assert.equal(data.currentStage, 4);
  assert.match(data.status, /Onboarding Complete/);
  assert.equal(data.details.stage3.isComplete, true);
  assert.equal(data.details.stage3.businessSyncFailed, false);
  assert.equal(data.details.stage3.businessId, businessId);
  assert.equal(data.details.stage4.status, 'ready');
});

test('status endpoint: incomplete profile stays Stage 3 without sync flag', async () => {
  const onboarding = buildOnboarding({
    businessProfileImage: { url: '' },
    businessBio: '',
  });
  const businessMocks = buildBusinessMocks({ existingBusiness: null });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.getStatusByApplicationId(
    { params: { applicationId } },
    res
  );

  assert.equal(res.body.success, true);
  const { data } = res.body;
  assert.equal(data.currentStage, 3);
  assert.equal(data.status, 'Stage 3 - Business Profile Incomplete');
  assert.equal(data.details.stage3.businessSyncFailed, false);
  assert.equal(data.details.stage4.status, 'locked');
});
