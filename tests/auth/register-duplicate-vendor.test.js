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

function baseMocks(overrides = {}) {
  return {
    '../models/User': {
      findOne: async () => null,
      ...(overrides.User || {}),
    },
    bcryptjs: {
      hash: async (value) => `hashed:${value}`,
      compare: async () => false,
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
    '../utils/cookieHelper': {
      getCookieOptions: () => ({}),
      clearCookie: () => {},
      setAuthCookies: () => {},
      clearAuthCookies: () => {},
    },
    jsonwebtoken: {
      sign: () => 'test-token',
    },
    ...overrides.extra,
  };
}

const registerBody = {
  name: 'Vendor Test',
  email: 'vendor-smoke@example.com',
  password: 'secret12',
  mobile: '+15551234567',
  role: 'business_owner',
};

test('registerUser returns EXISTING_CUSTOMER when customer re-registers as vendor', async () => {
  const userController = withMocks(userControllerPath, baseMocks({
    User: {
      findOne: async () => ({ role: 'customer', email: registerBody.email }),
    },
  }));

  const res = createResponse();
  await userController.registerUser({ body: registerBody }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'EXISTING_CUSTOMER');
  assert.match(res.body.message, /Log in/i);
});

test('registerUser returns EXISTING_VENDOR when business_owner re-registers', async () => {
  const userController = withMocks(userControllerPath, baseMocks({
    User: {
      findOne: async () => ({ role: 'business_owner', email: registerBody.email }),
    },
  }));

  const res = createResponse();
  await userController.registerUser({ body: registerBody }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'EXISTING_VENDOR');
  assert.match(res.body.message, /Log in/i);
});

test('registerUser returns USER_EXISTS for duplicate customer signup', async () => {
  const userController = withMocks(userControllerPath, baseMocks({
    User: {
      findOne: async () => ({ role: 'customer', email: registerBody.email }),
    },
  }));

  const res = createResponse();
  await userController.registerUser(
    { body: { ...registerBody, role: 'customer' } },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'USER_EXISTS');
});

test('registerUser returns DUPLICATE_KEY on Mongo E11000 race', async () => {
  class MockUser {
    constructor(data) {
      Object.assign(this, data);
    }

    async save() {
      const err = new Error('duplicate key');
      err.code = 11000;
      throw err;
    }
  }
  MockUser.findOne = async () => null;

  const userController = withMocks(userControllerPath, {
    '../models/User': MockUser,
    bcryptjs: {
      hash: async (value) => `hashed:${value}`,
      compare: async () => false,
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

  const res = createResponse();
  await userController.registerUser({ body: registerBody }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'DUPLICATE_KEY');
});

test('registerUser succeeds for fresh vendor email', async () => {
  class MockUser {
    constructor(data) {
      Object.assign(this, data);
      this._id = '507f1f77bcf86cd799439011';
    }

    async save() {
      return this;
    }
  }
  MockUser.findOne = async () => null;

  const userController = withMocks(userControllerPath, {
    '../models/User': MockUser,
    bcryptjs: {
      hash: async (value) => `hashed:${value}`,
      compare: async () => false,
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

  const res = createResponse();
  await userController.registerUser({ body: registerBody }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /OTP sent to email/i);
});

test('register route uses registerLimiter with max 5 per 15 minutes', () => {
  const source = fs.readFileSync(userRoutesPath, 'utf8');
  assert.match(source, /const registerLimiter = buildAuthLimiter\(\s*5,/);
  assert.match(source, /router\.post\(\s*['"]\/register['"],\s*registerLimiter,/);
});
