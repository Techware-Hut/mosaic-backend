const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const middlewarePath = path.resolve(
  __dirname,
  '../../middlewares/requireVerifiedVendor.js'
);
const authenticatePath = path.resolve(__dirname, '../../middlewares/authenticate.js');

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

function loadMiddleware(onboardingRecord) {
  const vendorOnboardingMock = {
    findOne(query) {
      return {
        select() {
          return this;
        },
        lean: async () => {
          if (!onboardingRecord) {
            return null;
          }

          if (
            onboardingRecord.userId &&
            String(onboardingRecord.userId) !== String(query.userId)
          ) {
            return null;
          }

          return onboardingRecord;
        },
      };
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/VendorOnboardingStage1') {
      return vendorOnboardingMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[middlewarePath];
  const loaded = require(middlewarePath);
  Module._load = originalLoad;
  return loaded;
}

function buildVendorUser(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    role: 'business_owner',
    isOtpVerified: true,
    isBlocked: false,
    isDeleted: false,
    ...overrides,
  };
}

test('requireVerifiedVendor rejects missing authenticated user with 401', async () => {
  const requireVerifiedVendor = loadMiddleware(null);
  const res = mockResponse();
  let calledNext = false;

  await requireVerifiedVendor({ user: undefined }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Unauthorized');
});

test('requireVerifiedVendor rejects customer role with 403', async () => {
  const requireVerifiedVendor = loadMiddleware(null);
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

test('requireVerifiedVendor rejects business_owner without OTP verification', async () => {
  const requireVerifiedVendor = loadMiddleware(null);
  const res = mockResponse();
  let calledNext = false;

  await requireVerifiedVendor(
    { user: buildVendorUser({ isOtpVerified: false }) },
    res,
    () => {
      calledNext = true;
    }
  );

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'OTP verification required');
});

test('requireStage1VerifiedVendor rejects business_owner without verified onboarding status', async () => {
  const requireStage1VerifiedVendor = loadMiddleware({
    userId: '507f1f77bcf86cd799439011',
    status: 'draft',
  }).create({ requireStage1Verified: true });
  const res = mockResponse();
  let calledNext = false;

  await requireStage1VerifiedVendor({ user: buildVendorUser() }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Stage 1 vendor verification required');
});

test('requireStage1VerifiedVendor allows verified business_owner', async () => {
  const requireStage1VerifiedVendor = loadMiddleware({
    userId: '507f1f77bcf86cd799439011',
    status: 'verified',
  }).create({ requireStage1Verified: true });
  const res = mockResponse();
  let calledNext = false;

  await requireStage1VerifiedVendor({ user: buildVendorUser() }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(res.statusCode, null);
});

test('vendor onboarding route remains blocked without authentication', async () => {
  const authenticate = require(authenticatePath);
  const req = { headers: {}, cookies: {} };
  const res = mockResponse();
  let calledNext = false;

  await authenticate(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Authentication required');
});
