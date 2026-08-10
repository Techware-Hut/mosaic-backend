const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const webhookControllerPath = path.resolve(__dirname, '../../controllers/webhookController.js');
const stripePaymentControllerPath = path.resolve(__dirname, '../../controllers/stripePaymentController.js');

const ORDER_ID = '507f1f77bcf86cd799439020';
const PAYMENT_ID = 'pi_test_webhook_001';

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
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createStripeModule(stripeMock) {
  return function StripeClient() {
    return stripeMock;
  };
}

function loadOrderStatusWebhook({ orderDoc, findByIdAndUpdateImpl } = {}) {
  const updates = [];
  const emailCalls = [];
  const defaultOrder = orderDoc || {
    _id: ORDER_ID,
    paymentStatus: 'pending',
    status: 'created',
  };

  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: PAYMENT_ID,
            currency: 'usd',
            metadata: { orderId: ORDER_ID },
          },
        },
      }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return createStripeModule(stripeMock);
    }
    if (request.endsWith('models/Order')) {
      return {
        findByIdAndUpdate: async (id, update, opts) => {
          updates.push({ id, update, opts });
          if (findByIdAndUpdateImpl) {
            return findByIdAndUpdateImpl(id, update, opts);
          }
          return {
            ...defaultOrder,
            ...update,
            _id: id,
            items: defaultOrder.items || [],
          };
        },
      };
    }
    if (request.endsWith('models/Subscription')) {
      return {};
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => ({
          decremented: true,
          reason: 'mocked',
          lines: [],
        }),
      };
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        sendOrderPaidConfirmationIfNeeded: async (...args) => {
          emailCalls.push(args);
          return { sent: true, skipped: false };
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[webhookControllerPath];
  const { handleStripeWebhook } = require(webhookControllerPath);
  Module._load = originalLoad;

  return {
    handleStripeWebhook,
    getUpdates: () => updates,
    getEmailCalls: () => emailCalls,
  };
}

function loadFailedPaymentWebhook() {
  const updates = [];
  const cancellations = [];
  let releaseCalls = 0;
  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: PAYMENT_ID,
            status: 'requires_payment_method',
            metadata: { orderId: ORDER_ID },
          },
        },
      }),
    },
    paymentIntents: {
      cancel: async (id, params) => {
        cancellations.push({ id, params });
        return { id, status: 'canceled' };
      },
      retrieve: async (id) => ({ id, status: 'canceled' }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return createStripeModule(stripeMock);
    }
    if (request.endsWith('models/Order')) {
      return {
        findOneAndUpdate: async (filter, update) => {
          updates.push({ filter, update });
          return { _id: filter._id, ...update.$set };
        },
      };
    }
    if (request.endsWith('models/Subscription')) {
      return {};
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => ({
          decremented: false,
          reason: 'mocked',
        }),
        releaseInventoryReservation: async () => {
          releaseCalls += 1;
          return { restored: true, lines: [] };
        },
      };
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        sendOrderPaidConfirmationIfNeeded: async () => ({
          sent: false,
          skipped: true,
          reason: 'not_invoked_on_failed_path_expected',
        }),
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[webhookControllerPath];
  const { handleStripeWebhook } = require(webhookControllerPath);
  Module._load = originalLoad;

  return {
    handleStripeWebhook,
    getUpdates: () => updates,
    getCancellations: () => cancellations,
    getReleaseCalls: () => releaseCalls,
  };
}

function buildOrderForPostPayment(overrides = {}) {
  const items = [
    {
      chargeId: null,
      transferId: null,
      applicationFeeId: null,
    },
  ];
  return {
    _id: ORDER_ID,
    paymentId: PAYMENT_ID,
    paymentStatus: overrides.paymentStatus || 'pending',
    status: overrides.status || 'created',
    statusHistory: overrides.statusHistory || [{ status: 'created' }],
    items,
    userId: { email: 'customer@example.com' },
    vendorId: { email: 'vendor@example.com' },
    businessId: {
      email: 'biz@example.com',
      owner: { email: 'owner@example.com' },
    },
    markModified() {},
    save: async function save() {
      this.saveCount = (this.saveCount || 0) + 1;
      return this;
    },
  };
}

