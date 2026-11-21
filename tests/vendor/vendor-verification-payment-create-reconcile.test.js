const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// createVerificationPayment must never orphan a PaymentIntent that already
// succeeded (or is processing) on Stripe, and must never overwrite a payment
// the webhook marked paid between its read and its write. Stripe is mocked.

const controllerPath = path.resolve(__dirname, '../../controllers/vendorOnboarding.controller.js');
const userId = '507f1f77bcf86cd799439011';
const PI = 'pi_test_create_reconcile';

function getPath(doc, key) {
  return key.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
}
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = getPath(doc, key);
    if (cond === null) return value == null; // Mongo: null matches missing or null
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
function withSave(record, calls) {
  // Simulates a Mongoose document: save() writes the whole snapshot back.
  const snapshot = structuredClone(record);
  Object.defineProperty(snapshot, 'save', {
    enumerable: false,
    value: async () => {
      calls.save++;
      const { save, ...data } = snapshot;
      Object.assign(record, structuredClone(data));
    },
  });
  return snapshot;
}

function loadController(record, { intents = {}, onRead } = {}) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET = 'whsec_test_mock';
  const calls = { save: 0, updateOne: [], created: [], retrieved: [] };
  const vendorOnboardingMock = {
    findOne: async filter => {
      if (!matches(record, filter)) return null;
      const snapshot = withSave(record, calls);
      if (onRead) {
        const hook = onRead;
        onRead = null; // only the first read races
        await hook();
      }
      return snapshot;
    },
    findById: async () => withSave(record, calls),
    updateOne: async (filter, update) => {
      calls.updateOne.push({ filter, update });
      if (!matches(record, filter)) return { matchedCount: 0, modifiedCount: 0 };
      for (const [key, value] of Object.entries(update.$set || {})) setPath(record, key, structuredClone(value));
      for (const key of Object.keys(update.$unset || {})) delete record[key];
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const stripeMock = () => ({
    webhooks: { constructEvent: payload => JSON.parse(payload.toString()) },
    paymentIntents: {
      retrieve: async id => {
        calls.retrieved.push(id);
        if (!intents[id]) throw new Error('No such payment_intent');
        return { id, client_secret: `${id}_secret`, ...intents[id] };
      },
      create: async params => {
        const id = `pi_new_${calls.created.length + 1}`;
        calls.created.push({ id, params });
        return { id, client_secret: `${id}_secret`, status: 'requires_payment_method', metadata: params.metadata };
      },
    },
  });
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
  return {
    _id: 'onb_create_1',
    userId,
    applicationId: 'MBH-APP-TEST-516',
    status: 'payment_pending',
    badge: 'Silver',
    verificationPayment: { provider: 'stripe', status: 'pending', paymentIntentId: PI, paidAt: null },
    ...overrides,
  };
}
const vendorMetadata = { type: 'vendor_verification', userId };
function jsonResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}
function webhookReq(paymentIntentId) {
  const event = { type: 'payment_intent.succeeded', data: { object: { id: paymentIntentId, metadata: vendorMetadata } } };
  return { headers: { 'stripe-signature': 't=1,v1=synthetic' }, body: Buffer.from(JSON.stringify(event)) };
}

test('existing PaymentIntent already succeeded (webhook pending): no new PI, record reconciled to paid/draft, already-paid response', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'succeeded', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);

  assert.equal(calls.created.length, 0, 'must not create a new PaymentIntent');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { success: false, message: 'Verification fee already paid' });
  assert.equal(record.verificationPayment.paymentIntentId, PI);
  assert.equal(record.verificationPayment.status, 'paid');
  assert.ok(record.verificationPayment.paidAt instanceof Date);
  assert.equal(record.status, 'draft');
});

test('late webhook for the reconciled PaymentIntent still finds the record and is a no-op', async () => {
  const record = buildRecord();
  const { controller } = loadController(record, {
    intents: { [PI]: { status: 'succeeded', metadata: vendorMetadata } },
  });
  await controller.createVerificationPayment({ user: { _id: userId } }, jsonResponse());
  const paidAt = record.verificationPayment.paidAt;

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  const res = jsonResponse();
  try {
    await controller.handleVendorPaymentWebhook(webhookReq(PI), res);
  } finally {
    console.log = originalLog;
  }
  assert.equal(res.statusCode, 200);
  assert.ok(!logs.some(l => l.includes('No onboarding record found')), 'webhook must still match the record');
  assert.ok(logs.some(l => l.includes(`Vendor verification webhook ${PI}`)));
  assert.equal(record.verificationPayment.status, 'paid');
  assert.equal(record.verificationPayment.paidAt, paidAt);
  assert.equal(record.status, 'draft');
});

