const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const userControllerPath = path.resolve(__dirname, '../../controllers/userController.js');
const userRoutesPath = path.resolve(__dirname, '../../routes/userRoutes.js');

function withMocks(modulePath, mocks) {
  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[modulePath];
  const loadedModule = require(modulePath);
  Module._load = originalLoad;

  return loadedModule;
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    cookies: {},
    authCookies: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
    },
  };
}

function buildControllerMocks(overrides = {}) {
  let setAuthCookiesCalled = false;

  const mocks = {
    '../models/User': {
      findOne: async () => null,
      ...(overrides.User || {}),
    },
    bcryptjs: {
      hash: async (value) => `hashed:${value}`,
      compare: async () => true,
      ...(overrides.bcryptjs || {}),
    },
    'express-validator': {
      validationResult: () => ({ isEmpty: () => true, array: () => [] }),
    },
    '../utils/mailer': {
      sendOtpEmail: async () => {},
      sendWelcomeEmail: async () => {},
      sendPasswordResetOtpEmail: async () => {},
      ...(overrides.mailer || {}),
    },
    '../utils/cookieHelper': {
      getCookieOptions: () => ({}),
      clearCookie: () => {},
      setAuthCookies: (res, token, user, maxAge) => {
        setAuthCookiesCalled = true;
        res.authCookies = { token, userId: user._id.toString(), maxAge };
      },
      clearAuthCookies: () => {},
    },
    jsonwebtoken: {
      sign: () => 'test-token',
    },
    ...overrides.extra,
  };

  return {
    mocks,
    getSetAuthCookiesCalled: () => setAuthCookiesCalled,
  };
}

const registerBody = {
  name: 'OTP Delivery Test',
  email: 'otp-delivery@example.com',
  password: 'secret12',
  mobile: '+15559876543',
  role: 'customer',
};

const unverifiedUser = {
  _id: '507f1f77bcf86cd799439011',
  email: 'unverified@example.com',
  name: 'Unverified User',
  role: 'customer',
  passwordHash: 'hashed-password',
  isOtpVerified: false,
  isDeleted: false,
  isBlocked: false,
  sessionVersion: 0,
};

function assertNoOtpInBody(body) {
  const serialized = JSON.stringify(body);
  assert.ok(!/\b\d{6}\b/.test(serialized), 'response must not contain a 6-digit OTP');
}

function assertNoProviderLeakInBody(body) {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /EAUTH|535|api[_-]?key|smtp-password|credential/i);
}

class RegisterMockUser {
  constructor(data) {
    Object.assign(this, data);
    this._id = '507f1f77bcf86cd799439011';
    this.saveCalled = false;
  }

  async save() {
    this.saveCalled = true;
    return this;
  }
}
RegisterMockUser.findOne = async () => null;

test('registerUser returns 201 when OTP email sends successfully', async () => {
  const userController = withMocks(userControllerPath, {
    ...buildControllerMocks().mocks,
    '../models/User': RegisterMockUser,
  });

  const res = createResponse();
  await userController.registerUser({ body: registerBody }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /email/i);
  assert.doesNotMatch(res.body.message, /mobile/i);
  assert.equal(res.cookies.otpPending, 'true');
  assertNoOtpInBody(res.body);
});

test('registerUser returns OTP_DELIVERY_FAILED when sendOtpEmail throws', async () => {
  let savedUser = null;

  class SavingMockUser extends RegisterMockUser {
    constructor(data) {
      super(data);
      savedUser = this;
    }
  }
  SavingMockUser.findOne = async () => null;

  const vendorBody = { ...registerBody, role: 'business_owner' };

  const userController = withMocks(userControllerPath, {
    ...buildControllerMocks({
      mailer: {
        sendOtpEmail: async () => {
          const err = new Error('EAUTH 535 smtp-password rejected');
          err.code = 'EAUTH';
          throw err;
        },
      },
    }).mocks,
    '../models/User': SavingMockUser,
  });

  const res = createResponse();
  await userController.registerUser({ body: vendorBody }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'OTP_DELIVERY_FAILED');
  assert.match(res.body.message, /account was created/i);
  assert.equal(res.body.otpPending, true);
  assert.equal(res.body.accountCreated, true);
  assert.equal(res.body.user.email, vendorBody.email);
  assert.equal(res.body.user.role, 'business_owner');
  assert.equal(res.cookies.otpPending, 'true');
  assert.ok(savedUser && savedUser.saveCalled, 'unverified account should be preserved');
  assertNoOtpInBody(res.body);
  assertNoProviderLeakInBody(res.body);
});

