const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/vendorOnboarding.controller.js');
const userId = '507f1f77bcf86cd799439011';
const PI = 'pi_test_webhook_conditional';

// Minimal in-memory store that honours the filter shapes the webhook uses.
function getPath(doc, key) {
  return key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
}
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = getPath(doc, key);
    if (cond && typeof cond === 'object' && '$ne' in cond) return value !== cond.$ne;
    return value === cond;
  });
}
function setPath(doc, key, value) {
  const keys = key.split('.');
  const last = keys.pop();
  keys.reduce((v, k) => v[k], doc)[last] = value;
}

function loadController(record, { onRead } = {}) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET = 'whsec_test_mock';
  const calls = { save: 0, updateOne: [] };
  const vendorOnboardingMock = {
    findOne: async filter => {
      if (!matches(record, filter)) return null;
      const snapshot = structuredClone(record);
      snapshot.save = async () => { calls.save++; };
      if (onRead) await onRead();
      return snapshot;
    },
    updateOne: async (filter, update) => {
      calls.updateOne.push({ filter, update });
      if (!matches(record, filter)) return { matchedCount: 0, modifiedCount: 0 };
      for (const [key, value] of Object.entries(update.$set)) setPath(record, key, value);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const stripeMock = () => ({ webhooks: { constructEvent: payload => JSON.parse(payload.toString()) } });
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'stripe') return stripeMock;
    if (request === '../models/VendorOnboardingStage1') return vendorOnboardingMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[controllerPath];
    return { controller: require(controllerPath), calls };
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
}

function buildRecord(overrides = {}) {
  return { _id: 'onb_1', userId, status: 'payment_pending', badge: 'Silver', verificationPayment: { status: 'pending', paymentIntentId: PI, paidAt: null }, ...overrides };
}
function webhookReq(paymentIntentId = PI) {
  const event = { type: 'payment_intent.succeeded', data: { object: { id: paymentIntentId, metadata: { type: 'vendor_verification', userId } } } };
  return { headers: { 'stripe-signature': 't=1,v1=synthetic' }, body: Buffer.from(JSON.stringify(event)) };
}
function mockResponse() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } };
}

test('webhook moves payment_pending to draft and marks paid without save()', async () => {
  const record = buildRecord({ badge: 'Bronze' });
  const { controller, calls } = loadController(record);
  const res = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { received: true });
  assert.equal(calls.save, 0);
  assert.equal(record.status, 'draft');
  assert.equal(record.verificationPayment.status, 'paid');
  assert.ok(record.verificationPayment.paidAt instanceof Date);
  assert.equal(record.badge, 'Silver');
});

test('webhook that read payment_pending does not revert a concurrently submitted record', async () => {
  const record = buildRecord();
  // Simulate /submit winning between the webhook's read and its writes.
  const { controller } = loadController(record, {
    onRead: async () => {
      record.status = 'submitted';
      record.verificationPayment.status = 'paid';
      record.verificationPayment.paidAt = new Date('2026-11-20T00:00:00Z');
    },
  });
  const res = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(record.status, 'submitted');
  assert.equal(record.verificationPayment.status, 'paid');
  assert.equal(record.verificationPayment.paidAt.toISOString(), '2026-11-20T00:00:00.000Z');
});

test('late webhook on a submitted record records payment but keeps status', async () => {
  const record = buildRecord({ status: 'submitted' });
  const { controller } = loadController(record);
  await controller.handleVendorPaymentWebhook(webhookReq(), mockResponse());
  assert.equal(record.status, 'submitted');
  assert.equal(record.verificationPayment.status, 'paid');
});

test('duplicate webhook delivery is idempotent', async () => {
  const record = buildRecord();
  const { controller } = loadController(record);
  const first = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq(), first);
  const paidAt = record.verificationPayment.paidAt;
  const second = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq(), second);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(record.status, 'draft');
  assert.equal(record.verificationPayment.paidAt, paidAt);
});

test('mismatched paymentIntentId does not mark paid', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record);
  const res = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq('pi_other'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.updateOne.length, 0);
  assert.equal(record.status, 'payment_pending');
  assert.equal(record.verificationPayment.status, 'pending');
});

test('conditional writes always match on _id and paymentIntentId', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record);
  await controller.handleVendorPaymentWebhook(webhookReq(), mockResponse());
  assert.deepEqual(calls.updateOne.map(c => c.filter), [
    { _id: 'onb_1', 'verificationPayment.paymentIntentId': PI, 'verificationPayment.status': { $ne: 'paid' } },
    { _id: 'onb_1', 'verificationPayment.paymentIntentId': PI, status: 'payment_pending' },
  ]);
  assert.deepEqual(calls.updateOne[1].update, { $set: { status: 'draft' } });
});
