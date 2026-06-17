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
    applicationId: 'MBH-APP-TEST-001',
    businessName: 'Test Business',
    businessType: 'product',
    primaryContactName: 'Jane Vendor',
    address: {
      city: 'Atlanta',
      state: 'GA',
      country: 'USA',
      zipCode: '30301',
    },
    acceptedTerms: true,
    declarationAccepted: true,
    isMinorityOwned: false,
    status: 'draft',
    badge: null,
    totalVerificationPoints: 0,
    verificationPayment: { status: 'paid' },
    toObject() {
      return { ...this };
    },
    save: async () => {},
    ...overrides,
  };
}

function loadController(onboarding) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

  const vendorOnboardingMock = {
    findOne: async () => onboarding,
  };

  const userMock = {
    findById: () => ({
      select: async () => ({ name: 'Vendor User', email: 'vendor@example.com' }),
    }),
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
    if (request === '../models/User') {
      return userMock;
    }
    if (request === '../utils/WellcomeMailer') {
      return mailerMock;
    }
    if (request === '../utils/vendorOnboardingEmailDelivery') {
      return {
        deliverVendorOnboardingEmails: async () => ({
          emailSent: true,
          emailSkipped: false,
          results: [],
        }),
      };
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

  delete require.cache[controllerPath];
  delete require.cache[vendorOnboardingPath];

  const loaded = require(controllerPath);
  Module._load = originalLoad;

  require.cache[vendorOnboardingPath] = {
    id: vendorOnboardingPath,
    filename: vendorOnboardingPath,
    loaded: true,
    exports: vendorOnboardingMock,
  };

  return loaded;
}

test('saveDraft on rejected application does not auto-resubmit to submitted', async () => {
  const onboarding = buildOnboarding({ status: 'rejected' });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.saveDraft(
    {
      user: { _id: userId },
      body: { businessName: 'Revised Business Name' },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(onboarding.status, 'draft');
  assert.notEqual(onboarding.status, 'submitted');
  assert.equal(onboarding.businessName, 'Revised Business Name');
});

test('saveDraft on normal draft application keeps draft status', async () => {
  const onboarding = buildOnboarding({ status: 'draft' });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.saveDraft(
    {
      user: { _id: userId },
      body: { businessName: 'Updated Draft Name' },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(onboarding.status, 'draft');
  assert.equal(onboarding.businessName, 'Updated Draft Name');
});

test('submitForReview explicitly submits draft application', async () => {
  const onboarding = buildOnboarding({ status: 'draft' });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(onboarding.status, 'submitted');
  assert.ok(onboarding.submittedAt instanceof Date);
});

test('submitForReview explicitly resubmits rejected application', async () => {
  const onboarding = buildOnboarding({ status: 'rejected' });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(onboarding.status, 'submitted');
  assert.ok(onboarding.submittedAt instanceof Date);
});

test('saveDraft on rejected application still strips protected vendor fields', async () => {
  const onboarding = buildOnboarding({
    status: 'rejected',
    badge: null,
    totalVerificationPoints: 0,
  });
  const controller = loadController(onboarding);
  const res = mockResponse();

  await controller.saveDraft(
    {
      user: { _id: userId },
      body: {
        businessName: 'Safe Update',
        badge: 'Diamond',
        status: 'verified',
        totalVerificationPoints: 500,
      },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(onboarding.businessName, 'Safe Update');
  assert.equal(onboarding.badge, null);
  assert.equal(onboarding.totalVerificationPoints, 0);
  assert.equal(onboarding.status, 'draft');
});