test('resendOtp returns OTP_DELIVERY_FAILED when sendOtpEmail throws', async () => {
  const userController = withMocks(userControllerPath, buildControllerMocks({
    User: {
      findOne: async () => ({
        ...unverifiedUser,
        async save() {
          return this;
        },
      }),
    },
    mailer: {
      sendOtpEmail: async () => {
        const err = new Error('EAUTH 535 smtp-password rejected');
        err.code = 'EAUTH';
        throw err;
      },
    },
  }).mocks);

  const res = createResponse();
  await userController.resendOtp({ body: { email: unverifiedUser.email } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'OTP_DELIVERY_FAILED');
  assert.match(res.body.message, /try again later/i);
  assert.equal(res.body.otpPending, true);
  assert.equal(res.body.user.email, unverifiedUser.email);
  assert.equal(res.body.user.role, unverifiedUser.role);
  assert.equal(res.cookies.otpPending, undefined);
  assertNoOtpInBody(res.body);
  assertNoProviderLeakInBody(res.body);
});

test('resendOtp returns 200 when sendOtpEmail succeeds', async () => {
  const userController = withMocks(userControllerPath, buildControllerMocks({
    User: {
      findOne: async () => ({
        ...unverifiedUser,
        async save() {
          return this;
        },
      }),
    },
  }).mocks);

  const res = createResponse();
  await userController.resendOtp({ body: { email: unverifiedUser.email } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.cookies.otpPending, 'true');
  assertNoOtpInBody(res.body);
});

test('loginUser returns OTP_DELIVERY_FAILED for unverified user when sendOtpEmail throws', async () => {
  const { mocks, getSetAuthCookiesCalled } = buildControllerMocks({
    User: {
      findOne: async () => ({
        ...unverifiedUser,
        async save() {
          return this;
        },
      }),
    },
    mailer: {
      sendOtpEmail: async () => {
        const err = new Error('EAUTH 535 smtp-password rejected');
        err.code = 'EAUTH';
        throw err;
      },
    },
  });

  const userController = withMocks(userControllerPath, mocks);
  const res = createResponse();

  await userController.loginUser(
    { body: { email: unverifiedUser.email, password: 'secret12' } },
    res
  );

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'OTP_DELIVERY_FAILED');
  assert.equal(
    res.body.message,
    'Your account still needs verification, but we could not send the verification email. Please try again later.'
  );
  assert.equal(res.body.otpPending, true);
  assert.equal(res.body.user.email, unverifiedUser.email);
  assert.equal(res.body.user.role, unverifiedUser.role);
  assert.equal(res.cookies.otpPending, undefined);
  assert.equal(res.authCookies, null);
  assert.equal(getSetAuthCookiesCalled(), false);
  assertNoOtpInBody(res.body);
  assertNoProviderLeakInBody(res.body);
});

test('auth OTP rate limits remain unchanged in userRoutes', () => {
  const source = fs.readFileSync(userRoutesPath, 'utf8');
  assert.match(source, /const registerLimiter = buildAuthLimiter\(\s*5,/);
  assert.match(source, /const otpResendLimiter = buildAuthLimiter\(\s*5,/);
  assert.match(source, /const loginLimiter = buildAuthLimiter\(\s*15,/);
  assert.match(source, /skip: \(\) => process\.env\.NODE_ENV === 'test'/);
});
