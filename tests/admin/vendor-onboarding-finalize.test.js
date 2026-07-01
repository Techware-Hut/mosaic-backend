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
    businessName: 'Test Vendor LLC',
    isMinorityOwned: false,
    minorityProofDocuments: [{ url: 'https://example.com/proof.pdf', verified: false }],
    totalVerificationPoints: 35,
    verificationNotificationLog: [],
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
  const businessUpdates = [];

  const businessMock = {
    findOneAndUpdate: async (filter, update) => {
      businessUpdates.push({ filter, update });
    },
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
    sendVendorVerificationGuidanceEmail: mailerOverrides.sendVendorVerificationGuidanceEmail || (async (payload) => {
      mailerCalls.guidance = mailerCalls.guidance || [];
      mailerCalls.guidance.push(payload);
    }),
  };

  const auditEvents = [];
  const auditMock = {
    recordAdminAuditSuccess: async (req, payload) => {
      auditEvents.push({ outcome: 'success', payload });
      return { recorded: true };
    },
    recordAdminAuditFailure: async (req, payload) => {
      auditEvents.push({ outcome: 'failure', payload });
      return { recorded: true };
    },
    buildFieldChangeSummary: (before, after, fields) => ({ before, after, fields }),
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
    if (String(request).includes('services/adminAuditService')) {
      return auditMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  delete require.cache[emailDeliveryPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, mailerCalls, businessUpdates, auditEvents };
}

test('finalizeVerification approves when required docs verified', async () => {
  const application = buildApplication();
  const { controller, mailerCalls, businessUpdates } = loadController({ application });
  const res = createResponse();

  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(application.status, 'verified');
  assert.equal(res.body.data.status, 'approved');
  assert.equal(res.body.data.badge, 'Silver');
  assert.equal(res.body.data.emailSent, true);
  assert.ok(mailerCalls.approved);
  assert.ok(mailerCalls.badge);
  assert.equal(businessUpdates.at(-1).update.$set.isApproved, true);
});

test('finalizeVerification rejects when required docs missing', async () => {
  const application = buildApplication({
    verificationChecklist: {
      taxDocs: false,
      businessLicense: true,
      minorityDocs: false,
    },
  });
  const { controller, mailerCalls, businessUpdates } = loadController({ application });
  const res = createResponse();

  await controller.finalizeVerification({ params: { applicationId: application.applicationId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(application.status, 'rejected');
  assert.equal(res.body.data.status, 'rejected');
  assert.ok(mailerCalls.rejection);
  assert.ok(mailerCalls.rejection.rejectionReason.includes('EIN document'));
  assert.equal(res.body.data.notificationLogged, true);
  assert.equal(application.verificationNotificationLog.length, 1);
  assert.equal(application.verificationNotificationLog[0].event, 'missing_documents');
  assert.equal(application.verificationNotificationLog[0].deliveryStatus, 'sent');
  assert.deepEqual(application.verificationNotificationLog[0].documentsNeeded, ['EIN document']);
  assert.equal(businessUpdates.at(-1).update.$set.isApproved, false);
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

test('sendVerificationGuidanceNotification sends failed-validation email and logs attempt', async () => {
  const application = buildApplication();
  const mailerCalls = {};
  const { controller } = loadController({ application, mailerCalls });
  const res = createResponse();

  await controller.sendVerificationGuidanceNotification(
    {
      params: { applicationId: application.applicationId },
      body: {
        outcome: 'failed_validation',
        adminNote: 'License number does not match the state record',
        fieldsNeeded: ['licenseNumber'],
        responseWindowDays: 3,
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.outcome, 'failed_validation');
  assert.equal(res.body.data.emailSent, true);
  assert.equal(res.body.data.notificationLogged, true);
  assert.equal(mailerCalls.guidance.length, 1);
  assert.equal(mailerCalls.guidance[0].outcome, 'failed_validation');
  assert.deepEqual(
    mailerCalls.guidance[0].reasons,
    ['License number does not match the state record']
  );
  assert.deepEqual(mailerCalls.guidance[0].fieldsNeeded, ['licenseNumber']);
  assert.equal(application.verificationNotificationLog.length, 1);
  assert.equal(application.verificationNotificationLog[0].event, 'failed_validation');
  assert.equal(application.verificationNotificationLog[0].deliveryStatus, 'sent');
});

test('sendVerificationGuidanceNotification supports discrepancy, under-review, and manual-review outcomes', async () => {
  for (const outcome of ['discrepancy', 'under_review', 'manual_review']) {
    const application = buildApplication({ applicationId: `MBH-${outcome}` });
    const mailerCalls = {};
    const { controller } = loadController({ application, mailerCalls });
    const res = createResponse();

    await controller.sendVerificationGuidanceNotification(
      {
        params: { applicationId: application.applicationId },
        body: {
          outcome,
          reason: `${outcome} vendor-facing reason`,
          internalNote: 'Private admin-only note that must not be emailed',
          documentsNeeded: outcome === 'discrepancy' ? ['updated business license'] : [],
        },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.outcome, outcome);
    assert.equal(mailerCalls.guidance.length, 1);
    assert.equal(mailerCalls.guidance[0].outcome, outcome);
    assert.ok(mailerCalls.guidance[0].reasons.includes(`${outcome} vendor-facing reason`));
    assert.ok(!JSON.stringify(mailerCalls.guidance[0]).includes('Private admin-only note'));
    assert.equal(application.verificationNotificationLog[0].event, outcome);
  }
});

test('sendVerificationGuidanceNotification suppresses duplicate status and reason sends', async () => {
  const application = buildApplication();
  const mailerCalls = {};
  const { controller } = loadController({ application, mailerCalls });

  const req = {
    params: { applicationId: application.applicationId },
    body: {
      outcome: 'discrepancy',
      reason: 'Business name differs from public record',
      fieldsNeeded: ['businessName'],
    },
  };

  const firstRes = createResponse();
  await controller.sendVerificationGuidanceNotification(req, firstRes);

  const secondRes = createResponse();
  await controller.sendVerificationGuidanceNotification(req, secondRes);

  assert.equal(firstRes.statusCode, 200);
  assert.equal(secondRes.statusCode, 200);
  assert.equal(secondRes.body.data.emailDeduped, true);
  assert.equal(mailerCalls.guidance.length, 1);
  assert.equal(application.verificationNotificationLog.length, 1);
});

test('sendVerificationGuidanceNotification logs failed email attempt without throwing', async () => {
  const application = buildApplication();
  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const { controller } = loadController({
    application,
    mailerOverrides: {
      sendVendorVerificationGuidanceEmail: async () => {
        throw new Error('SMTP unavailable');
      },
    },
  });
  const res = createResponse();

  await controller.sendVerificationGuidanceNotification(
    {
      params: { applicationId: application.applicationId },
      body: {
        outcome: 'manual_review',
        reason: 'Manual review needed before approval',
      },
    },
    res
  );

  console.error = originalError;

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.emailSent, false);
  assert.equal(res.body.data.emailFailed, true);
  assert.equal(res.body.data.notificationLogged, true);
  assert.equal(application.verificationNotificationLog.length, 1);
  assert.equal(application.verificationNotificationLog[0].deliveryStatus, 'failed');
  assert.ok(application.verificationNotificationLog[0].error.includes('SMTP unavailable'));
  assert.ok(errorLogs.some((line) => line.includes('vendor_manual_review')));
});
