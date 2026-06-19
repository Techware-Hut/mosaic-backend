const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const userControllerPath = path.resolve(__dirname, '../../controllers/userController.js');

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
  const res = {
    statusCode: null,
    body: null,
    authCookies: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    cookie() {},
  };
  return res;
}

const verifiedVendor = {
  _id: '507f1f77bcf86cd799439011',
  email: 'vendor-login@example.com',
  name: 'Vendor Login',
  role: 'business_owner',
  gender: 'other',
  mobile: '+15551234567',
  passwordHash: 'hashed-password',
  isOtpVerified: true,
  isDeleted: false,
  isBlocked: false,
  sessionVersion: 0,
};

function baseMocks(overrides = {}) {
  let setAuthCookiesCalled = false;

  const cookieHelper = {
    getCookieOptions: () => ({}),
    clearCookie: () => {},
    setAuthCookies: (res, token, user, maxAge) => {
      setAuthCookiesCalled = true;
      res.authCookies = { token, userId: user._id.toString(), maxAge };
    },
    clearAuthCookies: () => {},
    ...(overrides.cookieHelper || {}),
  };

  return {
    mocks: {
      '../models/User': {
        findOne: async () => verifiedVendor,
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
      },
      '../utils/cookieHelper': cookieHelper,
      jsonwebtoken: {
        sign: () => 'vendor-session-jwt',
      },
      ...overrides.extra,
    },
    cookieHelper,
    getSetAuthCookiesCalled: () => setAuthCookiesCalled,
  };
}

test('loginUser returns 200 and sets auth cookies for verified business_owner', async () => {
  const { mocks } = baseMocks();
  const userController = withMocks(userControllerPath, mocks);
  const res = createResponse();

  await userController.loginUser(
    { body: { email: verifiedVendor.email, password: 'secret12' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.role, 'business_owner');
  assert.equal(res.body.user.isOtpVerified, true);
  assert.equal(res.authCookies.token, 'vendor-session-jwt');
  assert.equal(res.body.token, 'vendor-session-jwt');
});

test('loginUser returns 403 otpPending when vendor is not OTP verified', async () => {
  const { mocks } = baseMocks({
    User: {
      findOne: async () => ({
        ...verifiedVendor,
        isOtpVerified: false,
        save: async function save() {
          return this;
        },
      }),
    },
  });
  const userController = withMocks(userControllerPath, mocks);
  const res = createResponse();

  await userController.loginUser(
    { body: { email: verifiedVendor.email, password: 'secret12' } },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.otpPending, true);
  assert.equal(res.body.user.role, 'business_owner');
  assert.equal(res.authCookies, null);
});

test('loginUser returns 403 when vendor account is blocked', async () => {
  const { mocks } = baseMocks({
    User: {
      findOne: async () => ({ ...verifiedVendor, isBlocked: true }),
    },
  });
  const userController = withMocks(userControllerPath, mocks);
  const res = createResponse();

  await userController.loginUser(
    { body: { email: verifiedVendor.email, password: 'secret12' } },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /blocked/i);
});

test('loginUser returns 403 when vendor account is deleted', async () => {
  const { mocks } = baseMocks({
    User: {
      findOne: async () => ({ ...verifiedVendor, isDeleted: true }),
    },
  });
  const userController = withMocks(userControllerPath, mocks);
  const res = createResponse();

  await userController.loginUser(
    { body: { email: verifiedVendor.email, password: 'secret12' } },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /deleted/i);
});

test('loginUser uses same session token shape as customer (sub claim via jwt.sign payload)', async () => {
  let signedPayload = null;
  const { mocks } = baseMocks({
    extra: {
      jsonwebtoken: {
        sign: (payload) => {
          signedPayload = payload;
          return 'signed-token';
        },
      },
    },
  });
  const userController = withMocks(userControllerPath, mocks);
  const res = createResponse();

  await userController.loginUser(
    { body: { email: verifiedVendor.email, password: 'secret12' } },
    res
  );

  assert.equal(signedPayload.sub, verifiedVendor._id);
  assert.equal(signedPayload.role, 'business_owner');
  assert.equal(signedPayload.sessionVersion, 0);
});
