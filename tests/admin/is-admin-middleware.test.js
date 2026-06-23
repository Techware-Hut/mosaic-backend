const test = require('node:test');
const assert = require('node:assert/strict');
const isAdmin = require('../../middlewares/isAdmin');

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

test('isAdmin allows admin role', () => {
  const res = mockResponse();
  let nextCalled = false;

  isAdmin({ user: { role: 'admin' } }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('isAdmin returns 403 for business_owner', () => {
  const res = mockResponse();
  let nextCalled = false;

  isAdmin({ user: { role: 'business_owner' } }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Access denied: Admin only');
});

test('isAdmin returns 403 for customer', () => {
  const res = mockResponse();
  let nextCalled = false;

  isAdmin({ user: { role: 'customer' } }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