function loadPostPaymentWebhook({ orders = [], charge = {} } = {}) {
  let emailSendCount = 0;
  const defaultCharge = {
    transfer: 'tr_test_001',
    application_fee: 'fee_test_001',
    ...charge,
  };

  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: PAYMENT_ID,
            latest_charge: 'ch_test_001',
            currency: 'usd',
          },
        },
      }),
    },
    charges: {
      retrieve: async () => defaultCharge,
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return createStripeModule(stripeMock);
    }
    if (request.endsWith('models/Order')) {
      return {
        find: () => ({
          populate: async () => orders,
        }),
      };
    }
    if (request.endsWith('utils/OrderMail')) {
      return {
        sendOrderPaidEmails: async () => {
          emailSendCount += 1;
        },
      };
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        sendOrderPaidConfirmationIfNeeded: async () => ({
          sent: false,
          skipped: true,
          reason: 'mocked_unused_on_direct_post_payment_path',
        }),
      };
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => ({
          decremented: true,
          reason: 'mocked',
          lines: [],
        }),
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[stripePaymentControllerPath];
  const { stripePaymentWebhook } = require(stripePaymentControllerPath);
  Module._load = originalLoad;

  return {
    stripePaymentWebhook,
    getEmailSendCount: () => emailSendCount,
  };
}

function matchesOrderFilter(order, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = order[key];
    if (key === '_id') return String(actual) === String(expected);
    if (expected === null) return actual == null;
    if (expected && typeof expected === 'object' && '$ne' in expected) {
      return actual !== expected.$ne;
    }
    return actual === expected;
  });
}

function applyOrderUpdate(order, update) {
  const direct = Object.fromEntries(
    Object.entries(update).filter(([key]) => !key.startsWith('$'))
  );
  Object.assign(order, direct, update.$set || {});

  for (const key of Object.keys(update.$unset || {})) {
    delete order[key];
  }

  for (const [key, value] of Object.entries(update.$push || {})) {
    order[key] ||= [];
    order[key].push(value);
  }

  return order;
}

function paymentIntentEvent(type, status) {
  return {
    type,
    data: {
      object: {
        id: PAYMENT_ID,
        status,
        latest_charge: type === 'payment_intent.succeeded' ? 'ch_test_001' : null,
        currency: 'usd',
        metadata: { orderId: ORDER_ID },
      },
    },
  };
}

