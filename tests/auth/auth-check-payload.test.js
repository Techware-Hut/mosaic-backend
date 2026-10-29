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
    changePassword() {},
    getNotificationPreferences() {},
    updateNotificationPreferences() {},
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
    locals: { authCheckSessionPolicy: 'legacy' },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.body.loggedIn, true);
  assert.equal(res.body.sessionPolicy, 'legacy');
  assert.deepEqual(Object.keys(res.body.user).sort(), EXPECTED_KEYS.sort());
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in res.body.user, false, `forbidden key in auth/check: ${key}`);
  }
});

// Exercise the actual route stack/guard. Only the downstream authentication
// boundary is stubbed here; integration tests below use the real middleware.
function loadAuthCheckStack(onAuthenticate) {
  const originalLoad = Module._load;
  const controllerMocks = new Proxy({}, { get: () => () => {} });
  try {
    Module._load = function loadRouteMocks(request, parent, isMain) {
      if (request === '../controllers/userController') return controllerMocks;
      if (request === '../middlewares/authenticate') return onAuthenticate;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[userRoutesPath];
    return require(userRoutesPath).stack.find((layer) => layer.route?.path === '/auth/check').route.stack;
  } finally {
    Module._load = originalLoad;
    delete require.cache[userRoutesPath];
  }
}

async function withAuthCheckPolicy(mode, fn, overrides = {}) {
  const values = {
    AUTH_SESSION_POLICY: mode, RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com', COOKIE_DOMAIN: '.mosaicbizhub.com',
    COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none', TEMP_COOKIE_NAME: undefined, ...overrides,
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function invokeAuthCheck({ query = '', headers = {}, rawHeaders, cookies = {} } = {}) {
  let authenticateCalls = 0;
  const stack = loadAuthCheckStack((req, _res, next) => {
    authenticateCalls += 1;
    req.user = { _id: '507f1f77bcf86cd799439011', role: 'business_owner', name: 'Synthetic Vendor', isOtpVerified: true };
    next();
  });
  const req = { originalUrl: `/api/users/auth/check${query}`, headers, rawHeaders, cookies };
  const res = {
    statusCode: 200, body: null, headers: {}, locals: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  for (const layer of stack) {
    let next = false;
    await layer.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['set-cookie'], undefined);
  return { res, authenticateCalls };
}

test('STG-005 auth-check default and explicit legacy preserve downstream authentication and public user shape', async () => {
  for (const mode of [undefined, 'legacy']) {
    await withAuthCheckPolicy(mode, async () => {
      for (const query of ['', '?sessionPolicy=legacy']) {
        const { res, authenticateCalls } = await invokeAuthCheck({ query, headers: { authorization: 'Basic legacy-ignored-value' } });
        assert.equal(res.statusCode, 200);
        assert.equal(authenticateCalls, 1);
        assert.equal(res.body.sessionPolicy, 'legacy');
        assert.equal(res.body.user.role, 'business_owner');
        assert.equal('sessionVersion' in res.body.user, false);
      }
    });
  }
});

for (const mode of ['legacy', 'staging-v1']) {
  for (const query of [
    '?sessionPolicy=', '?sessionPolicy=unknown', '?sessionPolicy=STAGING-V1',
    '?sessionPolicy=%20staging-v1', '?sessionPolicy=legacy&sessionPolicy=legacy',
    '?sessionPolicy=staging-v1&sessionPolicy=legacy', '?sessionPolicy[]=staging-v1',
    '?sessionPolicy[mode]=staging-v1', '?sessionPolicy.value=staging-v1',
    '?sessionPolicy=staging-v1&sessionPolicy[]=staging-v1',
  ]) {
    test(`STG-005 auth-check ${mode} rejects invalid/ambiguous reserved query ${query}`, async () => {
      await withAuthCheckPolicy(mode, async () => {
        const { res, authenticateCalls } = await invokeAuthCheck({ query });
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, 'AUTH_SESSION_POLICY_MISMATCH');
        assert.equal(authenticateCalls, 0, 'compatibility denial must precede JWT/DB authentication');
        assert.equal(res.body.user, undefined);
        assert.equal(res.body.sessionPolicy, undefined);
      });
    });
  }
}

test('STG-005 auth-check rejects either explicit policy mismatch before authentication', async () => {
  for (const [mode, requested] of [['legacy', 'staging-v1'], ['staging-v1', 'legacy']]) {
    await withAuthCheckPolicy(mode, async () => {
      const { res, authenticateCalls } = await invokeAuthCheck({ query: `?sessionPolicy=${requested}` });
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'AUTH_SESSION_POLICY_MISMATCH');
      assert.equal(authenticateCalls, 0);
    });
  }
});

test('STG-005 auth-check active selected cookie requires marker even alongside bearer', async () => {
  await withAuthCheckPolicy('staging-v1', async () => {
    for (const headers of [
      { cookie: 'mbh_stg_token=synthetic-cookie' },
      { cookie: 'mbh_stg_token=synthetic-cookie', authorization: 'Bearer synthetic-bearer' },
    ]) {
      const { res, authenticateCalls } = await invokeAuthCheck({ headers });
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'AUTH_SESSION_POLICY_MISMATCH');
      assert.equal(authenticateCalls, 0);
    }
  });
});

test('STG-005 auth-check matching active marker and unmarked no-selected-cookie clients still authenticate downstream', async () => {
  await withAuthCheckPolicy('staging-v1', async () => {
    for (const request of [
      { query: '?sessionPolicy=staging-v1', headers: { cookie: 'mbh_stg_token=synthetic-cookie' } },
      { headers: { authorization: 'Bearer synthetic-bearer' } },
      { headers: { cookie: 'token=legacy-cookie' } },
      {},
    ]) {
      const { res, authenticateCalls } = await invokeAuthCheck(request);
      assert.equal(authenticateCalls, 1, 'guard must not substitute for real authentication');
      assert.equal(res.body.sessionPolicy, 'staging-v1');
    }
  });
});

test('STG-005 auth-check active raw credential ambiguity wins before compatibility and never clears cookies', async () => {
  await withAuthCheckPolicy('staging-v1', async () => {
    for (const request of [
      { headers: { cookie: 'mbh_stg_token=a; mbh_stg_token=a' } },
      { headers: { cookie: 'mbh_stg_token=b; mbh_stg_token=a' } },
      { headers: { cookie: 'mbh_stg_token=%ZZ' } },
      { headers: { authorization: '' } },
      { headers: { authorization: 'Basic synthetic' } },
      { headers: { authorization: 'Bearer a, Bearer b' } },
      { headers: { authorization: 'Bearer a' }, rawHeaders: ['Authorization', 'Bearer a', 'Authorization', 'Bearer a'] },
    ]) {
      const { res, authenticateCalls } = await invokeAuthCheck({ query: '?sessionPolicy=unknown', ...request });
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'AUTH_CREDENTIAL_CONFLICT');
      assert.equal(authenticateCalls, 0);
    }
  });
});

