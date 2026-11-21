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
    if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(value);
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
function webhookReq(paymentIntentId = PI, type = 'payment_intent.succeeded') {
  const event = { type, data: { object: { id: paymentIntentId, metadata: { type: 'vendor_verification', userId } } } };
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

const FAILED = 'payment_intent.payment_failed';

for (const status of ['payment_pending', 'draft']) {
  test(`payment_failed on a ${status} record marks failed and payment_pending as before`, async () => {
    const record = buildRecord({ status });
    const { controller, calls } = loadController(record);
    const res = mockResponse();
    await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { received: true });
    assert.equal(calls.save, 0);
    assert.equal(record.status, 'payment_pending');
    assert.equal(record.verificationPayment.status, 'failed');
  });
}

for (const status of ['submitted', 'verified', 'rejected']) {
  test(`payment_failed after ${status} leaves the record untouched`, async () => {
    const record = buildRecord({ status });
    const before = structuredClone(record);
    const { controller } = loadController(record);
    const res = mockResponse();
    await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(record, before);
  });
}

test('payment_failed after paid does not unmark paid', async () => {
  const paidAt = new Date('2026-11-20T00:00:00Z');
  const record = buildRecord({ status: 'draft', verificationPayment: { status: 'paid', paymentIntentId: PI, paidAt } });
  const before = structuredClone(record);
  const { controller } = loadController(record);
  await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), mockResponse());
  assert.deepEqual(record, before);
});

test('payment_failed with mismatched paymentIntentId does not write', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record);
  const res = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq('pi_other', FAILED), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.updateOne.length, 0);
  assert.equal(calls.save, 0);
  assert.equal(record.verificationPayment.status, 'pending');
});

test('payment_failed write is a single guarded updateOne', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record);
  await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), mockResponse());
  assert.deepEqual(calls.updateOne, [{
    filter: { _id: 'onb_1', 'verificationPayment.paymentIntentId': PI, 'verificationPayment.status': { $ne: 'paid' }, status: { $in: ['draft', 'payment_pending'] } },
    update: { $set: { 'verificationPayment.status': 'failed', status: 'payment_pending' } },
  }]);
});

async function captureLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines;
}

test('succeeded self-repairs a paid but still payment_pending record to draft; (b) is not gated on (a)', async () => {
  const paidAt = new Date('2026-11-20T00:00:00Z');
  const record = buildRecord({ verificationPayment: { status: 'paid', paymentIntentId: PI, paidAt } });
  const { controller } = loadController(record);
  const res = mockResponse();
  await controller.handleVendorPaymentWebhook(webhookReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(record.status, 'draft');
  assert.equal(record.verificationPayment.status, 'paid');
  assert.equal(record.verificationPayment.paidAt, paidAt);
});

for (const status of ['payment_pending', 'draft']) {
  test(`payment_failed on a Bronze ${status} record leaves badge Bronze`, async () => {
    const record = buildRecord({ status, badge: 'Bronze' });
    const { controller } = loadController(record);
    await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), mockResponse());
    assert.equal(record.verificationPayment.status, 'failed');
    assert.equal(record.badge, 'Bronze');
  });
}

test('succeeded logs update counts and flags a duplicate delivery as no-op without private data', async () => {
  const record = buildRecord();
  const { controller } = loadController(record);
  const first = await captureLogs(() => controller.handleVendorPaymentWebhook(webhookReq(), mockResponse()));
  const second = await captureLogs(() => controller.handleVendorPaymentWebhook(webhookReq(), mockResponse()));
  const firstCounts = first.find(line => line.includes('paid matched='));
  const secondCounts = second.find(line => line.includes('paid matched='));
  assert.equal(firstCounts, `Vendor verification webhook ${PI}: paid matched=1 modified=1; draft matched=1 modified=1`);
  assert.equal(secondCounts, `Vendor verification webhook ${PI}: paid matched=0 modified=0; draft matched=0 modified=0 (duplicate/no-op)`);
  assert.ok(!secondCounts.includes(userId));
});

test('payment_failed logs update counts and flags a guarded no-op without private data', async () => {
  const applied = await captureLogs(async () => {
    const { controller } = loadController(buildRecord());
    await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), mockResponse());
  });
  const skipped = await captureLogs(async () => {
    const { controller } = loadController(buildRecord({ status: 'submitted' }));
    await controller.handleVendorPaymentWebhook(webhookReq(PI, FAILED), mockResponse());
  });
  assert.ok(applied.includes(`Vendor verification webhook ${PI}: failed matched=1 modified=1`));
  const noop = skipped.find(line => line.includes('failed matched='));
  assert.equal(noop, `Vendor verification webhook ${PI}: failed matched=0 modified=0 (no-op: already paid, past payment stage, or duplicate)`);
  assert.ok(!noop.includes(userId));
});
