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

const ENV_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET'];
const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
test.after(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

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
function stripeError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

// intents[id] is either a PaymentIntent shape or a function(callIndex) that
// returns one or throws, so successive retrieves can differ.
function loadController(record, { intents = {}, onRead, updateOneError, cancelError } = {}) {
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
  process.env.STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET = 'whsec_test_mock';
  const calls = { save: 0, updateOne: [], created: [], retrieved: [], canceled: [] };
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
      if (updateOneError) throw updateOneError;
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
        const callIndex = calls.retrieved.filter(r => r === id).length;
        calls.retrieved.push(id);
        const entry = intents[id];
        if (!entry) throw stripeError('No such payment_intent', { code: 'resource_missing', statusCode: 404 });
        const intent = typeof entry === 'function' ? entry(callIndex) : entry;
        return { id, client_secret: `${id}_secret`, ...intent };
      },
      create: async params => {
        const id = `pi_new_${calls.created.length + 1}`;
        calls.created.push({ id, params });
        return { id, client_secret: `${id}_secret`, status: 'requires_payment_method', metadata: params.metadata };
      },
      cancel: async id => {
        calls.canceled.push(id);
        if (cancelError) throw cancelError;
        return { id, status: 'canceled' };
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
const ALREADY_PAID = { success: false, code: 'ALREADY_PAID', message: 'Verification fee already paid' };
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
async function quietly(fn) {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
}
const create = (controller, res) =>
  quietly(() => controller.createVerificationPayment({ user: { _id: userId } }, res));

test('existing PaymentIntent already succeeded (webhook pending): no new PI, record reconciled to paid/draft, already-paid response', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'succeeded', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await create(controller, res);

  assert.equal(calls.created.length, 0, 'must not create a new PaymentIntent');
  assert.deepEqual(calls.retrieved, [PI], 'reconcile reuses the retrieved intent');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, ALREADY_PAID);
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
  await create(controller, jsonResponse());
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
  await create(controller, res);
  assert.equal(calls.created.length, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(record.verificationPayment.paymentIntentId, 'pi_new_1');
  assert.equal(record.verificationPayment.status, 'pending');
});

test('succeeded vendor PaymentIntent but a second retrieve / reconcile write fails: no new PI, stored PI unchanged, PAYMENT_CONFIRMING', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    // First retrieve succeeds; any second retrieve throws.
    intents: {
      [PI]: callIndex => {
        if (callIndex > 0) throw stripeError('Stripe unavailable', { statusCode: 500 });
        return { status: 'succeeded', metadata: vendorMetadata };
      },
    },
    updateOneError: new Error('db write failed'),
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0, 'must not create a new PaymentIntent over a succeeded one');
  assert.equal(record.verificationPayment.paymentIntentId, PI);
  assert.equal(record.verificationPayment.status, 'pending');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'PAYMENT_CONFIRMING');
});

test('generic Stripe retrieve error: 503, no new PI', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: () => { throw stripeError('connection reset', { type: 'StripeConnectionError' }); } },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.updateOne.length, 0);
  assert.equal(record.verificationPayment.paymentIntentId, PI);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'PAYMENT_PROVIDER_UNAVAILABLE');
});

test('stored PaymentIntent missing on Stripe (resource_missing): new PI created as before', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record); // no intents -> resource_missing
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(record.verificationPayment.paymentIntentId, 'pi_new_1');
});

test('existing PaymentIntent processing: no new PI, existing client secret returned', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'processing', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.clientSecret, `${PI}_secret`);
  assert.equal(record.verificationPayment.paymentIntentId, PI);
});

test('reuse write DB error propagates to 500 and does not create a new PI', async () => {
  const record = buildRecord();
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'requires_payment_method', metadata: vendorMetadata } },
    updateOneError: new Error('db write failed'),
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(res.statusCode, 500);
  assert.equal(record.verificationPayment.paymentIntentId, PI);
});

test('existing PaymentIntent canceled: new PI created and stored as before', async () => {
  const record = buildRecord({ submittedAt: new Date('2026-11-01T00:00:00Z') });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'canceled', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await create(controller, res);
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
  assert.equal(calls.canceled.length, 0);
});

test('existing PaymentIntent failed (requires_payment_method after webhook failure): reused, no new PI', async () => {
  const record = buildRecord({ verificationPayment: { provider: 'stripe', status: 'failed', paymentIntentId: PI, paidAt: null } });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'requires_payment_method', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.clientSecret, `${PI}_secret`);
});

