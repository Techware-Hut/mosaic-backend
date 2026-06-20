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
const paymentIntentId = 'pi_test_reconcile_001';

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
    verificationPayment: {
      status: 'pending',
      paymentIntentId,
      paidAt: null,
    },
    toObject() {
      return { ...this };
    },
    save: async () => {},
    ...overrides,
  };
}

function buildSucceededPaymentIntent(metadataOverrides = {}) {
  return {
    id: paymentIntentId,
    status: 'succeeded',
    metadata: {
      type: 'vendor_verification',
      userId: userId.toString(),
      applicationId: 'MBH-APP-TEST-001',
      ...metadataOverrides,
    },
  };
}

function loadController(onboarding, { retrieveResult, retrieveError } = {}) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

  const retrieveCalls = [];
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
      create: async () => ({ id: paymentIntentId }),
      retrieve: async (id) => {
        retrieveCalls.push(id);
        if (retrieveError) {
          throw retrieveError;
        }
        if (typeof retrieveResult === 'function') {
          return retrieveResult(id);
        }
        return retrieveResult;
      },
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

  return { controller: loaded, retrieveCalls };
}

test('submitForReview reconciles pending DB payment when Stripe PI succeeded', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller, retrieveCalls } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent(),
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(retrieveCalls.length, 1);
  assert.equal(retrieveCalls[0], paymentIntentId);
  assert.equal(onboarding.verificationPayment.status, 'paid');
  assert.ok(onboarding.verificationPayment.paidAt instanceof Date);
  assert.equal(onboarding.status, 'submitted');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

test('submitForReview returns 402 when Stripe PI is not succeeded', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveResult: {
      id: paymentIntentId,
      status: 'requires_payment_method',
      metadata: buildSucceededPaymentIntent().metadata,
    },
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 402);
  assert.equal(onboarding.status, 'payment_pending');
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('submitForReview returns 402 when paymentIntentId is missing', async () => {
  const onboarding = buildOnboarding({
    verificationPayment: { status: 'pending' },
  });
  const { controller, retrieveCalls } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent(),
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(retrieveCalls.length, 0);
  assert.equal(res.statusCode, 402);
});

test('submitForReview returns 402 when Stripe metadata type is wrong', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent({ type: 'order_payment' }),
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 402);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('submitForReview returns 402 when Stripe metadata userId mismatches', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent({
      userId: '507f1f77bcf86cd799439099',
    }),
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 402);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('submitForReview skips Stripe retrieve when payment already paid in DB', async () => {
  const onboarding = buildOnboarding({
    status: 'draft',
    verificationPayment: { status: 'paid', paidAt: new Date() },
  });
  const { controller, retrieveCalls } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent(),
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(retrieveCalls.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(onboarding.status, 'submitted');
});

test('submitForReview returns 402 when Stripe retrieve throws', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveError: new Error('Stripe unavailable'),
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 402);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});
