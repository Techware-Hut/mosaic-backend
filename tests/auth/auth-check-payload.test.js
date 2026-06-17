const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const toPublicAuthUserPath = path.resolve(__dirname, '../../utils/toPublicAuthUser.js');
const userRoutesPath = path.resolve(__dirname, '../../routes/userRoutes.js');
const userControllerPath = path.resolve(__dirname, '../../controllers/userController.js');

const FORBIDDEN_KEYS = [
  'passwordHash',
  'password',
  'otp',
  'otpExpiry',
  'resetPasswordOtp',
  'resetPasswordOtpExpiry',
  'resetPasswordOtpAttempts',
  'resetPasswordExpires',
  'resetPasswordToken',
  'sessionVersion',
  'providerId',
  'provider',
  '__v',
];

const EXPECTED_KEYS = [
  'id',
  'name',
  'email',
  'role',
  'gender',
  'mobile',
  'isOtpVerified',
];

test('toPublicAuthUser returns only safe canonical fields', () => {
  const toPublicAuthUser = require(toPublicAuthUserPath);
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test User',
    email: 'test@example.com',
    role: 'customer',
    gender: 'other',
    mobile: '+15551234567',
    isOtpVerified: true,
    passwordHash: 'secret-hash',
    otp: 'otp-hash',
    resetPasswordOtp: 'reset-hash',
    sessionVersion: 3,
    providerId: 'google-123',
    __v: 0,
  };

  const result = toPublicAuthUser(mockUser);
  const keys = Object.keys(result);

  assert.deepEqual(keys.sort(), EXPECTED_KEYS.sort());
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in result, false, `forbidden key leaked: ${key}`);
  }
  assert.equal(result.isOtpVerified, true);
});

test('GET /auth/check response uses toPublicAuthUser whitelist', async () => {
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    gender: 'female',
    mobile: '+15559876543',
    isOtpVerified: true,
    passwordHash: 'secret-hash',
    otp: 'otp-hash',
    sessionVersion: 1,
  };

  const controllerMocks = {
    registerUser() {},
    loginUser() {},
    logout() {},
    verifyOtp() {},
    resendOtp() {},
    forgotPassword() {},
    resetPassword() {},
  };

  const router = (() => {
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === '../controllers/userController') {
        return controllerMocks;
      }
      if (request === '../middlewares/authenticate') {
        return (req, _res, next) => {
          req.user = mockUser;
          next();
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[userRoutesPath];
    const loaded = require(userRoutesPath);
    Module._load = originalLoad;
    return loaded;
  })();

  const authCheckRoute = router.stack.find((layer) => layer.route?.path === '/auth/check');
  assert.ok(authCheckRoute);

  const handler = authCheckRoute.route.stack.at(-1).handle;
  const req = { user: mockUser };
  const res = {
    body: null,
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.body.loggedIn, true);
  assert.deepEqual(Object.keys(res.body.user).sort(), EXPECTED_KEYS.sort());
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in res.body.user, false, `forbidden key in auth/check: ${key}`);
  }
});

test('buildSessionToken uses sub claim for session JWT', () => {
  const userController = (() => {
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === '../models/User') return {};
      if (request === '../utils/mailer') return { sendOtpEmail: async () => {}, sendWelcomeEmail: async () => {}, sendPasswordResetOtpEmail: async () => {} };
      if (request === '../utils/cookieHelper') return { getCookieOptions: () => ({}), clearCookie: () => {}, setAuthCookies: () => {}, clearAuthCookies: () => {} };
      if (request === '../utils/toPublicAuthUser') return require(toPublicAuthUserPath);
      if (request === 'express-validator') return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
      if (request === 'bcryptjs') return { hash: async (v) => v, compare: async () => true };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[userControllerPath];
    const loaded = require(userControllerPath);
    Module._load = originalLoad;
    return loaded;
  })();

  // Exercise verifyOtp success path to obtain a token from buildSessionToken
  const user = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    email: 'vendor@example.com',
    name: 'Vendor',
    mobile: '+1',
    role: 'business_owner',
    gender: 'other',
    isOtpVerified: false,
    otp: 'hashed',
    otpExpiry: new Date(Date.now() + 60_000),
    sessionVersion: 0,
    isDeleted: false,
    isBlocked: false,
    async save() {},
  };

  return (async () => {
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === '../models/User') {
        return { findOne: async () => user };
      }
      if (request === '../utils/mailer') {
        return { sendOtpEmail: async () => {}, sendWelcomeEmail: async () => {}, sendPasswordResetOtpEmail: async () => {} };
      }
      if (request === '../utils/cookieHelper') {
        return { getCookieOptions: () => ({}), clearCookie: () => {}, setAuthCookies: () => {}, clearAuthCookies: () => {} };
      }
      if (request === '../utils/toPublicAuthUser') return require(toPublicAuthUserPath);
      if (request === 'express-validator') return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
      if (request === 'bcryptjs') return { hash: async (v) => v, compare: async () => true };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[userControllerPath];
    const controller = require(userControllerPath);
    Module._load = originalLoad;

    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
      cookie() { return this; },
    };

    await controller.verifyOtp({ body: { email: user.email, otp: '123456' } }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.token);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.equal(decoded.sub, '507f1f77bcf86cd799439011');
    assert.equal(decoded.userId, undefined);
    assert.equal(decoded.role, 'business_owner');
    assert.equal(decoded.sessionVersion, 0);
  })();
});
