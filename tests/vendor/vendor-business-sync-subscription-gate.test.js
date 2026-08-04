/**
 * P0 follow-up regression tests — Business sync subscription gate (#248).
 *
 * Production defect: PUT/PATCH /api/vendor-onboarding/business-profile returned
 * HTTP 500 "Failed to sync business profile data" when the vendor had no usable
 * active Subscription. The sync built Business documents with
 * subscriptionId: null, subscriptionPlanId: null, subscriptionStatus: 'inactive'
 * — all rejected by the Business schema (required refs + enum
 * active|expired|cancelled|pending) — and the generic catch returned a 500 that
 * kept the vendor stuck at Stage 3.
 *
 * Contract under test:
 *  - No usable subscription  → 409 VENDOR_SUBSCRIPTION_REQUIRED
 *  - Active subscription with missing plan → 409 VENDOR_SUBSCRIPTION_INVALID
 *  - No Business write is attempted in either case (no partial Business)
 *  - Saved onboarding draft fields are preserved (sync retried on next save)
 *  - Successful sync links Subscription.businessId when missing, and never
 *    relinks when already correct
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

const {
  VENDOR_SUBSCRIPTION_REQUIRED,
  VENDOR_SUBSCRIPTION_INVALID,
  VENDOR_SUBSCRIPTION_REQUIRED_MESSAGE,
  VENDOR_SUBSCRIPTION_INVALID_MESSAGE,
} = require(syncUtilPath);

const userId = '507f1f77bcf86cd799439011';
const businessId = '507f1f77bcf86cd799439099';
const subscriptionId = '507f1f77bcf86cd799439022';
const planId = '507f1f77bcf86cd799439033';
const applicationId = 'MBH-APP-TEST-248';

const ACTIVE_SUBSCRIPTION = {
  _id: subscriptionId,
  subscriptionPlanId: planId,
  status: 'active',
  businessId: null,
};

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
 * subscription === null → Subscription.findOne resolves to no document.
 * Tracks Business construction/save counts and Subscription.updateOne calls.
 */
function buildBusinessMocks({
  existingBusiness = null,
  subscription = ACTIVE_SUBSCRIPTION,
} = {}) {
  let constructedCount = 0;
  let saveCount = 0;
  let createdBusiness = null;
  const updateOneCalls = [];

  class Business {
    constructor(data = {}) {
      constructedCount += 1;
      Object.assign(this, data);
      this._id = this._id || businessId;
      createdBusiness = this;
    }

    async save() {
      saveCount += 1;
      return this;
    }
  }

  Business.findOne = async () => existingBusiness;

  const Subscription = {
    findOne: () => ({
      // Clone per query (as Mongoose returns fresh documents) so the sync's
      // linkage bookkeeping never leaks state between tests.
      sort: async () => (subscription ? { ...subscription } : null),
    }),
    updateOne: async (filter, update) => {
      updateOneCalls.push({ filter, update });
      return { acknowledged: true, modifiedCount: 1 };
    },
  };

  return {
    Business,
    Subscription,
    updateOneCalls,
    getCreatedBusiness: () => createdBusiness,
    getConstructedCount: () => constructedCount,
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

function assertNoBusinessWrite(businessMocks) {
  assert.equal(
    businessMocks.getConstructedCount(),
    0,
    'no Business document may be constructed'
  );
  assert.equal(
    businessMocks.getSaveCount(),
    0,
    'Business.save() must never be attempted'
  );
}

// ---------------------------------------------------------------------------
// VENDOR_SUBSCRIPTION_REQUIRED — no usable active subscription
// ---------------------------------------------------------------------------

test('PUT /business-profile returns 409 VENDOR_SUBSCRIPTION_REQUIRED when no subscription exists', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({ subscription: null });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.updateBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Updated bio' } },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    success: false,
    code: VENDOR_SUBSCRIPTION_REQUIRED,
    message: VENDOR_SUBSCRIPTION_REQUIRED_MESSAGE,
    nextAction: 'complete_subscription',
  });
  assertNoBusinessWrite(businessMocks);
  assert.equal(onboarding.businessId, null, 'no partial linkage');
  // Saved draft fields are preserved; sync is retried on the next save.
  assert.equal(onboarding.businessBio, 'Updated bio');
});