test('succeeded PaymentIntent with foreign metadata is not trusted; a new PI is created as before', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'succeeded', metadata: { type: 'vendor_verification', userId: 'someone_else' } } },
  });
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);
  assert.equal(calls.created.length, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(record.verificationPayment.paymentIntentId, 'pi_new_1');
  assert.equal(record.verificationPayment.status, 'pending');
});

test('existing PaymentIntent processing: no new PI, existing client secret returned', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'processing', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);
  assert.equal(calls.created.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.clientSecret, `${PI}_secret`);
  assert.equal(record.verificationPayment.paymentIntentId, PI);
});

for (const status of ['canceled']) {
  test(`existing PaymentIntent ${status}: new PI created and stored as before`, async () => {
    const record = buildRecord({ submittedAt: new Date('2026-11-01T00:00:00Z') });
    const { controller, calls } = loadController(record, {
      intents: { [PI]: { status, metadata: vendorMetadata } },
    });
    const res = jsonResponse();
    await controller.createVerificationPayment({ user: { _id: userId } }, res);
    assert.equal(calls.created.length, 1);
    assert.equal(calls.created[0].params.amount, 2499);
    assert.equal(calls.created[0].params.currency, 'usd');
    assert.deepEqual(calls.created[0].params.metadata, { userId, type: 'vendor_verification', applicationId: 'MBH-APP-TEST-516' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Payment intent created successfully. Complete payment to continue.');
    assert.equal(res.body.data.clientSecret, 'pi_new_1_secret');
    assert.equal(record.verificationPayment.paymentIntentId, 'pi_new_1');
    assert.equal(record.verificationPayment.status, 'pending');
    assert.equal(record.status, 'payment_pending');
    assert.equal(record.submittedAt, undefined);
  });
}

test('existing PaymentIntent failed (requires_payment_method after webhook failure): reused, no new PI', async () => {
  const record = buildRecord({ verificationPayment: { provider: 'stripe', status: 'failed', paymentIntentId: PI, paidAt: null } });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'requires_payment_method', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);
  assert.equal(calls.created.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.clientSecret, `${PI}_secret`);
});

test('first payment (no PaymentIntent yet) creates one and moves draft to payment_pending', async () => {
  const record = buildRecord({ status: 'draft', badge: 'Bronze', verificationPayment: { status: 'not_started' } });
  const { controller, calls } = loadController(record);
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);
  assert.equal(calls.created.length, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(record.status, 'payment_pending');
  assert.equal(record.verificationPayment.paymentIntentId, 'pi_new_1');
  assert.equal(record.badge, 'Silver');
  assert.equal(calls.save, 0, 'final write must be conditional, not save()');
});

test('webhook marking paid between read and write is not overwritten', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'canceled', metadata: vendorMetadata } },
    onRead: async () => {
      // Webhook for the stored PI lands after createVerificationPayment read the record.
      record.verificationPayment.status = 'paid';
      record.verificationPayment.paidAt = new Date('2026-11-20T00:00:00Z');
      record.status = 'draft';
    },
  });
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);
  assert.equal(record.verificationPayment.status, 'paid');
  assert.equal(record.verificationPayment.paymentIntentId, PI);
  assert.equal(record.verificationPayment.paidAt.toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(record.status, 'draft');
  assert.equal(calls.save, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { success: false, message: 'Verification fee already paid' });
});

test('status moved past payment stage between read and write is not reverted', async () => {
  const record = buildRecord({ status: 'draft', verificationPayment: { status: 'not_started' } });
  const { controller } = loadController(record, {
    onRead: async () => { record.status = 'submitted'; },
  });
  const res = jsonResponse();
  await controller.createVerificationPayment({ user: { _id: userId } }, res);
  assert.equal(record.status, 'submitted');
  assert.equal(record.verificationPayment.paymentIntentId, undefined);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.data.applicationStatus, 'submitted');
});
