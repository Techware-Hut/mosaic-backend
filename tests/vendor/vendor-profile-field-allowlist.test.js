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
    userId: '507f1f77bcf86cd799439011',
    status: 'draft',
    badge: null,
    totalVerificationPoints: 0,
    businessBio: '',
    businessProfileImage: { url: '', verified: false },
    featureBanner: { url: '', verified: false },
    save: async () => {},
    ...overrides,
  };
}

function loadController({ onboarding, queryLog = {} }) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';

  const vendorOnboardingMock = {
    findOne(query) {
      queryLog.lastUserId = query.userId;
      return Promise.resolve(onboarding);
    },
  };

  const businessMock = {
    findOne: async () => null,
  };

  class Business {
    constructor(data = {}) {
      Object.assign(this, data);
      this._id = '507f1f77bcf86cd799439099';
    }

    async save() {
      return this;
    }
  }

  Business.findOne = async () => null;

  // A usable active subscription: the Business sync gate (#248) refuses the
  // sync without one, so profile-save tests must provide a realistic link.
  const subscriptionMock = {
    findOne: () => ({
      sort: () =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439022',
          subscriptionPlanId: '507f1f77bcf86cd799439033',
          status: 'active',
          businessId: null,
        }),
    }),
    updateOne: async () => ({ acknowledged: true, modifiedCount: 1 }),
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
      return {};
    }
    if (request === '../models/Business') {
      return Business;
    }
    if (request === '../models/Subscription') {
      return subscriptionMock;
    }
    if (request === '../utils/WellcomeMailer') {
      return mailerMock;
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
  const businessPath = path.resolve(__dirname, '../../models/Business.js');
  const subscriptionPath = path.resolve(__dirname, '../../models/Subscription.js');

  delete require.cache[controllerPath];
  delete require.cache[vendorOnboardingPath];
  delete require.cache[businessPath];
  delete require.cache[subscriptionPath];

  const loaded = require(controllerPath);
  Module._load = originalLoad;

  require.cache[vendorOnboardingPath] = {
    id: vendorOnboardingPath,
    filename: vendorOnboardingPath,
    loaded: true,
    exports: vendorOnboardingMock,
  };
  require.cache[businessPath] = {
    id: businessPath,
    filename: businessPath,
    loaded: true,
    exports: Business,
  };
  require.cache[subscriptionPath] = {
    id: subscriptionPath,
    filename: subscriptionPath,
    loaded: true,
    exports: subscriptionMock,
  };

  return { controller: loaded, queryLog };
}

test('stripProtectedVendorFields removes protected admin and payment fields', () => {
  const {
    stripProtectedVendorFields,
    VENDOR_PROTECTED_ONBOARDING_FIELDS,
  } = require(profileFieldsPath);

  const payload = {
    businessName: 'Legit Business',
    status: 'verified',
    badge: 'Diamond',
    totalVerificationPoints: 500,
    verificationPayment: { status: 'paid' },
    trust_score: 99,
    isApproved: true,
  };

  const cleaned = stripProtectedVendorFields(payload);

  assert.equal(cleaned.businessName, 'Legit Business');
  for (const field of VENDOR_PROTECTED_ONBOARDING_FIELDS) {
    assert.equal(field in cleaned, false, `protected field leaked: ${field}`);
  }
});

test('applyVendorBusinessProfileFields updates allowed fields only', () => {
  const { applyVendorBusinessProfileFields } = require(profileFieldsPath);
  const onboarding = buildOnboarding();

  applyVendorBusinessProfileFields(onboarding, {
    businessBio: 'Updated bio',
    status: 'verified',
    badge: 'Diamond',
    totalVerificationPoints: 100,
  });

  assert.equal(onboarding.businessBio, 'Updated bio');
  assert.equal(onboarding.status, 'draft');
  assert.equal(onboarding.badge, null);
  assert.equal(onboarding.totalVerificationPoints, 0);
});

test('sanitizeVendorMediaField preserves verified flag and accepts url only', () => {
  const { sanitizeVendorMediaField } = require(profileFieldsPath);

  const result = sanitizeVendorMediaField(
    { url: 'https://example.com/logo.png', verified: true },
    { url: '', verified: false }
  );

  assert.deepEqual(result, {
    url: 'https://example.com/logo.png',
    verified: false,
  });
});

