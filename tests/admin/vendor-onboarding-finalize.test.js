const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/admin/vendorOnboardVerifyStage1.js'
);
const emailDeliveryPath = path.resolve(
  __dirname,
  '../../utils/vendorOnboardingEmailDelivery.js'
);

function buildApplication(overrides = {}) {
  const base = {
    applicationId: 'MBH-APP-FINALIZE-001',
    status: 'submitted',
    isMinorityOwned: false,
    minorityProofDocuments: [{ url: 'https://example.com/proof.pdf', verified: false }],
    totalVerificationPoints: 35,
    verificationChecklist: {
      taxDocs: true,
      businessLicense: true,
      minorityDocs: false,
    },
    userId: {
      _id: '507f1f77bcf86cd799439011',
      name: 'Vendor User',
      email: 'vendor@example.com',
    },
    save: async function save() {
      return this;
    },
  };
  return { ...base, ...overrides };
}

function createResponse() {
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

function buildVendorOnboardingMock(application) {
  return {
    findOne: () => ({
      populate: async () => application,
    }),
  };
}

function loadController({ application, mailerCalls = {}, emailConfigured = true, mailerOverrides = {} }) {
  process.env.MAIL_USER = emailConfigured ? 'mail@example.com' : '';
  process.env.MAIL_PASSWORD = emailConfigured ? 'app-password' : '';

  const vendorOnboardingMock = buildVendorOnboardingMock(application);

  const businessMock = {
    findOneAndUpdate: async () => {},
  };

  const mailerMock = {
    sendVendorApprovedEmail: mailerOverrides.sendVendorApprovedEmail || (async (payload) => {
      mailerCalls.approved = payload;
    }),
    sendVendorRejectionEmail: mailerOverrides.sendVendorRejectionEmail || (async (payload) => {
      mailerCalls.rejection = payload;
    }),
    sendVendorTrustBadgeAssignedEmail: mailerOverrides.sendVendorTrustBadgeAssignedEmail || (async (payload) => {
      mailerCalls.badge = payload;
    }),
  };

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/VendorOnboardingStage1')) {
      return vendorOnboardingMock;
    }
    if (String(request).includes('models/User')) {
      return {};
    }
    if (String(request).includes('models/Business')) {
      return businessMock;
    }
    if (String(request).includes('utils/WellcomeMailer')) {
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

test('finalizeVerification approves when required docs verified', async () => {
  const application = buildApplication();
  const { controller, mailerCalls } = loadController({ application });
  const res = createResponse();

  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(application.status, 'verified');
  assert.equal(res.body.data.status, 'approved');
  assert.equal(res.body.data.badge, 'Silver');
  assert.equal(res.body.data.emailSent, true);
  assert.ok(mailerCalls.approved);
  assert.ok(mailerCalls.badge);
});

test('finalizeVerification rejects when required docs missing', async () => {
  const application = buildApplication({
    verificationChecklist: {
      taxDocs: false,
      businessLicense: true,
      minorityDocs: false,
    },
  });
  const { controller, mailerCalls } = loadController({ application });
  const res = createResponse();

  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(application.status, 'rejected');
  assert.equal(res.body.data.status, 'rejected');
  assert.ok(mailerCalls.rejection);
  assert.ok(mailerCalls.rejection.rejectionReason.includes('EIN document'));
});

test('finalizeVerification blocks non-submitted applications', async () => {
  const application = buildApplication({ status: 'verified' });
  const { controller } = loadController({ application });
  const res = createResponse();

  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data.currentStatus, 'verified');
});

test('finalizeVerification succeeds when email send fails', async () => {
  const application = buildApplication();
  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const { controller } = loadController({
    application,
    mailerOverrides: {
      sendVendorApprovedEmail: async () => {
        throw new Error('SMTP connection refused');
      },
      sendVendorTrustBadgeAssignedEmail: async () => {
        throw new Error('SMTP connection refused');
      },
    },
  });

  const res = createResponse();
  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  console.error = originalError;

  assert.equal(res.statusCode, 200);
  assert.equal(application.status, 'verified');
  assert.equal(res.body.data.emailSent, false);
  assert.ok(errorLogs.some((line) => line.includes('vendor_approved')));
  assert.ok(!errorLogs.some((line) => line.includes('app-password')));
});

test('finalizeVerification skips email when SMTP not configured', async () => {
  const application = buildApplication();
  const mailerCalls = {};
  const { controller } = loadController({ application, mailerCalls, emailConfigured: false });
  const res = createResponse();

  const warnLogs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnLogs.push(args.join(' '));

  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  console.warn = originalWarn;

  assert.equal(res.statusCode, 200);
  assert.equal(application.status, 'verified');
  assert.equal(res.body.data.emailSent, false);
  assert.equal(res.body.data.emailSkipped, true);
  assert.equal(mailerCalls.approved, undefined);
  assert.ok(warnLogs.some((line) => line.includes('not configured')));
});
