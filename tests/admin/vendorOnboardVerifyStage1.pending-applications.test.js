const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/admin/vendorOnboardVerifyStage1.js'
);
const isAdminPath = path.resolve(__dirname, '../../middlewares/isAdmin.js');

const buildApplication = (status, overrides = {}) => ({
  applicationId: `${status}-app`,
  status,
  userId: { _id: `${status}-user`, name: `${status} vendor`, email: `${status}@example.com` },
  minorityProofDocuments: [{ url: 'https://example.com/proof.pdf', verified: false }],
  verificationChecklist: { minorityDocs: true },
  totalVerificationPoints: 15,
  save: async () => {},
  ...overrides,
});

const createResponse = () => ({
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
});

const loadControllerWithMocks = (applications) => {
  const queryLog = {};

  const vendorOnboardingMock = {
    find(query) {
      queryLog.query = query;

      const filteredApplications = applications.filter((application) => {
        const allowedStatuses = query?.status?.$in;

        if (Array.isArray(allowedStatuses)) {
          return allowedStatuses.includes(application.status);
        }

        if (query?.status) {
          return application.status === query.status;
        }

        return true;
      });

      return {
        populate(pathArg, selectArg) {
          queryLog.populate = { path: pathArg, select: selectArg };
          return this;
        },
        sort(sortArg) {
          queryLog.sort = sortArg;
          return Promise.resolve(filteredApplications);
        },
      };
    },
  };

  const businessMock = {
    findOneAndUpdate: async () => {},
  };

  const userMock = {};

  const mailerMock = {
    sendVendorApprovedEmail: async () => {},
    sendVendorRejectionEmail: async () => {},
    sendVendorTrustBadgeAssignedEmail: async () => {},
  };

  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../../models/VendorOnboardingStage1') {
      return vendorOnboardingMock;
    }

    if (request === '../../models/User') {
      return userMock;
    }

    if (request === '../../models/Business') {
      return businessMock;
    }

    if (request === '../../utils/WellcomeMailer') {
      return mailerMock;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, queryLog };
};

test('getPendingApplications returns only submitted applications for admin review', async () => {
  const applications = [
    buildApplication('draft'),
    buildApplication('payment_pending'),
    buildApplication('submitted'),
    buildApplication('rejected'),
    buildApplication('verified'),
  ];
  const { controller, queryLog } = loadControllerWithMocks(applications);
  const res = createResponse();

  await controller.getPendingApplications({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(queryLog.query, { status: { $in: ['submitted'] } });
  assert.deepEqual(res.body.meta.statuses, ['submitted']);
  assert.deepEqual(queryLog.populate, { path: 'userId', select: 'name email' });
  assert.deepEqual(queryLog.sort, { submittedAt: -1, createdAt: -1 });
  assert.deepEqual(
    res.body.data.map((application) => application.status),
    ['submitted']
  );
});

test('getPendingApplications status=all returns every application status', async () => {
  const applications = [
    buildApplication('draft'),
    buildApplication('payment_pending'),
    buildApplication('submitted'),
    buildApplication('rejected'),
    buildApplication('verified'),
  ];
  const { controller, queryLog } = loadControllerWithMocks(applications);
  const res = createResponse();

  await controller.getPendingApplications({ query: { status: 'all' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(queryLog.query, {});
  assert.equal(res.body.meta.statusFilter, 'all');
  assert.deepEqual(
    res.body.data.map((application) => application.status),
    ['draft', 'payment_pending', 'submitted', 'rejected', 'verified']
  );
});

test('getPendingApplications filters specific statuses and maps approved alias to verified', async () => {
  const applications = [
    buildApplication('submitted'),
    buildApplication('rejected'),
    buildApplication('verified'),
  ];
  const { controller, queryLog } = loadControllerWithMocks(applications);
  const res = createResponse();

  await controller.getPendingApplications({ query: { status: 'rejected,approved' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(queryLog.query, { status: { $in: ['rejected', 'verified'] } });
  assert.deepEqual(res.body.meta.statuses, ['rejected', 'verified']);
  assert.deepEqual(
    res.body.data.map((application) => application.status),
    ['rejected', 'verified']
  );
});

test('getPendingApplications maps under_review and pending aliases to submitted queue', async () => {
  const applications = [
    buildApplication('draft'),
    buildApplication('submitted'),
  ];
  const { controller, queryLog } = loadControllerWithMocks(applications);
  const res = createResponse();

  await controller.getPendingApplications({ query: { status: ['under_review', 'pending'] } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(queryLog.query, { status: { $in: ['submitted'] } });
  assert.deepEqual(res.body.meta.statuses, ['submitted']);
  assert.deepEqual(
    res.body.data.map((application) => application.status),
    ['submitted']
  );
});

test('getPendingApplications rejects invalid status filters', async () => {
  const { controller } = loadControllerWithMocks([buildApplication('submitted')]);
  const res = createResponse();

  await controller.getPendingApplications({ query: { status: 'archived' } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.fieldErrors.status.includes('archived'));
});

test('getPendingApplications includes resubmitted applications once they return to submitted status', async () => {
  const applications = [
    buildApplication('submitted', {
      applicationId: 'resubmitted-app',
      resubmittedFrom: 'rejected',
    }),
    buildApplication('rejected', {
      applicationId: 'rejected-app',
    }),
  ];
  const { controller } = loadControllerWithMocks(applications);
  const res = createResponse();

  await controller.getPendingApplications({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.data.map((application) => ({
      applicationId: application.applicationId,
      status: application.status,
      resubmittedFrom: application.resubmittedFrom || null,
    })),
    [
      {
        applicationId: 'resubmitted-app',
        status: 'submitted',
        resubmittedFrom: 'rejected',
      },
    ]
  );
});

test('getPendingApplications excludes payment_pending applications with failed verification payment', async () => {
  const applications = [
    buildApplication('payment_pending', {
      applicationId: 'failed-payment-app',
      verificationPayment: { status: 'failed' },
    }),
    buildApplication('submitted', { applicationId: 'ready-app' }),
  ];
  const { controller } = loadControllerWithMocks(applications);
  const res = createResponse();

  await controller.getPendingApplications({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.data.map((application) => application.applicationId),
    ['ready-app']
  );
});

test('getPendingApplications uses submitted-only allowlist constant', () => {
  const { APPLICATION_STATUS_FILTERS, PENDING_REVIEW_STATUSES } = require(controllerPath);
  assert.deepEqual(PENDING_REVIEW_STATUSES, ['submitted']);
  assert.deepEqual(APPLICATION_STATUS_FILTERS, [
    'draft',
    'payment_pending',
    'submitted',
    'verified',
    'rejected',
  ]);
});

test('vendor onboarding pending route blocks non-admin users', () => {
  const isAdmin = require(isAdminPath);

  for (const role of ['customer', 'business_owner']) {
    const res = createResponse();
    let calledNext = false;

    isAdmin({ user: { role } }, res, () => {
      calledNext = true;
    });

    assert.equal(calledNext, false, `role ${role} should be blocked`);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Access denied: Admin only');
  }
});