function loadOrderWebhookSequence({
  events,
  cancelRaceToSucceeded = false,
  cancelFailureStatus = null,
}) {
  let eventIndex = 0;
  let finalizeCalls = 0;
  let releaseCalls = 0;
  const order = {
    _id: ORDER_ID,
    paymentId: PAYMENT_ID,
    paymentStatus: 'pending',
    status: 'created',
    inventoryReservedAt: new Date('2026-08-07T00:00:00.000Z'),
    inventoryDecrementedAt: null,
    statusHistory: [{ status: 'created' }],
    items: [],
  };
  const succeededIntent = paymentIntentEvent(
    'payment_intent.succeeded',
    'succeeded'
  ).data.object;

  const stripeMock = {
    webhooks: {
      constructEvent: () => events[eventIndex++],
    },
    paymentIntents: {
      cancel: async () => {
        if (cancelRaceToSucceeded || cancelFailureStatus) {
          throw new Error(
            cancelRaceToSucceeded
              ? 'PaymentIntent already succeeded'
              : 'PaymentIntent cancellation failed'
          );
        }
        return { id: PAYMENT_ID, status: 'canceled' };
      },
      retrieve: async () =>
        cancelRaceToSucceeded
          ? succeededIntent
          : { id: PAYMENT_ID, status: cancelFailureStatus || 'canceled' },
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe') return createStripeModule(stripeMock);
    if (request.endsWith('models/Order')) {
      return {
        findByIdAndUpdate: async (id, update) => {
          if (String(id) !== String(order._id)) return null;
          return applyOrderUpdate(order, update);
        },
        findOneAndUpdate: async (filter, update) => {
          if (!matchesOrderFilter(order, filter)) return null;
          return applyOrderUpdate(order, update);
        },
      };
    }
    if (request.endsWith('models/Subscription')) return {};
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => {
          if (order.inventoryDecrementedAt) {
            return { decremented: false, reason: 'already_decremented' };
          }
          finalizeCalls += 1;
          order.inventoryDecrementedAt = new Date();
          delete order.inventoryReservedAt;
          return { decremented: true, reason: 'reservation_finalized', lines: [] };
        },
        releaseInventoryReservation: async () => {
          releaseCalls += 1;
          delete order.inventoryReservedAt;
          return { restored: true, lines: [] };
        },
      };
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        sendOrderPaidConfirmationIfNeeded: async () => ({
          sent: false,
          skipped: true,
          reason: 'mocked',
        }),
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[webhookControllerPath];
  const { handleStripeWebhook } = require(webhookControllerPath);
  Module._load = originalLoad;

  return {
    order,
    invoke: async () => {
      const res = mockResponse();
      await handleStripeWebhook(
        {
          headers: {
            'stripe-signature': 'sig_test',
            'content-type': 'application/json',
          },
          body: Buffer.from('{}'),
        },
        res
      );
      return res;
    },
    getFinalizeCalls: () => finalizeCalls,
    getReleaseCalls: () => releaseCalls,
  };
}

function loadPostPaymentWebhookSequence({
  events,
  cancelRaceToSucceeded = false,
  cancelFailureStatus = null,
}) {
  let eventIndex = 0;
  let finalizeCalls = 0;
  let releaseCalls = 0;
  const order = buildOrderForPostPayment();
  order.inventoryReservedAt = new Date('2026-08-07T00:00:00.000Z');
  order.inventoryDecrementedAt = null;
  order.paidConfirmationEmailSentAt = new Date('2026-08-07T00:00:00.000Z');
  const succeededIntent = paymentIntentEvent(
    'payment_intent.succeeded',
    'succeeded'
  ).data.object;

  const stripeMock = {
    webhooks: {
      constructEvent: () => events[eventIndex++],
    },
    paymentIntents: {
      cancel: async () => {
        if (cancelRaceToSucceeded || cancelFailureStatus) {
          throw new Error(
            cancelRaceToSucceeded
              ? 'PaymentIntent already succeeded'
              : 'PaymentIntent cancellation failed'
          );
        }
        return { id: PAYMENT_ID, status: 'canceled' };
      },
      retrieve: async () =>
        cancelRaceToSucceeded
          ? succeededIntent
          : { id: PAYMENT_ID, status: cancelFailureStatus || 'canceled' },
    },
    charges: {
      retrieve: async () => ({
        transfer: 'tr_test_001',
        application_fee: 'fee_test_001',
      }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe') return createStripeModule(stripeMock);
    if (request.endsWith('models/Order')) {
      return {
        find: () => ({ populate: async () => [order] }),
        findByIdAndUpdate: async (id, update) => {
          if (String(id) !== String(order._id)) return null;
          return applyOrderUpdate(order, update);
        },
        findOneAndUpdate: async (filter, update) => {
          if (!matchesOrderFilter(order, filter)) return null;
          return applyOrderUpdate(order, update);
        },
      };
    }
    if (request.endsWith('utils/OrderMail')) {
      return { sendOrderPaidEmails: async () => {} };
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        sendOrderPaidConfirmationIfNeeded: async () => ({
          sent: false,
          skipped: true,
          reason: 'already_sent',
        }),
      };
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => {
          if (order.inventoryDecrementedAt) {
            return { decremented: false, reason: 'already_decremented' };
          }
          finalizeCalls += 1;
          order.inventoryDecrementedAt = new Date();
          delete order.inventoryReservedAt;
          return { decremented: true, reason: 'reservation_finalized', lines: [] };
        },
        releaseInventoryReservation: async () => {
          releaseCalls += 1;
          delete order.inventoryReservedAt;
          return { restored: true, lines: [] };
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[stripePaymentControllerPath];
  const { stripePaymentWebhook } = require(stripePaymentControllerPath);
  Module._load = originalLoad;

  return {
    order,
    invoke: async () => {
      const res = mockResponse();
      await stripePaymentWebhook(
        {
          headers: { 'stripe-signature': 'sig_test' },
          body: Buffer.from('{}'),
        },
        res
      );
      return res;
    },
    getFinalizeCalls: () => finalizeCalls,
    getReleaseCalls: () => releaseCalls,
  };
}

test('order status webhook marks order paid and ordered on payment_intent.succeeded', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates, getEmailCalls } = loadOrderStatusWebhook();
  const res = mockResponse();

  await handleStripeWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(getUpdates().length, 1);
  assert.equal(getUpdates()[0].update.paymentStatus, 'paid');
  assert.equal(getUpdates()[0].update.status, 'ordered');
  assert.equal(getEmailCalls().length, 1);
  assert.equal(String(getEmailCalls()[0][0]._id || getEmailCalls()[0][0]), ORDER_ID);
  assert.equal(getEmailCalls()[0][1]?.currency, 'usd');
});

test('order status webhook duplicate succeed is idempotent', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates } = loadOrderStatusWebhook({
    findByIdAndUpdateImpl: async (id, update) => ({
      _id: id,
      paymentStatus: 'paid',
      status: 'ordered',
      ...update,
    }),
  });
  const req = {
    headers: { 'stripe-signature': 'sig_test' },
    body: Buffer.from('{}'),
  };

  const res1 = mockResponse();
  await handleStripeWebhook(req, res1);
  const res2 = mockResponse();
  await handleStripeWebhook(req, res2);

  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  assert.equal(getUpdates().length, 2);
  assert.equal(getUpdates()[0].update.paymentStatus, 'paid');
  assert.equal(getUpdates()[1].update.paymentStatus, 'paid');
});

test('order status webhook cancels a retryable failed intent and releases inventory', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const {
    handleStripeWebhook,
    getUpdates,
    getCancellations,
    getReleaseCalls,
  } = loadFailedPaymentWebhook();
  const res = mockResponse();

  await handleStripeWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(getUpdates()[0].update.$set.paymentStatus, 'failed');
  assert.equal(getUpdates()[0].update.$set.status, 'cancelled');
  assert.deepEqual(getCancellations(), [
    {
      id: PAYMENT_ID,
      params: { cancellation_reason: 'abandoned' },
    },
  ]);
  assert.equal(getReleaseCalls(), 1);
});

