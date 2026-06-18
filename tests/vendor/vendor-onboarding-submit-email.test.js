const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);
const emailDeliveryPath = path.resolve(
  __dirname,
  '../../utils/vendorOnboardingEmailDelivery.js'
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
    applicationId: 'MBH-APP-SUBMIT-001',
    businessName: 'Test Business LLC',
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
    verificationPayment: { status: 'paid' },
    toObject() {
      return { ...this };
    },
    save: async function save() {
      return this;
    },
    ...overrides,
  };
}

function loadController({
  onboarding,
  mailerCalls = {},
  emailConfigured = true,
  mailerOverrides = {},
}) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
  process.env.MAIL_USER = emailConfigured ? 'mail@example.com' : '';
  process.env.MAIL_PASSWORD = emailConfigured ? 'app-password' : '';

  const vendorOnboardingMock = {
    findOne: async () => onboarding,
  };

  const userMock = {
    findById: () => ({
      select: async () => ({ name: 'Vendor User', email: 'vendor@example.com' }),
    }),
  };

  const mailerMock = {
    sendAdminOnboardingSubmissionEmail:
      mailerOverrides.sendAdminOnboardingSubmissionEmail
      || (async (payload) => {
        mailerCalls.admin = payload;
      }),
    sendVendorSubmissionConfirmationEmail:
      mailerOverrides.sendVendorSubmissionConfirmationEmail
      || (async (payload) => {
        mailerCalls.vendor = payload;
      }),
    sendAdminVendorProfileCompletedEmail: async () => {},
  };

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return () => ({
        paymentIntents: { create: async () => ({ id: 'pi_test' }) },
      });
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
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  delete require.cache[emailDeliveryPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, mailerCalls };
}

test('submitForReview sends admin and vendor emails when SMTP configured', async () => {
  const onboarding = buildOnboarding();
  const { controller, mailerCalls } = loadController({ onboarding });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(onboarding.status, 'submitted');
  assert.equal(res.body.emailSent, true);
  assert.equal(res.body.emailSkipped, false);
  assert.ok(mailerCalls.admin);
  assert.ok(mailerCalls.vendor);
  assert.equal(mailerCalls.vendor.to, 'vendor@example.com');
});

test('submitForReview skips emails when SMTP not configured', async () => {
  const onboarding = buildOnboarding();
  const mailerCalls = {};
  const { controller } = loadController({
    onboarding,
    mailerCalls,
    emailConfigured: false,
  });
  const res = mockResponse();

  const warnLogs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnLogs.push(args.join(' '));

  await controller.submitForReview({ user: { _id: userId } }, res);

  console.warn = originalWarn;

  assert.equal(res.statusCode, 200);
  assert.equal(onboarding.status, 'submitted');
  assert.equal(res.body.emailSent, false);
  assert.equal(res.body.emailSkipped, true);
  assert.equal(mailerCalls.admin, undefined);
  assert.equal(mailerCalls.vendor, undefined);
  assert.ok(warnLogs.some((line) => line.includes('not configured')));
});

test('submitForReview succeeds when email send fails', async () => {
  const onboarding = buildOnboarding();
  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const { controller } = loadController({
    onboarding,
    mailerOverrides: {
      sendAdminOnboardingSubmissionEmail: async () => {
        throw new Error('SMTP connection refused');
      },
      sendVendorSubmissionConfirmationEmail: async () => {
        throw new Error('SMTP connection refused');
      },
    },
  });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  console.error = originalError;

  assert.equal(res.statusCode, 200);
  assert.equal(onboarding.status, 'submitted');
  assert.equal(res.body.emailSent, false);
  assert.ok(errorLogs.some((line) => line.includes('admin_submission')));
  assert.ok(!errorLogs.some((line) => line.includes('app-password')));
});

test('submitForReview idempotent when already submitted does not resend emails', async () => {
  const onboarding = buildOnboarding({ status: 'submitted' });
  const mailerCalls = {};
  const { controller } = loadController({ onboarding, mailerCalls });
  const res = mockResponse();

  await controller.submitForReview({ user: { _id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(mailerCalls.admin, undefined);
  assert.equal(mailerCalls.vendor, undefined);
});
