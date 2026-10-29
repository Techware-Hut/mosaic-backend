const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const Module = require('node:module');

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'google-client-secret';
process.env.API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.REQUIRE_PROFILE_COMPLETION = 'true';
process.env.TEMP_COOKIE_TTL_SEC = '900';

const authControllerPath = path.resolve(__dirname, '../../controllers/authController.js');
const authRoutesPath = path.resolve(__dirname, '../../routes/authRoutes.js');
const AUTH_ENV_KEYS = [
  'NODE_ENV',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'API_BASE_URL',
  'FRONTEND_URL',
  'JWT_SECRET',
  'REQUIRE_PROFILE_COMPLETION',
  'TEMP_COOKIE_TTL_SEC',
];

function snapshotEnv(keys) {
  const saved = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function withTemporaryEnv(overrides, fn) {
  const saved = snapshotEnv(AUTH_ENV_KEYS);
  Object.assign(process.env, overrides);

  return Promise.resolve()
    .then(fn)
    .finally(() => restoreEnv(saved));
}

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
    redirectUrl: null,
    statusCode: null,
    body: null,
    redirect(url) {
      this.redirectUrl = url;
      return this;
    },
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

test('Google OAuth profile-completion cookie maxAge matches the temporary JWT lifetime', async () => {
  const capturedCookies = [];
  const fakeUser = {
    _id: { toString: () => 'user-1' },
    email: 'google@example.com',
    role: 'customer',
    mobile: '',
    minorityType: '',
    isBlocked: false,
    isDeleted: false,
    async save() {},
  };

  const authController = withMocks(authControllerPath, {
    'google-auth-library': {
      OAuth2Client: class {
        generateAuthUrl() {
          return 'https://accounts.google.com/mock-auth';
        }
        async getToken() {
          return { tokens: { id_token: 'google-id-token' } };
        }
        async verifyIdToken() {
          return {
            getPayload() {
              return {
                sub: 'google-sub',
                email: 'google@example.com',
                name: 'Google User',
                picture: 'https://example.com/pic.png',
              };
            },
          };
        }
      },
    },
    '../models/User': {
      findOne: async () => fakeUser,
    },
    '../utils/cookieHelper': {
      setCookie: (_res, name, value, options) => {
        capturedCookies.push({ name, value, options });
      },
      clearCookie: () => {},
      setAuthCookies: () => {},
      clearAuthCookies: () => {},
    },
  });

  const req = {
    query: {
      code: 'mock-code',
      state: Buffer.from(JSON.stringify({ redirect: 'http://localhost:3000/app' })).toString('base64'),
    },
  };
  const res = createResponse();

  await authController.handleGoogleCallback(req, res);

  assert.equal(res.redirectUrl, 'http://localhost:3000/complete-profile');
  assert.equal(capturedCookies.length, 1);
  assert.equal(capturedCookies[0].name, 'mbh_tmp');
  assert.equal(capturedCookies[0].options.maxAge, 900000);

  const decoded = jwt.verify(capturedCookies[0].value, process.env.JWT_SECRET);
  assert.ok(decoded.exp - decoded.iat <= 900);
  assert.ok(decoded.exp - decoded.iat >= 899);
});

test('Google OAuth start rejects hostile redirect query origins in production state', async () => {
  await withTemporaryEnv(
    {
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      API_BASE_URL: 'https://api.mosaicbizhub.com',
      FRONTEND_URL: 'https://mosaicbizhub.com',
      JWT_SECRET: 'test-secret',
      REQUIRE_PROFILE_COMPLETION: 'false',
      TEMP_COOKIE_TTL_SEC: '900',
    },
    async () => {
      let capturedState = '';
      const authController = withMocks(authControllerPath, {
        'google-auth-library': {
          OAuth2Client: class {
            generateAuthUrl(options) {
              capturedState = options.state;
              return 'https://accounts.google.com/mock-auth';
            }
          },
        },
      });

      const req = {
        query: {
          redirect: 'https://evil.example/account',
        },
      };
      const res = createResponse();

      authController.startGoogleAuth(req, res);

      assert.equal(res.redirectUrl, 'https://accounts.google.com/mock-auth');
      const state = JSON.parse(Buffer.from(capturedState, 'base64').toString());
      assert.equal(state.redirect, 'https://mosaicbizhub.com/');
    }
  );
});

test('Google OAuth controller fails fast in production when URL env is missing', () => {
  const saved = snapshotEnv(AUTH_ENV_KEYS);

  try {
    process.env.NODE_ENV = 'production';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.API_BASE_URL;
    delete process.env.FRONTEND_URL;
    delete require.cache[authControllerPath];

    assert.throws(
      () => require(authControllerPath),
      /Missing env: GOOGLE_CLIENT_ID\/SECRET, API_BASE_URL, FRONTEND_URL, JWT_SECRET/
    );
  } finally {
    delete require.cache[authControllerPath];
    restoreEnv(saved);
  }
});

test('Google OAuth callback rejects tampered hostile state redirect origins', async () => {
  await withTemporaryEnv(
    {
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      API_BASE_URL: 'https://api.mosaicbizhub.com',
      FRONTEND_URL: 'https://mosaicbizhub.com',
      JWT_SECRET: 'test-secret',
      REQUIRE_PROFILE_COMPLETION: 'false',
      TEMP_COOKIE_TTL_SEC: '900',
    },
    async () => {
      const fakeUser = {
        _id: { toString: () => 'user-1' },
        email: 'google@example.com',
        role: 'customer',
        mobile: '5555555555',
        minorityType: 'Other',
        isBlocked: false,
        isDeleted: false,
        async save() {},
      };

      const authController = withMocks(authControllerPath, {
        'google-auth-library': {
          OAuth2Client: class {
            generateAuthUrl() {
              return 'https://accounts.google.com/mock-auth';
            }
            async getToken() {
              return { tokens: { id_token: 'google-id-token' } };
            }
            async verifyIdToken() {
              return {
                getPayload() {
                  return {
                    sub: 'google-sub',
                    email: 'google@example.com',
                    name: 'Google User',
                    picture: 'https://example.com/pic.png',
                  };
                },
              };
            }
          },
        },
        '../models/User': {
          findOne: async () => fakeUser,
        },
        '../utils/cookieHelper': {
          setCookie: () => {},
          clearCookie: () => {},
          setAuthCookies: () => {},
          clearAuthCookies: () => {},
        },
      });

      const req = {
        query: {
          code: 'mock-code',
          state: Buffer.from(JSON.stringify({ redirect: 'https://evil.example/account' })).toString('base64'),
        },
      };
      const res = createResponse();

      await authController.handleGoogleCallback(req, res);

      assert.equal(res.redirectUrl, 'https://mosaicbizhub.com/');
    }
  );
});

test('Google OAuth routes include rate limiting middleware before the controller handlers', async () => {
  const controllerMocks = {
    startGoogleAuth: function startGoogleAuth(_req, res) { res.end?.(); },
    handleGoogleCallback: function handleGoogleCallback(_req, res) { res.end?.(); },
    completeGoogleProfile: function completeGoogleProfile(_req, res) { res.end?.(); },
  };

  const router = withMocks(authRoutesPath, {
    '../controllers/authController': controllerMocks,
  });

  const googleRoute = router.stack.find((layer) => layer.route?.path === '/google');
  const callbackRoute = router.stack.find((layer) => layer.route?.path === '/google/callback');
  const completeRoute = router.stack.find((layer) => layer.route?.path === '/google/complete');

  assert.equal(googleRoute.route.stack.length, 2);
  assert.notEqual(googleRoute.route.stack[0].handle, controllerMocks.startGoogleAuth);
  assert.equal(googleRoute.route.stack[1].handle, controllerMocks.startGoogleAuth);

  assert.equal(callbackRoute.route.stack.length, 2);
  assert.notEqual(callbackRoute.route.stack[0].handle, controllerMocks.handleGoogleCallback);
  assert.equal(callbackRoute.route.stack[1].handle, controllerMocks.handleGoogleCallback);

  assert.equal(completeRoute.route.stack.length, 2);
  assert.notEqual(completeRoute.route.stack[0].handle, controllerMocks.completeGoogleProfile);
  assert.equal(completeRoute.route.stack[1].handle, controllerMocks.completeGoogleProfile);
});

async function withStagingOAuthEnv(overrides, fn) {
  const values = {
    NODE_ENV: 'production', AUTH_SESSION_POLICY: 'staging-v1',
    RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com',
    FRONTEND_URL: 'https://mosaic-biz-frontend-launch.vercel.app',
    COOKIE_DOMAIN: '.mosaicbizhub.com', COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none',
    TEMP_COOKIE_NAME: undefined, TEMP_COOKIE_TTL_SEC: '900', REQUIRE_PROFILE_COMPLETION: 'true',
    GOOGLE_CLIENT_ID: 'synthetic-stg005-client', GOOGLE_CLIENT_SECRET: 'synthetic-stg005-oauth-secret',
    JWT_SECRET: 'synthetic-stg005-oauth-signing-key', ...overrides,
  };
  const saved = snapshotEnv(Object.keys(values));
  const cookiePath = path.resolve(__dirname, '../../utils/cookieHelper.js');
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[cookiePath];
    await fn(require(cookiePath));
  } finally {
    delete require.cache[authControllerPath];
    delete require.cache[cookiePath];
    restoreEnv(saved);
  }
}