test('post-payment webhook stores charge transfer and application fee IDs', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const { stripePaymentWebhook } = loadPostPaymentWebhook({ orders: [order] });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.status, 'ordered');
  assert.equal(order.items[0].chargeId, 'ch_test_001');
  assert.equal(order.items[0].transferId, 'tr_test_001');
  assert.equal(order.items[0].applicationFeeId, 'fee_test_001');
});

test('post-payment webhook duplicate succeed keeps paid status without corruption', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment({
    paymentStatus: 'paid',
    status: 'ordered',
    statusHistory: [{ status: 'created' }, { status: 'ordered' }],
  });
  order.items[0].chargeId = 'ch_existing';
  order.items[0].transferId = 'tr_existing';
  order.items[0].applicationFeeId = 'fee_existing';

  const { stripePaymentWebhook } = loadPostPaymentWebhook({ orders: [order] });
  const req = {
    headers: { 'stripe-signature': 'sig_test' },
    body: Buffer.from('{}'),
  };

  const res1 = mockResponse();
  await stripePaymentWebhook(req, res1);
  const res2 = mockResponse();
  await stripePaymentWebhook(req, res2);

  assert.ok(res1.body.received);
  assert.ok(res2.body.received);
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.status, 'ordered');
  assert.equal(order.items[0].chargeId, 'ch_test_001');
  assert.equal(order.items[0].transferId, 'tr_test_001');
  assert.equal(order.items[0].applicationFeeId, 'fee_test_001');
});

