const test = require('node:test');
const assert = require('node:assert/strict');
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

function assertNoOtpOrProviderLeakInBody(body) {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /\b\d{6}\b/);
  assert.doesNotMatch(serialized, /EAUTH|535|api[_-]?key|smtp-password|credential/i);
}

test('forgotPassword returns a generic success response for unknown emails', async () => {
  const userController = withMocks(userControllerPath, {
    '../models/User': {
      findOne: async () => null,
    },
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
  await userController.forgotPassword({ body: { email: 'missing@example.com' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    message: 'If an account with that email exists, a password reset OTP will be sent.',
  });
});

test('forgotPassword returns a generic safe response when reset OTP email fails', async () => {
  const user = {
    email: 'vendor@example.com',
    passwordHash: 'hashed-password',
    isDeleted: false,
    isBlocked: false,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };

  const userController = withMocks(userControllerPath, {
    '../models/User': {
      findOne: async () => user,
    },
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
      sendPasswordResetOtpEmail: async () => {
        const err = new Error('EAUTH 535 smtp-password rejected');
        err.code = 'EAUTH';
        throw err;
      },
    },
    '../utils/cookieHelper': {
      getCookieOptions: () => ({}),
      clearCookie: () => {},
      setAuthCookies: () => {},
      clearAuthCookies: () => {},
    },
  });

  const res = createResponse();
  await userController.forgotPassword({ body: { email: user.email } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    message: 'If an account with that email exists, a password reset OTP will be sent.',
  });
  assert.equal(user.saveCalls, 1);
  assertNoOtpOrProviderLeakInBody(res.body);
});

test('resetPassword invalidates the reset OTP after the maximum failed attempts', async () => {
  const user = {
    email: 'vendor@example.com',
    resetPasswordOtp: 'hashed-otp',
    resetPasswordOtpExpiry: new Date(Date.now() + 60_000),
    resetPasswordOtpAttempts: 4,
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
      findOne: async () => user,
    },
    bcryptjs: {
      compare: async () => false,
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

  const res = createResponse();
  await userController.resetPassword({
    body: {
      email: user.email,
      otp: '000000',
      newPassword: 'NewPass123!',
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid or expired reset request');
  assert.equal(user.resetPasswordOtp, undefined);
  assert.equal(user.resetPasswordOtpExpiry, undefined);
  assert.equal(user.resetPasswordOtpAttempts, 0);
  assert.equal(user.saveCalls, 1);
});

test('resetPassword clears expired OTP state before rejecting the request', async () => {
  const user = {
    email: 'vendor@example.com',
    resetPasswordOtp: 'hashed-otp',
    resetPasswordOtpExpiry: new Date(Date.now() - 60_000),
    resetPasswordOtpAttempts: 3,
    isDeleted: false,
    isBlocked: false,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };

  const userController = withMocks(userControllerPath, {
    '../models/User': {
      findOne: async () => user,
    },
    bcryptjs: {
      compare: async () => true,
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

  const res = createResponse();
  await userController.resetPassword({
    body: {
      email: user.email,
      otp: '123456',
      newPassword: 'NewPass123!',
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Reset OTP has expired');
  assert.equal(user.resetPasswordOtp, undefined);
  assert.equal(user.resetPasswordOtpExpiry, undefined);
  assert.equal(user.resetPasswordOtpAttempts, 0);
  assert.equal(user.saveCalls, 1);
});

test('userRoutes applies rate limiting before forgot and reset password handlers', async () => {
  const controllerMocks = {
    registerUser() {},
    loginUser() {},
    logout() {},
    verifyOtp() {},
    resendOtp() {},
    forgotPassword() {},
    resetPassword() {},
  };

  const router = withMocks(userRoutesPath, {
    '../controllers/userController': controllerMocks,
    '../middlewares/authenticate': (_req, _res, next) => next(),
  });

  const forgotRoute = router.stack.find((layer) => layer.route?.path === '/forgot-password');
  const resetRoute = router.stack.find((layer) => layer.route?.path === '/reset-password');

  assert.equal(forgotRoute.route.stack.at(-1).handle, controllerMocks.forgotPassword);
  assert.notEqual(forgotRoute.route.stack[0].handle, controllerMocks.forgotPassword);

  assert.equal(resetRoute.route.stack.at(-1).handle, controllerMocks.resetPassword);
  assert.notEqual(resetRoute.route.stack[0].handle, controllerMocks.resetPassword);
});
