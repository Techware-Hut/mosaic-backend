const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildErrorPayload,
  sendForbidden,
  sendValidationError,
} = require('../utils/apiError');
const isAdmin = require('../middlewares/isAdmin');

function mockResponse() {
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

test('buildErrorPayload includes stable code, success flag, and requestId', () => {
  const payload = buildErrorPayload(
    { requestId: 'req-error-001' },
    {
      status: 403,
      message: 'Access denied',
      code: 'ADMIN_REQUIRED',
    }
  );

  assert.deepEqual(payload, {
    success: false,
    message: 'Access denied',
    code: 'ADMIN_REQUIRED',
    requestId: 'req-error-001',
  });
});

test('sendValidationError normalizes field errors without leaking raw request values', () => {
  const res = mockResponse();

  sendValidationError(
    { requestId: 'req-validation-001' },
    res,
    {
      email: 'Email is required',
      password: 'Password is too short',
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'VALIDATION_FAILED');
  assert.equal(res.body.message, 'Validation failed');
  assert.equal(res.body.error, 'Validation failed');
  assert.deepEqual(res.body.fieldErrors, {
    email: 'Email is required',
    password: 'Password is too short',
  });
  assert.equal(res.body.requestId, 'req-validation-001');
});

test('sendForbidden can preserve legacy error field for existing clients', () => {
  const res = mockResponse();

  sendForbidden({ requestId: 'req-legacy-001' }, res, 'Unauthorized', {
    code: 'PRODUCT_OWNER_REQUIRED',
    includeLegacyError: true,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Unauthorized');
  assert.equal(res.body.error, 'Unauthorized');
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'PRODUCT_OWNER_REQUIRED');
});

test('isAdmin uses standardized error envelope', () => {
  const res = mockResponse();
  let calledNext = false;

  isAdmin({ requestId: 'req-admin-001', user: { role: 'customer' } }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Access denied: Admin only');
  assert.equal(res.body.code, 'ADMIN_REQUIRED');
  assert.equal(res.body.requestId, 'req-admin-001');
});