test('order status webhook ignores stale payment_failed after paid finalization', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const harness = loadOrderWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.succeeded', 'succeeded'),
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
    ],
  });

  assert.equal((await harness.invoke()).statusCode, 200);
  assert.equal((await harness.invoke()).statusCode, 200);
  assert.equal(harness.order.paymentStatus, 'paid');
  assert.equal(harness.order.status, 'ordered');
  assert.ok(harness.order.inventoryDecrementedAt);
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('order status webhook ignores stale canceled after paid finalization', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const harness = loadOrderWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.succeeded', 'succeeded'),
      paymentIntentEvent('payment_intent.canceled', 'canceled'),
    ],
  });

  await harness.invoke();
  await harness.invoke();
  assert.equal(harness.order.paymentStatus, 'paid');
  assert.equal(harness.order.status, 'ordered');
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('order status webhook ignores failure after inventory finalization marker', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const harness = loadOrderWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
    ],
  });
  harness.order.inventoryDecrementedAt = new Date('2026-08-07T00:05:00.000Z');

  assert.equal((await harness.invoke()).statusCode, 200);
  assert.equal(harness.order.paymentStatus, 'pending');
  assert.equal(harness.order.status, 'created');
  assert.equal(harness.getFinalizeCalls(), 0);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('order status webhook reconciles cancel race that already succeeded', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const harness = loadOrderWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
      paymentIntentEvent('payment_intent.succeeded', 'succeeded'),
    ],
    cancelRaceToSucceeded: true,
  });

  const failedDelivery = await harness.invoke();
  assert.equal(failedDelivery.statusCode, 200);
  assert.equal(harness.order.paymentStatus, 'paid');
  assert.equal(harness.order.status, 'ordered');
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);

  await harness.invoke();
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('post-payment webhook ignores stale payment_failed after paid finalization', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const harness = loadPostPaymentWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.succeeded', 'succeeded'),
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
    ],
  });

  await harness.invoke();
  await harness.invoke();
  assert.equal(harness.order.paymentStatus, 'paid');
  assert.equal(harness.order.status, 'ordered');
  assert.ok(harness.order.inventoryDecrementedAt);
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('post-payment webhook ignores stale canceled after paid finalization', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const harness = loadPostPaymentWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.succeeded', 'succeeded'),
      paymentIntentEvent('payment_intent.canceled', 'canceled'),
    ],
  });

  await harness.invoke();
  await harness.invoke();
  assert.equal(harness.order.paymentStatus, 'paid');
  assert.equal(harness.order.status, 'ordered');
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('post-payment webhook ignores cancellation after inventory finalization marker', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const harness = loadPostPaymentWebhookSequence({
    events: [paymentIntentEvent('payment_intent.canceled', 'canceled')],
  });
  harness.order.inventoryDecrementedAt = new Date('2026-08-07T00:05:00.000Z');

  assert.deepEqual((await harness.invoke()).body, { received: true });
  assert.equal(harness.order.paymentStatus, 'pending');
  assert.equal(harness.order.status, 'created');
  assert.equal(harness.getFinalizeCalls(), 0);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('post-payment webhook reconciles cancel race that already succeeded', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const harness = loadPostPaymentWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
      paymentIntentEvent('payment_intent.succeeded', 'succeeded'),
    ],
    cancelRaceToSucceeded: true,
  });

  const failedDelivery = await harness.invoke();
  assert.deepEqual(failedDelivery.body, { received: true });
  assert.equal(harness.order.paymentStatus, 'paid');
  assert.equal(harness.order.status, 'ordered');
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);

  await harness.invoke();
  assert.equal(harness.getFinalizeCalls(), 1);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('order status webhook keeps reservation when cancellation is unconfirmed', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const harness = loadOrderWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
    ],
    cancelFailureStatus: 'requires_payment_method',
  });

  const response = await harness.invoke();
  assert.equal(response.statusCode, 500);
  assert.equal(harness.order.paymentStatus, 'pending');
  assert.ok(harness.order.inventoryReservedAt);
  assert.equal(harness.getFinalizeCalls(), 0);
  assert.equal(harness.getReleaseCalls(), 0);
});

test('post-payment webhook keeps reservation when cancellation is unconfirmed', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const harness = loadPostPaymentWebhookSequence({
    events: [
      paymentIntentEvent('payment_intent.payment_failed', 'requires_payment_method'),
    ],
    cancelFailureStatus: 'requires_payment_method',
  });

  const response = await harness.invoke();
  assert.equal(response.statusCode, 500);
  assert.equal(harness.order.paymentStatus, 'pending');
  assert.ok(harness.order.inventoryReservedAt);
  assert.equal(harness.getFinalizeCalls(), 0);
  assert.equal(harness.getReleaseCalls(), 0);
});