function stagingOAuthFixture(cookieHelper) {
  let profileLookups = 0;
  const user = {
    _id: '507f1f77bcf86cd799439011', email: 'google-stg005@example.test', name: 'Synthetic OAuth',
    role: 'customer', mobile: '', minorityType: '', gender: 'other', sessionVersion: 3,
    isOtpVerified: true, isDeleted: false, isBlocked: false, async save() {},
  };
  const controller = withMocks(authControllerPath, {
    'google-auth-library': { OAuth2Client: class {
      async getToken() { return { tokens: { id_token: 'synthetic-provider-token' } }; }
      async verifyIdToken() { return { getPayload: () => ({ sub: 'synthetic-provider-id', email: user.email, name: user.name }) }; }
    } },
    '../models/User': {
      findOne: async () => user,
      findById: async () => { profileLookups += 1; return user; },
    },
    '../utils/cookieHelper': cookieHelper,
  });
  const res = createResponse();
  res.issued = [];
  res.cleared = [];
  res.cookie = (name, value, options) => { res.issued.push({ name, value, options }); return res; };
  res.clearCookie = (name, options) => { res.cleared.push({ name, options }); return res; };
  const request = { query: {
    code: 'synthetic-code',
    state: Buffer.from(JSON.stringify({ redirect: process.env.FRONTEND_URL + '/partners' })).toString('base64'),
  } };
  return { user, controller, res, request, lookups: () => profileLookups };
}

