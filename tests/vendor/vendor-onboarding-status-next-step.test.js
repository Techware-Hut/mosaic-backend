const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const profileFieldsPath = path.resolve(
  __dirname,
  '../../utils/vendorOnboardingProfileFields.js'
);
const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);

const userId = '507f1f77bcf86cd799439011';

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

function buildOnboarding(overrides = {}) {
  return {
    userId,
    applicationId: 'MBH-APP-STATUS-001',
    businessName: 'Status Test Business',
    status: 'rejected',
    totalVerificationPoints: 20,
    verificationPayment: { status: 'paid' },
    submittedAt: new Date('2026-07-01T00:00:00Z'),
    businessProfileImage: { url: '' },
    businessBio: '',
    ...overrides,
  };
}

function loadController(onboarding) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';

  const vendorOnboardingMock = {
    findOne: async () => onboarding,
  };

  const subscriptionMock = {
    findOne: () => ({
      sort: () => ({
        populate: async () => null,
      }),
    }),
  };

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return () => ({ paymentIntents: { create: async () => ({ id: 'pi_test' }) } });
    }
    if (request === '../models/VendorOnboardingStage1') {
      return vendorOnboardingMock;
    }
    if (request === '../models/Subscription') {
      return subscriptionMock;
    }
    if (request === '../models/User') {
      return {};
    }
    if (request === '../utils/WellcomeMailer') {
      return {};
    }
    if (request === '../utils/vendorOnboardingProfileFields') {
      return require(profileFieldsPath);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const vendorOnboardingPath = path.resolve(
    __dirname,
    '../../models/VendorOnboardingStage1.js'
  );
  const subscriptionPath = path.resolve(__dirname, '../../models/Subscription.js');

  delete require.cache[controllerPath];
  delete require.cache[vendorOnboardingPath];
  delete require.cache[subscriptionPath];

  const loaded = require(controllerPath);
  Module._load = originalLoad;

  require.cache[vendorOnboardingPath] = {
    id: vendorOnboardingPath,
    filename: vendorOnboardingPath,
    loaded: true,
    exports: vendorOnboardingMock,
  };
  require.cache[subscriptionPath] = {
    id: subscriptionPath,
    filename: subscriptionPath,
    loaded: true,
    exports: subscriptionMock,
  };

  return loaded;
}

test('rejected application status returns stored rejection reason and next action', async () => {
  const onboarding = buildOnboarding({
    rejectionReason: 'Missing required documents: EIN document.',
    requiredNextAction: 'Upload your EIN document and resubmit.',
    reviewedAt: new Date('2026-07-05T12:00:00Z'),
  });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.getStatusByApplicationId(
    { params: { applicationId: onboarding.applicationId } },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'Stage 1 - Rejected');
  assert.equal(res.body.data.nextAction, 'Upload your EIN document and resubmit.');
  assert.equal(
    res.body.data.details.stage1.rejectionReason,
    'Missing required documents: EIN document.'
  );
  assert.equal(
    res.body.data.details.stage1.requiredNextAction,
    'Upload your EIN document and resubmit.'
  );
  assert.ok(res.body.data.details.stage1.reviewedAt);
});

test('rejected application without stored review metadata gets resubmit default next action', async () => {
  const onboarding = buildOnboarding();
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.getStatusByApplicationId(
    { params: { applicationId: onboarding.applicationId } },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.nextAction, 'Update your application and resubmit for review.');
  assert.equal(res.body.data.details.stage1.rejectionReason, null);
  assert.equal(
    res.body.data.details.stage1.requiredNextAction,
    'Update your application and resubmit for review.'
  );
});

test('non-rejected application does not expose rejection metadata', async () => {
  const onboarding = buildOnboarding({
    status: 'submitted',
    rejectionReason: 'stale reason from a previous review',
    requiredNextAction: 'stale action',
  });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.getStatusByApplicationId(
    { params: { applicationId: onboarding.applicationId } },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'Stage 1 - Under Admin Review');
  assert.equal(res.body.data.details.stage1.rejectionReason, null);
  assert.equal(res.body.data.details.stage1.requiredNextAction, null);
});
