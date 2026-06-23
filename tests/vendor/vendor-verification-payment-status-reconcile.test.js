const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);

const userId = '507f1f77bcf86cd799439011';
const paymentIntentId = 'pi_test_payment_status_001';

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
    status: 'payment_pending',
    verificationPayment: {
      status: 'pending',
      paymentIntentId,
      paidAt: null,
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

  const retrieveCalls = [];
  const vendorOnboardingMock = {
    findOne: async () => onboarding,
  };

  const stripeMock = () => ({
    paymentIntents: {
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
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const loaded = require(controllerPath);
  Module._load = originalLoad;

  return { controller: loaded, retrieveCalls };
}

test('getPaymentStatus reconciles pending DB payment when Stripe PI succeeded', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller, retrieveCalls } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent(),
  });
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(retrieveCalls.length, 1);
  assert.equal(retrieveCalls[0], paymentIntentId);
  assert.equal(onboarding.verificationPayment.status, 'paid');
  assert.ok(onboarding.verificationPayment.paidAt instanceof Date);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.canSubmit, true);
  assert.equal(res.body.data.status, 'paid');
});

test('getPaymentStatus returns canSubmit false when Stripe PI is not succeeded', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveResult: {
      id: paymentIntentId,
      status: 'requires_payment_method',
      metadata: buildSucceededPaymentIntent().metadata,
    },
  });
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSubmit, false);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('getPaymentStatus returns canSubmit false when Stripe retrieve throws', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveError: new Error('Stripe unavailable'),
  });
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSubmit, false);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('getPaymentStatus skips Stripe retrieve when payment already paid in DB', async () => {
  const onboarding = buildOnboarding({
    status: 'draft',
    verificationPayment: { status: 'paid', paidAt: new Date(), paymentIntentId },
  });
  const { controller, retrieveCalls } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent(),
  });
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(retrieveCalls.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSubmit, true);
  assert.equal(res.body.data.status, 'paid');
});

test('getPaymentStatus returns canSubmit false when Stripe metadata type is wrong', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent({ type: 'order_payment' }),
  });
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSubmit, false);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('getPaymentStatus returns canSubmit false when Stripe metadata userId mismatches', async () => {
  const onboarding = buildOnboarding({ status: 'payment_pending' });
  const { controller } = loadController(onboarding, {
    retrieveResult: buildSucceededPaymentIntent({
      userId: '507f1f77bcf86cd799439099',
    }),
  });
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSubmit, false);
  assert.equal(onboarding.verificationPayment.status, 'pending');
});

test('getPaymentStatus returns 404 when onboarding record is missing', async () => {
  const { controller } = loadController(null);
  const res = mockResponse();

  await controller.getPaymentStatus({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /not found/i);
});