test('STG-005 Google profile completion separates temporary and ordinary session credentials', async () => {
  await withStagingOAuthEnv({}, async (cookieHelper) => {
    const { controller, user, res, request, lookups } = stagingOAuthFixture(cookieHelper);
    await controller.handleGoogleCallback(request, res);
    assert.equal(res.issued.length, 1);
    const temporary = res.issued[0];
    assert.equal(temporary.name, 'mbh_stg_tmp');
    assert.equal(temporary.options.maxAge, 900000);
    const payload = jwt.verify(temporary.value, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-profile',
    });
    assert.equal(payload.token_use, 'profile_completion');
    assert.equal(payload.exp - payload.iat, 900);

    const ordinarySession = jwt.sign({ sub: user._id, role: user.role, sessionVersion: 3, token_use: 'session' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api', expiresIn: '7d',
    });
    const denied = createResponse();
    await controller.completeGoogleProfile({ cookies: { mbh_stg_tmp: ordinarySession }, body: { mobile: '+15551234567' } }, denied);
    assert.equal(denied.statusCode, 401);
    assert.equal(lookups(), 0);

    const complete = createResponse();
    complete.issued = [];
    complete.cleared = [];
    complete.cookie = (name, value, options) => { complete.issued.push({ name, value, options }); return complete; };
    complete.clearCookie = (name, options) => { complete.cleared.push({ name, options }); return complete; };
    await controller.completeGoogleProfile({ cookies: { mbh_stg_tmp: temporary.value }, body: { mobile: '+15551234567' } }, complete);
    assert.equal(complete.body.success, true);
    assert.equal(lookups(), 1);
    assert.deepEqual(complete.cleared.map((cookie) => cookie.name), ['mbh_stg_tmp']);
    assert.deepEqual(complete.issued.map((cookie) => cookie.name), ['mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender']);
    const session = jwt.verify(complete.issued[0].value, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api',
    });
    assert.equal(session.token_use, 'session');
    assert.equal(session.sessionVersion, 3);
    assert.equal(session.exp - session.iat, 604800);
  });
});

test('STG-005 direct Google login uses the same scoped seven-day session as password and OTP login', async () => {
  await withStagingOAuthEnv({ REQUIRE_PROFILE_COMPLETION: 'false' }, async (cookieHelper) => {
    const { controller, res, request } = stagingOAuthFixture(cookieHelper);
    await controller.handleGoogleCallback(request, res);
    assert.deepEqual(res.issued.map((cookie) => cookie.name), ['mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender']);
    assert.equal(res.redirectUrl, process.env.FRONTEND_URL + '/partners');
    const session = jwt.verify(res.issued[0].value, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api',
    });
    assert.equal(session.token_use, 'session');
    assert.equal(session.exp - session.iat, 604800);
    assert.equal(res.issued[0].options.maxAge, 604800000);
  });
});
