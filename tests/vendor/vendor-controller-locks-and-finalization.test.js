process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key_12345';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);
const adminVerifyPath = path.resolve(
  __dirname,
  '../../controllers/admin/vendorOnboardVerifyStage1.js'
);

const userId = '507f1f77bcf86cd799439011';
const adminId = '507f1f77bcf86cd799439022';

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
    applicationId: 'MBH-APP-TEST-999',
    businessName: 'Test Vendor LLC',
    businessType: 'product',
    primaryContactName: 'Sam Vendor',
    address: {
      city: 'Atlanta',
      state: 'GA',
      country: 'USA',
      zipCode: '30301',
    },
    acceptedTerms: true,
    declarationAccepted: true,
    hasBusinessLicense: true,
    licenseNumber: 'LIC-9999',
    isMinorityOwned: false,
    status: 'draft',
    verificationChecklist: {
      taxDocs: false,
      businessLicense: false,
      minorityDocs: false,
    },
    totalVerificationPoints: 0,
    toObject() {
      return { ...this };
    },
    save: async function save() {
      return this;
    },
    ...overrides,
  };
}

function loadControllerWithMock(onboardingDoc) {
  delete require.cache[controllerPath];
  delete require.cache[adminVerifyPath];

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request.endsWith('models/VendorOnboardingStage1') || request.endsWith('models/VendorOnboarding') || request === '../models/VendorOnboardingStage1' || request === '../models/VendorOnboarding') {
      return {
        findOne: () => ({
          populate: async () => onboardingDoc,
          exec: async () => onboardingDoc,
          then: (resolve) => resolve(onboardingDoc),
        }),
      };
    }
    if (request.endsWith('models/User') || request === '../models/User') {
      return {
        findById: () => ({
          select: async () => ({ name: 'Vendor User', email: 'vendor@example.com' }),
        }),
      };
    }
    if (request.endsWith('models/Business') || request === '../models/Business') {
      return {
        findOneAndUpdate: async () => ({}),
        findOne: async () => ({}),
      };
    }
    if (request.endsWith('models/AdminAuditEvent') || request === '../models/AdminAuditEvent') {
      return {
        create: async () => ({}),
      };
    }
    if (request.includes('adminAuditLogger')) {
      return {
        recordAdminAuditSuccess: async () => {},
        recordAdminAuditFailure: async () => {},
        ADMIN_AUDIT_ACTIONS: {
          VENDOR_APPLICATION_FINALIZE_APPROVED: 'vendor.application.finalize_approved',
          VENDOR_APPLICATION_FINALIZE_FAILED: 'vendor.application.finalize_failed',
        },
        ADMIN_AUDIT_TARGET_TYPES: {
          VENDOR_APPLICATION: 'vendor_application',
        },
      };
    }
    if (request.includes('syncBusinessPoints')) {
      return {
        syncBusinessPoints: async () => {},
      };
    }
    if (request.includes('WellcomeMailer') || request.includes('vendorOnboardingEmailDelivery')) {
      return {
        sendAdminOnboardingSubmissionEmail: async () => {},
        sendVendorSubmissionConfirmationEmail: async () => {},
        deliverVendorOnboardingEmails: async () => ({ emailSent: true }),
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return {
      controller: require(controllerPath),
      adminVerify: require(adminVerifyPath),
    };
  } finally {
    Module._load = originalLoad;
  }
}

test('saveDraft rejects non-boolean hasBusinessLicense at raw API boundary', async () => {
  const { controller } = loadControllerWithMock(buildOnboarding({ status: 'draft' }));
  const req = {
    user: { _id: userId },
    body: { hasBusinessLicense: 'invalid-string' },
  };
  const res = mockResponse();

  await controller.saveDraft(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('hasBusinessLicense must be a boolean'));
});

test('saveDraft blocks sensitive mutations when application is in submitted status', async () => {
  const { controller } = loadControllerWithMock(buildOnboarding({ status: 'submitted' }));
  const req = {
    user: { _id: userId },
    body: { acceptedTerms: false },
  };
  const res = mockResponse();

  await controller.saveDraft(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('approval-sensitive fields cannot be edited'));
});

test('saveDraft blocks sensitive mutations when application is in under_review status', async () => {
  const { controller } = loadControllerWithMock(buildOnboarding({ status: 'under_review' }));
  const req = {
    user: { _id: userId },
    body: { taxDocuments: [{ url: 'https://example.com/tax.pdf' }] },
  };
  const res = mockResponse();

  await controller.saveDraft(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('approval-sensitive fields cannot be edited'));
});

test('finalizeVerification succeeds for no-license vendor when compliance is confirmed and attestation verified', async () => {
  const application = buildOnboarding({
    status: 'submitted',
    hasBusinessLicense: false,
    noLicenseComplianceConfirmed: true,
    verificationChecklist: {
      taxDocs: true,
      businessLicense: true,
      minorityDocs: true,
    },
  });

  const { adminVerify } = loadControllerWithMock(application);
  const req = {
    user: { _id: adminId, role: 'admin' },
    params: { applicationId: 'MBH-APP-TEST-999' },
    body: { id: 'MBH-APP-TEST-999', decision: 'approve' },
  };
  const res = mockResponse();

  await adminVerify.finalizeVerification(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(application.status, 'verified');
});

test('finalizeVerification rejects explicit approve when no-license compliance attestation is unverified', async () => {
  const application = buildOnboarding({
    status: 'submitted',
    hasBusinessLicense: false,
    noLicenseComplianceConfirmed: true,
    verificationChecklist: {
      taxDocs: true,
      businessLicense: false, // Admin has not verified attestation
      minorityDocs: true,
    },
  });

  const { adminVerify } = loadControllerWithMock(application);
  const req = {
    user: { _id: adminId, role: 'admin' },
    params: { applicationId: 'MBH-APP-TEST-999' },
    body: { id: 'MBH-APP-TEST-999', decision: 'approve' },
  };
  const res = mockResponse();

  await adminVerify.finalizeVerification(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('required documents are not verified'));
});
