const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const toAdminUserPath = path.resolve(__dirname, '../../utils/toAdminUser.js');
const userControllerPath = path.resolve(
  __dirname,
  '../../controllers/admin/user.controller.js'
);
const isAdminPath = path.resolve(__dirname, '../../middlewares/isAdmin.js');

const FORBIDDEN_KEYS = [
  'passwordHash',
  'password',
  'otp',
  'otpExpiry',
  'resetPasswordOtp',
  'resetPasswordOtpExpiry',
  'resetPasswordOtpAttempts',
  'resetPasswordToken',
  'resetPasswordExpires',
  'providerId',
  'sessionVersion',
  '__v',
];

const EXPECTED_KEYS = [
  '_id',
  'name',
  'email',
  'role',
  'gender',
  'mobile',
  'provider',
  'isOtpVerified',
  'isBlocked',
  'isDeleted',
  'createdAt',
  'updatedAt',
];

test('toAdminUser returns only safe admin display fields', () => {
  const toAdminUser = require(toAdminUserPath);
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    gender: 'female',
    mobile: '+15559876543',
    provider: 'local',
    isOtpVerified: true,
    isBlocked: false,
    isDeleted: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-06-01'),
    passwordHash: 'secret-hash',
    otp: 'otp-hash',
    otpExpiry: new Date(),
    resetPasswordOtp: 'reset-hash',
    resetPasswordOtpExpiry: new Date(),
    resetPasswordOtpAttempts: 2,
    providerId: 'google-sub-123',
    sessionVersion: 4,
    __v: 0,
  };

  const result = toAdminUser(mockUser);

  assert.deepEqual(Object.keys(result).sort(), EXPECTED_KEYS.sort());
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in result, false, `forbidden key leaked: ${key}`);
  }
  assert.equal(result.provider, 'local');
  assert.equal(result.providerId, undefined);
});

test('getAllUsers maps each user through toAdminUser', async () => {
  const mockUsers = [
    {
      _id: '507f1f77bcf86cd799439011',
      name: 'Customer',
      email: 'customer@example.com',
      role: 'customer',
      gender: 'other',
      mobile: '+1',
      provider: 'local',
      isOtpVerified: true,
      isBlocked: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'hash',
      otp: 'otp-hash',
      sessionVersion: 1,
    },
    {
      _id: '507f1f77bcf86cd799439012',
      name: 'Vendor',
      email: 'vendor@example.com',
      role: 'business_owner',
      gender: 'male',
      mobile: '+2',
      provider: 'google',
      isOtpVerified: true,
      isBlocked: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      providerId: 'google-id',
      resetPasswordOtp: 'reset',
    },
  ];

  const User = {
    find: () => Promise.resolve(mockUsers),
    countDocuments: async () => 1,
  };

  const controller = (() => {
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === '../../models/User') return User;
      if (request === '../../utils/toAdminUser') return require(toAdminUserPath);
      if (request === 'bcryptjs') return { hash: async () => 'hash' };
      if (request === 'express-validator') {
        return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[userControllerPath];
    const loaded = require(userControllerPath);
    Module._load = originalLoad;
    return loaded;
  })();

  const res = {
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

  await controller.getAllUsers({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 2);
  for (const user of res.body.data) {
    assert.deepEqual(Object.keys(user).sort(), EXPECTED_KEYS.sort());
    for (const key of FORBIDDEN_KEYS) {
      assert.equal(key in user, false, `forbidden key in list response: ${key}`);
    }
  }
});

test('isAdmin blocks non-admin users from admin routes', () => {
  const isAdmin = require(isAdminPath);
  const req = { user: { role: 'customer' } };
  const res = {
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
  let calledNext = false;

  isAdmin(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Access denied: Admin only');
});
