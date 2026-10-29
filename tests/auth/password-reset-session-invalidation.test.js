const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const userControllerPath = path.resolve(__dirname, '../../controllers/userController.js');
const authenticatePath = path.resolve(__dirname, '../../middlewares/authenticate.js');

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
    clearedCookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    clearCookie(name) {
      this.clearedCookies.push(name);
      return this;
    },
  };
}

test('resetPassword increments sessionVersion so older JWT sessions can be invalidated', async () => {
  const user = {
    _id: 'user-1',
    email: 'vendor@example.com',
    role: 'customer',
    resetPasswordOtp: 'hashed-reset-otp',
    resetPasswordOtpExpiry: new Date(Date.now() + 60_000),
    passwordHash: 'old-hash',
    sessionVersion: 0,
    isDeleted: false,
    isBlocked: false,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };

  const userController = withMocks(userControllerPath, {
    '../models/User': {
      findOne: async ({ email }) => (email === user.email ? user : null),
    },
    bcryptjs: {
      compare: async (plain, hashed) => plain === '654321' && hashed === user.resetPasswordOtp,
      hash: async (value) => `hashed:${value}`,
    },
    'express-validator': {
      validationResult: () => ({ isEmpty: () => true, array: () => [] }),
    },
    '../utils/mailer': {
      sendOtpEmail: async () => {},
      sendWelcomeEmail: async () => {},
      sendPasswordResetOtpEmail: async () => {},
    },
    '../utils/cookieHelper': {
      getCookieOptions: () => ({}),
      clearCookie: () => {},
      setAuthCookies: () => {},
      clearAuthCookies: () => {},
    },
  });

  const req = {
    body: {
      email: 'vendor@example.com',
      otp: '654321',
      newPassword: 'NewPass123!',
    },
  };
  const res = createResponse();

  await userController.resetPassword(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(user.passwordHash, 'hashed:NewPass123!');
  assert.equal(user.sessionVersion, 1);
  assert.equal(user.resetPasswordOtp, undefined);
  assert.equal(user.resetPasswordOtpExpiry, undefined);
  assert.equal(user.saveCalls, 1);
});

test('authenticate rejects JWTs created before a password reset bumps sessionVersion', async () => {
  const oldToken = jwt.sign(
    { userId: 'user-2', role: 'customer', sessionVersion: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const authenticate = withMocks(authenticatePath, {
    '../models/User': {
      findById: async () => ({
        _id: 'user-2',
        role: 'customer',
        sessionVersion: 1,
      }),
    },
    '../utils/cookieHelper': {
      clearAuthCookies: (res) => {
        res.clearCookie('token');
        res.clearCookie('user_session');
        res.clearCookie('user_gender');
      },
    },
  });

  const req = {
    headers: {},
    cookies: { token: oldToken },
  };
  const res = createResponse();
  let calledNext = false;

  await authenticate(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Session expired. Please log in again.');
  assert.deepEqual(res.clearedCookies, ['token', 'user_session', 'user_gender']);
});

test('authenticate accepts JWTs whose sessionVersion matches the user record', async () => {
  const currentToken = jwt.sign(
    { userId: 'user-3', role: 'customer', sessionVersion: 2 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  const user = {
    _id: 'user-3',
    role: 'customer',
    sessionVersion: 2,
  };

  const authenticate = withMocks(authenticatePath, {
    '../models/User': {
      findById: async () => user,
    },
    '../utils/cookieHelper': {
      clearAuthCookies: () => {},
    },
  });

  const req = {
    headers: {
      authorization: `Bearer ${currentToken}`,
    },
    cookies: {},
  };
  const res = createResponse();
  let calledNext = false;

  await authenticate(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(req.user, user);
  assert.equal(res.statusCode, null);
});

test('STG-005 scoped credentials retain DB-derived role and password-reset session invalidation', async () => {
  const values = {
    AUTH_SESSION_POLICY: 'staging-v1', RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com', COOKIE_DOMAIN: '.mosaicbizhub.com',
    COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none', TEMP_COOKIE_NAME: undefined,
    JWT_SECRET: 'synthetic-stg005-reset-key',
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const cookiePath = path.resolve(__dirname, '../../utils/cookieHelper.js');
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[cookiePath];
    const cookieHelper = require(cookiePath);
    const user = {
      _id: '507f1f77bcf86cd799439012', email: 'reset-stg005@example.test', role: 'customer',
      resetPasswordOtp: 'synthetic-reset-hash', resetPasswordOtpExpiry: new Date(Date.now() + 60000),
      passwordHash: 'old-synthetic-hash', sessionVersion: 0, isDeleted: false, isBlocked: false,
      async save() {},
    };
    const token = jwt.sign({ sub: user._id, role: 'admin', sessionVersion: 0, token_use: 'session' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api', expiresIn: '7d',
    });
    const authenticate = withMocks(authenticatePath, {
      '../models/User': { findById: async () => user },
      '../utils/cookieHelper': cookieHelper,
    });
    const request = () => ({ headers: { authorization: `Bearer ${token}` }, cookies: {} });
    const accepted = request();
    let nextCalls = 0;
    await authenticate(accepted, createResponse(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(accepted.user, user);
    assert.equal(accepted.user.role, 'customer');

    const controller = withMocks(userControllerPath, {
      '../models/User': { findOne: async () => user },
      '../utils/cookieHelper': cookieHelper,
      '../utils/mailer': { sendOtpEmail: async () => {}, sendWelcomeEmail: async () => {}, sendPasswordResetOtpEmail: async () => {} },
      '../utils/telnyxService': { sendOtpSMS: async () => {}, sendCustomerWelcomeSMS: async () => {} },
      bcryptjs: { compare: async () => true, hash: async () => 'new-synthetic-hash' },
      'express-validator': { validationResult: () => ({ isEmpty: () => true, array: () => [] }) },
    });
    const resetResponse = createResponse();
    await controller.resetPassword({ body: { email: user.email, otp: '654321', newPassword: 'SyntheticPass123!' } }, resetResponse);
    assert.equal(resetResponse.statusCode, 200);
    assert.equal(user.sessionVersion, 1);
    const rejected = createResponse();
    await authenticate(request(), rejected, () => { nextCalls += 1; });
    assert.equal(rejected.statusCode, 401);
    assert.equal(nextCalls, 1);
    assert.deepEqual(rejected.clearedCookies, []);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[userControllerPath];
    delete require.cache[authenticatePath];
    delete require.cache[cookiePath];
  }
});
