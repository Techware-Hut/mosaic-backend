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
