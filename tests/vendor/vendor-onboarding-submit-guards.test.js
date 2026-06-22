const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);
const authenticatePath = path.resolve(__dirname, '../../middlewares/authenticate.js');
const requireVerifiedVendorPath = path.resolve(
  __dirname,
  '../../middlewares/requireVerifiedVendor.js'
);

const userId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439099';
const paymentIntentId = 'pi_test_submit_guards_001';

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
    applicationId: 'MBH-APP-GUARD-001',
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
    verificationPayment: {
      status: 'paid',
      paymentIntentId,
      paidAt: new Date(),
    },
    toObject() {
      return { ...this };
    },
    save: async () => {},
    ...overrides,
  };
}

function loadController({ onboarding, findOneQueryLog, findOneImpl } = {}) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

  const queries = findOneQueryLog || [];
  const vendorOnboardingMock = {
    findOne: async (query) => {
      queries.push(query);
      if (typeof findOneImpl === 'function') {
        return findOneImpl(query);
      }
      return onboarding;
    },
  };

  const userMock = {
    findById: () => ({
      select: async () => ({ name: 'Vendor User', email: 'vendor@example.com' }),
    }),
  };

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/VendorOnboardingStage1') {
      return vendorOnboardingMock;
    }
    if (request === '../models/User') {
      return userMock;
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
    if (request === '../utils/WellcomeMailer') {
      return {
        sendAdminOnboardingSubmissionEmail: async () => {},
        sendVendorSubmissionConfirmationEmail: async () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const loaded = require(controllerPath);
  Module._load = originalLoad;

  return { controller: loaded, queries };
}

test('submit route remains blocked without authentication (401)', async () => {
  const authenticate = require(authenticatePath);
  const res = mockResponse();
  let calledNext = false;

  await authenticate({ headers: {}, cookies: {} }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Authentication required');
});

test('submit route rejects customer role with 403', async () => {
  const requireVerifiedVendor = require(requireVerifiedVendorPath);
  const res = mockResponse();
  let calledNext = false;

  await requireVerifiedVendor(
    { user: { role: 'customer', isOtpVerified: true } },
    res,
    () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Only vendors allowed');
});

test('submitForReview returns 404 when vendor has no draft', async () => {
  const { controller } = loadController({ onboarding: null });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /draft/i);
});

test('submitForReview returns 400 with validation errors for incomplete draft', async () => {
  const onboarding = buildOnboarding({
    businessName: 'A',
    primaryContactName: '',
    address: { city: '', state: '', country: '', zipCode: '' },
    acceptedTerms: false,
    declarationAccepted: false,
  });
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Validation failed');
  assert.ok(Array.isArray(res.body.errors));
  assert.ok(res.body.errors.length > 0);
  assert.equal(onboarding.status, 'draft');
});

test('submitForReview returns 402 when verification payment is unpaid', async () => {
  const onboarding = buildOnboarding({
    verificationPayment: { status: 'pending', paymentIntentId: null, paidAt: null },
  });
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 402);
  assert.match(res.body.message, /payment/i);
});

test('submitForReview is idempotent when already submitted', async () => {
  const onboarding = buildOnboarding({ status: 'submitted' });
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.applicationId, onboarding.applicationId);
  assert.equal(onboarding.status, 'submitted');
});

test('submitForReview findOne uses authenticated userId', async () => {
  const queries = [];
  const { controller } = loadController({ onboarding: null, findOneQueryLog: queries });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(queries.length, 1);
  assert.equal(String(queries[0].userId), userId);
});

test('submitForReview returns 404 for another vendor when no record matches userId', async () => {
  const onboarding = buildOnboarding({ status: 'submitted' });
  const { controller } = loadController({
    findOneImpl: (query) => {
      if (String(query.userId) === String(onboarding.userId)) {
        return onboarding;
      }
      return null;
    },
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: otherUserId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
});
