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

async function withStagingLoginEnv(overrides, fn) {
  const values = {
    AUTH_SESSION_POLICY: 'staging-v1',
    RELEASE_ENVIRONMENT: 'staging',
    SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com',
    COOKIE_DOMAIN: '.mosaicbizhub.com',
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'none',
    JWT_SECRET: 'synthetic-stg005-controller-key',
    TEMP_COOKIE_NAME: undefined,
    ...overrides,
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const cookiePath = path.resolve(__dirname, '../../utils/cookieHelper.js');
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[cookiePath];
    await fn(require(cookiePath));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[userControllerPath];
    delete require.cache[cookiePath];
  }
}

test('STG-005 opt-in password login mints a real scoped JWT and namespaced cookie family', async () => {
  await withStagingLoginEnv({}, async (cookieHelper) => {
    const realJwt = require('jsonwebtoken');
    const { mocks } = baseMocks({ extra: {
      jsonwebtoken: realJwt,
      '../utils/cookieHelper': cookieHelper,
      '../utils/telnyxService': { sendOtpSMS: async () => {}, sendCustomerWelcomeSMS: async () => {} },
    } });
    const controller = withMocks(userControllerPath, mocks);
    const res = createResponse();
    const issued = [];
    res.cookie = (name, value, options) => { issued.push({ name, value, options }); return res; };
    await controller.loginUser({ body: { email: verifiedVendor.email, password: 'synthetic-password' } }, res);
    assert.equal(res.statusCode, 200);
    const payload = realJwt.verify(res.body.token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api',
    });
    assert.equal(payload.sub, verifiedVendor._id);
    assert.equal(payload.token_use, 'session');
    assert.equal(payload.sessionVersion, verifiedVendor.sessionVersion);
    assert.equal(payload.exp - payload.iat, 604800);
    assert.deepEqual(issued.map((cookie) => cookie.name), ['mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender']);
    assert.equal(issued[0].value, res.body.token);
    assert.equal(issued[0].options.httpOnly, true);
    assert.equal(issued[0].options.maxAge, 604800000);
    assert.equal(res.body.user.role, 'business_owner');
  });
});

test('STG-005 invalid explicit policy rejects login before DB or provider work', async () => {
  await withStagingLoginEnv({ COOKIE_SECURE: 'false' }, async (cookieHelper) => {
    let effects = 0;
    const { mocks } = baseMocks({ User: { findOne: async () => { effects += 1; return verifiedVendor; } }, extra: {
      '../utils/cookieHelper': cookieHelper,
      '../utils/telnyxService': { sendOtpSMS: async () => { effects += 1; }, sendCustomerWelcomeSMS: async () => { effects += 1; } },
    } });
    const controller = withMocks(userControllerPath, mocks);
    const res = createResponse();
    res.cookie = () => { effects += 1; };
    await controller.loginUser({ body: { email: verifiedVendor.email, password: 'synthetic-password' } }, res);
    assert.ok(res.statusCode >= 400);
    assert.equal(effects, 0);
  });
});

test('STG-005 logout clears five owned names without changing legacy logout or revoking tokens', async () => {
  for (const selector of ['legacy', 'staging-v1']) {
    await withStagingLoginEnv({ AUTH_SESSION_POLICY: selector }, async (cookieHelper) => {
      const { mocks } = baseMocks({ extra: { '../utils/cookieHelper': cookieHelper } });
      const controller = withMocks(userControllerPath, mocks);
      const res = createResponse();
      const cleared = [];
      res.clearCookie = (name, options) => { cleared.push({ name, options }); return res; };
      await controller.logout({}, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: 'Logged out successfully' });
      assert.deepEqual(cleared.map((cookie) => cookie.name), selector === 'legacy'
        ? ['token', 'user_session', 'user_gender', 'otpPending']
        : ['mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender', 'mbh_stg_otp_pending', 'mbh_stg_tmp']);
      assert.equal(verifiedVendor.sessionVersion, 0);
      assert.equal(cleared.every((cookie) => cookie.options.maxAge === 0), true);
    });
  }
});