test('STG-005 auth-check configuration failure is safe, non-destructive and precedes authentication', async () => {
  await withAuthCheckPolicy('staging-v1', async () => {
    const { res, authenticateCalls } = await invokeAuthCheck({ query: '?sessionPolicy=staging-v1' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'INVALID_AUTH_SESSION_POLICY');
    assert.equal(authenticateCalls, 0);
    assert.equal(JSON.stringify(res.body).includes('synthetic-password'), false);
  }, { API_BASE_URL: 'https://synthetic-user:synthetic-password@api-staging.mosaicbizhub.com' });
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

test('STG-005 OTP issuance uses scoped real JWT/cookies while public user response remains unchanged', async () => {
  const values = {
    AUTH_SESSION_POLICY: 'staging-v1', RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com', COOKIE_DOMAIN: '.mosaicbizhub.com',
    COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none', TEMP_COOKIE_NAME: undefined,
    JWT_SECRET: 'synthetic-stg005-otp-key',
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const cookiePath = path.resolve(__dirname, '../../utils/cookieHelper.js');
  const originalLoad = Module._load;
  const user = {
    _id: '507f1f77bcf86cd799439011', email: 'otp-stg005@example.test', name: 'Synthetic OTP',
    mobile: '+15551234567', role: 'business_owner', gender: 'other', isOtpVerified: false,
    otp: 'synthetic-otp-hash', otpExpiry: new Date(Date.now() + 60000), sessionVersion: 4,
    isBlocked: false, isDeleted: false, async save() {},
  };
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[cookiePath];
    const actualCookieHelper = require(cookiePath);
    Module._load = function loadOtpMocks(request, parent, isMain) {
      if (request === '../models/User') return { findOne: async () => user };
      if (request === '../utils/cookieHelper') return actualCookieHelper;
      if (request === '../utils/mailer') return { sendOtpEmail: async () => {}, sendWelcomeEmail: async () => {}, sendPasswordResetOtpEmail: async () => {} };
      if (request === '../utils/telnyxService') return { sendOtpSMS: async () => {}, sendCustomerWelcomeSMS: async () => {} };
      if (request === 'bcryptjs') return { compare: async () => true, hash: async (value) => value };
      if (request === 'express-validator') return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[userControllerPath];
    const controller = require(userControllerPath);
    Module._load = originalLoad;
    const issued = [];
    const cleared = [];
    const res = {
      statusCode: null, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      cookie(name, value, options) { issued.push({ name, value, options }); return this; },
      clearCookie(name, options) { cleared.push({ name, options }); return this; },
    };
    await controller.verifyOtp({ body: { email: user.email, otp: '123456' } }, res);
    assert.equal(res.statusCode, 200);
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api',
    });
    assert.equal(payload.sub, user._id);
    assert.equal(payload.sessionVersion, 4);
    assert.equal(payload.token_use, 'session');
    assert.equal(payload.exp - payload.iat, 604800);
    assert.deepEqual(issued.map((cookie) => cookie.name), ['mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender']);
    assert.deepEqual(cleared.map((cookie) => cookie.name), ['mbh_stg_otp_pending']);
    assert.deepEqual(Object.keys(res.body.user).sort(), EXPECTED_KEYS.sort());
    for (const key of [...FORBIDDEN_KEYS, 'iss', 'aud', 'token_use', 'exp', 'iat']) {
      assert.equal(key in res.body.user, false, `public user leaked internal field: ${key}`);
    }
  } finally {
    Module._load = originalLoad;
    delete require.cache[userControllerPath];
    delete require.cache[cookiePath];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