test('first payment (no PaymentIntent yet) creates one and moves draft to payment_pending', async () => {
  const record = buildRecord({ status: 'draft', badge: 'Bronze', verificationPayment: { status: 'not_started' } });
  const { controller, calls } = loadController(record);
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(record.status, 'payment_pending');
  assert.equal(record.verificationPayment.paymentIntentId, 'pi_new_1');
  assert.equal(record.badge, 'Silver');
  assert.equal(calls.save, 0, 'final write must be conditional, not save()');
});

test('webhook marking paid between read and write is not overwritten; orphan PI is canceled', async () => {
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
  await create(controller, res);
  assert.equal(record.verificationPayment.status, 'paid');
  assert.equal(record.verificationPayment.paymentIntentId, PI);
  assert.equal(record.verificationPayment.paidAt.toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(record.status, 'draft');
  assert.equal(calls.save, 0);
  assert.deepEqual(calls.canceled, ['pi_new_1']);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, ALREADY_PAID);
});

test('status moved past payment stage between read and write is not reverted; a failing orphan cancel does not change the response', async () => {
  const record = buildRecord({ status: 'draft', verificationPayment: { status: 'not_started' } });
  const { controller, calls } = loadController(record, {
    onRead: async () => { record.status = 'submitted'; },
    cancelError: stripeError('cancel failed', { statusCode: 500 }),
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(record.status, 'submitted');
  assert.equal(record.verificationPayment.paymentIntentId, undefined);
  assert.deepEqual(calls.canceled, ['pi_new_1']);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'PAYMENT_STATE_CHANGED');
  assert.equal(res.body.data.applicationStatus, 'submitted');
});

test('reuse path: webhook marking paid between read and write is not reverted to payment_pending', async () => {
  const record = buildRecord({ status: 'draft' });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'processing', metadata: vendorMetadata } },
    onRead: async () => {
      record.verificationPayment.status = 'paid';
      record.verificationPayment.paidAt = new Date('2026-11-20T00:00:00Z');
    },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.save, 0);
  assert.equal(record.status, 'draft');
  assert.equal(record.verificationPayment.status, 'paid');
  assert.equal(record.verificationPayment.paymentIntentId, PI);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, ALREADY_PAID);
});

test('reuse path: status moved past payment stage between read and write is not reverted (409)', async () => {
  const record = buildRecord({ status: 'draft' });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'requires_payment_method', metadata: vendorMetadata } },
    onRead: async () => { record.status = 'submitted'; },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(record.status, 'submitted');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PAYMENT_STATE_CHANGED');
  assert.equal(res.body.data.applicationStatus, 'submitted');
});

test('reuse path: draft double-click is idempotent (second request also gets 200 reuse)', async () => {
  const record = buildRecord({ status: 'draft' });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'requires_payment_method', metadata: vendorMetadata } },
    // The first click's write lands after the second click read 'draft'.
    onRead: async () => { record.status = 'payment_pending'; },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.created.length, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.clientSecret, `${PI}_secret`);
  assert.equal(record.status, 'payment_pending');
});

test('reuse path write matches on _id, read/payment_pending status, PaymentIntent and not-paid', async () => {
  const record = buildRecord({ status: 'draft', badge: 'Bronze' });
  const { controller, calls } = loadController(record, {
    intents: { [PI]: { status: 'requires_payment_method', metadata: vendorMetadata } },
  });
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.save, 0);
  assert.deepEqual(calls.updateOne[0].filter, {
    _id: 'onb_create_1',
    status: { $in: ['draft', 'payment_pending'] },
    'verificationPayment.status': { $ne: 'paid' },
    'verificationPayment.paymentIntentId': PI,
  });
  assert.deepEqual(calls.updateOne[0].update, { $set: { status: 'payment_pending', badge: 'Silver' } });
  assert.equal(record.status, 'payment_pending');
  assert.equal(record.badge, 'Silver');
});

test('already-paid record short-circuits with the ALREADY_PAID body', async () => {
  const record = buildRecord({ verificationPayment: { status: 'paid', paymentIntentId: PI } });
  const { controller, calls } = loadController(record);
  const res = jsonResponse();
  await create(controller, res);
  assert.equal(calls.retrieved.length, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, ALREADY_PAID);
});