test('patchBusinessProfile applies allowed fields and ignores protected fields', async () => {
  const onboarding = buildOnboarding();
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  await controller.patchBusinessProfile(
    {
      user: { _id: onboarding.userId },
      body: {
        businessBio: 'Patched bio',
        badge: 'Diamond',
        status: 'verified',
        totalVerificationPoints: 250,
      },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(onboarding.businessBio, 'Patched bio');
  assert.equal(onboarding.badge, null);
  assert.equal(onboarding.status, 'draft');
  assert.equal(onboarding.totalVerificationPoints, 0);
});

test('updateBusinessProfile applies allowlist and ignores protected fields', async () => {
  const onboarding = buildOnboarding();
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  await controller.updateBusinessProfile(
    {
      user: { _id: onboarding.userId },
      body: {
        businessBio: 'PUT bio',
        badge: 'Platinum',
        status: 'verified',
        verificationPayment: { status: 'paid' },
      },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(onboarding.businessBio, 'PUT bio');
  assert.equal(onboarding.badge, null);
  assert.equal(onboarding.status, 'draft');
});

test('saveDraft strips protected fields from vendor draft payload', async () => {
  const onboarding = buildOnboarding();
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  await controller.saveDraft(
    {
      user: { _id: onboarding.userId },
      body: {
        businessName: 'Draft Business',
        badge: 'Diamond',
        status: 'verified',
        totalVerificationPoints: 400,
        verificationChecklist: { taxDocs: true },
      },
    },
    res
  );

  assert.equal(res.body.success, true);
  assert.equal(onboarding.businessName, 'Draft Business');
  assert.equal(onboarding.badge, null);
  assert.equal(onboarding.status, 'draft');
  assert.equal(onboarding.totalVerificationPoints, 0);
  assert.equal(onboarding.verificationChecklist, undefined);
});

test('vendor profile updates query onboarding by authenticated user id only', async () => {
  const onboarding = buildOnboarding({ userId: '507f1f77bcf86cd799439011' });
  const queryLog = {};
  const { controller } = loadController({ onboarding, queryLog });
  const res = mockResponse();
  const vendorA = '507f1f77bcf86cd799439011';
  const vendorB = '507f1f77bcf86cd799439012';

  await controller.patchBusinessProfile(
    {
      user: { _id: vendorA },
      body: { businessBio: 'Vendor A bio' },
    },
    res
  );

  assert.equal(String(queryLog.lastUserId), vendorA);
  assert.notEqual(String(queryLog.lastUserId), vendorB);
  assert.equal(onboarding.businessBio, 'Vendor A bio');
});

// ─── Lionel Review Fix: Point 1 ─────────────────────────────────────────────
// Verified vendors submitting the SAME sensitive field values must not get 400.
// The frontend profile editor always includes the full payload (even unchanged
// fields), so the guard must compare VALUES, not just field presence.

test('verified vendor submitting unchanged licenseNumber does not get 400 (regression guard)', async () => {
  const onboarding = buildOnboarding({
    status: 'verified',
    hasBusinessLicense: true,
    licenseNumber: 'LIC-EXISTING-123',
    refundPolicyDocument: { url: 'https://s3.example.com/refund.pdf', verified: true },
    termsDocument: { url: 'https://s3.example.com/terms.pdf', verified: true },
  });
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  // Frontend sends the SAME values back as part of the full profile payload
  await controller.updateBusinessProfile(
    {
      user: { _id: onboarding.userId },
      body: {
        businessBio: 'Updated bio',
        licenseNumber: 'LIC-EXISTING-123',                            // unchanged
        refundPolicyDocument: { url: 'https://s3.example.com/refund.pdf', verified: true }, // unchanged
        termsDocument: { url: 'https://s3.example.com/terms.pdf', verified: true },         // unchanged
      },
    },
    res
  );

  assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
});

test('verified vendor trying to CHANGE licenseNumber is still blocked with 400', async () => {
  const onboarding = buildOnboarding({
    status: 'verified',
    hasBusinessLicense: true,
    licenseNumber: 'LIC-EXISTING-123',
  });
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  // Frontend tries to change the license number to a new value
  await controller.updateBusinessProfile(
    {
      user: { _id: onboarding.userId },
      body: {
        businessBio: 'Updated bio',
        licenseNumber: 'LIC-FRAUDULENT-999',   // CHANGED — must be blocked
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test('patchBusinessProfile: verified vendor with unchanged sensitive fields succeeds (regression guard)', async () => {
  const onboarding = buildOnboarding({
    status: 'verified',
    hasBusinessLicense: false,
    noLicenseComplianceConfirmed: true,
    declarationAccepted: true,
  });
  const { controller } = loadController({ onboarding });
  const res = mockResponse();

  // Same values echoed back from frontend — must be allowed
  await controller.patchBusinessProfile(
    {
      user: { _id: onboarding.userId },
      body: {
        businessBio: 'Patched bio from verified no-license vendor',
        hasBusinessLicense: false,              // unchanged
        noLicenseComplianceConfirmed: true,     // unchanged
        declarationAccepted: true,              // unchanged
      },
    },
    res
  );

  assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
});