test('PATCH /business-profile returns 409 VENDOR_SUBSCRIPTION_REQUIRED when no subscription exists', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({ subscription: null });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.patchBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Patched bio' } },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    success: false,
    code: VENDOR_SUBSCRIPTION_REQUIRED,
    message: VENDOR_SUBSCRIPTION_REQUIRED_MESSAGE,
    nextAction: 'complete_subscription',
  });
  assertNoBusinessWrite(businessMocks);
  assert.equal(onboarding.businessId, null);
  assert.equal(onboarding.businessBio, 'Patched bio');
});

// ---------------------------------------------------------------------------
// VENDOR_SUBSCRIPTION_INVALID — active subscription missing its plan link
// ---------------------------------------------------------------------------

test('PUT /business-profile returns 409 VENDOR_SUBSCRIPTION_INVALID when active subscription has no plan', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({
    subscription: { ...ACTIVE_SUBSCRIPTION, subscriptionPlanId: null },
  });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.updateBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Updated bio' } },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    success: false,
    code: VENDOR_SUBSCRIPTION_INVALID,
    message: VENDOR_SUBSCRIPTION_INVALID_MESSAGE,
    nextAction: 'contact_support',
  });
  assertNoBusinessWrite(businessMocks);
  assert.equal(onboarding.businessId, null);
  assert.equal(onboarding.businessBio, 'Updated bio');
});

test('PATCH /business-profile returns 409 VENDOR_SUBSCRIPTION_INVALID when active subscription has no plan', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({
    subscription: { ...ACTIVE_SUBSCRIPTION, subscriptionPlanId: null },
  });
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.patchBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Patched bio' } },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    success: false,
    code: VENDOR_SUBSCRIPTION_INVALID,
    message: VENDOR_SUBSCRIPTION_INVALID_MESSAGE,
    nextAction: 'contact_support',
  });
  assertNoBusinessWrite(businessMocks);
  assert.equal(onboarding.businessId, null);
  assert.equal(onboarding.businessBio, 'Patched bio');
});

// ---------------------------------------------------------------------------
// Happy path — real subscription linkage written, never null, never 'inactive'
// ---------------------------------------------------------------------------

test('PUT /business-profile succeeds with an active subscription and writes real linkage', async () => {
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks();
  const controller = loadController({ onboarding, businessMocks });
  const res = mockResponse();

  await controller.updateBusinessProfile(
    { user: { _id: userId }, body: { businessBio: 'Synced bio' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  const created = businessMocks.getCreatedBusiness();
  assert.ok(created, 'Business must be created');
  assert.equal(created.subscriptionId, subscriptionId);
  assert.equal(created.subscriptionPlanId, planId);
  assert.equal(created.subscriptionStatus, 'active');
  assert.notEqual(created.subscriptionStatus, 'inactive');
  assert.equal(onboarding.businessId, businessId);
});

test('successful sync links Subscription.businessId via single-field update when missing', async () => {
  const { syncBusinessFromOnboarding } = require(syncUtilPath);
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks();

  await syncBusinessFromOnboarding({
    userId,
    onboarding,
    Business: businessMocks.Business,
    Subscription: businessMocks.Subscription,
  });

  assert.equal(businessMocks.updateOneCalls.length, 1);
  const { filter, update } = businessMocks.updateOneCalls[0];
  assert.deepEqual(filter, { _id: subscriptionId });
  assert.deepEqual(update, { $set: { businessId } });
});

test('successful sync does NOT relink Subscription.businessId when already correct', async () => {
  const { syncBusinessFromOnboarding } = require(syncUtilPath);
  const onboarding = buildOnboarding({ businessId: null });
  const businessMocks = buildBusinessMocks({
    subscription: { ...ACTIVE_SUBSCRIPTION, businessId },
  });

  await syncBusinessFromOnboarding({
    userId,
    onboarding,
    Business: businessMocks.Business,
    Subscription: businessMocks.Subscription,
  });

  assert.equal(businessMocks.updateOneCalls.length, 0);
});
