const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const stripePaymentControllerPath = path.resolve(
  __dirname,
  '../../controllers/stripePaymentController.js'
);
const orderControllerPath = path.resolve(__dirname, '../../controllers/orderController.js');

const ORDER_ID = '507f1f77bcf86cd799439020';
const PAYMENT_ID = 'pi_test_email_safety';

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

function buildOrderForPostPayment(overrides = {}) {
  return {
    _id: ORDER_ID,
    paymentId: PAYMENT_ID,
    paymentStatus: 'pending',
    status: 'created',
    statusHistory: [{ status: 'created' }],
    paidConfirmationEmailSentAt: null,
    lifecycleEmailLog: [],
    items: [{ chargeId: null, transferId: null, applicationFeeId: null }],
    userId: { email: 'customer@example.com' },
    vendorId: { email: 'vendor@example.com' },
    businessId: {
      email: 'biz@example.com',
      owner: { email: 'owner@example.com' },
    },
    markModified() {},
    save: async function save() {
      return this;
    },
    ...overrides,
  };
}

function loadPostPaymentWebhook({
  orders = [],
  helperResult = {
    sent: true,
    skipped: false,
    failed: false,
    emailSent: true,
    emailSkipped: false,
    emailFailed: false,
  },
  helperShouldThrow = false,
  eventType = 'payment_intent.succeeded',
} = {}) {
  const helperCalls = [];
  let directMailerCallCount = 0;
  let inventoryReleaseCount = 0;

  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: eventType,
        data: {
          object: {
            id: PAYMENT_ID,
            status: eventType === 'payment_intent.payment_failed'
              ? 'requires_payment_method'
              : eventType === 'payment_intent.canceled'
                ? 'canceled'
                : 'succeeded',
            latest_charge: 'ch_test_001',
            currency: 'usd',
          },
        },
      }),
    },
    charges: {
      retrieve: async () => ({
        transfer: 'tr_test_001',
        application_fee: 'fee_test_001',
      }),
    },
    paymentIntents: {
      cancel: async (id) => ({ id, status: 'canceled' }),
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
        find: () => ({
          populate: async () => orders,
        }),
        findOneAndUpdate: async (filter, update) => {
          const order = orders.find(
            (candidate) =>
              String(candidate._id) === String(filter._id) &&
              candidate.paymentStatus !== filter.paymentStatus.$ne &&
              candidate.inventoryDecrementedAt == null
          );
          if (!order) return null;
          Object.assign(order, update.$set);
          return order;
        },
      };
    }
    if (request.endsWith('utils/OrderMail')) {
      return {
        sendOrderPaidEmails: async () => {
          directMailerCallCount += 1;
          throw new Error('controller must not call the provider mailer directly');
        },
      };
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        publicPaidOrderEmailDelivery: (result) => ({
          emailSent: Boolean(result?.emailSent),
          emailSkipped: Boolean(result?.emailSkipped),
          emailFailed: Boolean(result?.emailFailed),
          ...(result?.emailWarning ? { emailWarning: result.emailWarning } : {}),
        }),
        sendOrderPaidConfirmationIfNeeded: async (...args) => {
          helperCalls.push(args);
          if (helperShouldThrow) {
            throw new Error('sensitive SMTP failure detail');
          }
          return helperResult;
        },
      };
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => ({
          decremented: true,
          lines: [],
        }),
        releaseInventoryReservation: async () => {
          inventoryReleaseCount += 1;
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
    stripePaymentWebhook,
    getHelperCalls: () => helperCalls,
    getDirectMailerCallCount: () => directMailerCallCount,
    getInventoryReleaseCount: () => inventoryReleaseCount,
  };
}

test('post-payment webhook delegates successful delivery to the paid-confirmation helper', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
  } = loadPostPaymentWebhook({ orders: [order] });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 1);
  assert.equal(getHelperCalls()[0][0], order);
  assert.deepEqual(getHelperCalls()[0][1], { currency: 'usd' });
  assert.equal(getDirectMailerCallCount(), 0);
});

test('post-payment webhook acknowledges payment when helper reports delivery failure', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
  } = loadPostPaymentWebhook({
    orders: [order],
    helperResult: {
      sent: false,
      skipped: false,
      failed: true,
      emailSent: false,
      emailSkipped: false,
      emailFailed: true,
      emailWarning: 'paid_order_email_delivery_incomplete',
      error: 'sensitive SMTP failure detail',
    },
  });
  const res = mockResponse();

  try {
    await stripePaymentWebhook(
      {
        headers: { 'stripe-signature': 'sig_test' },
        body: Buffer.from('{}'),
      },
      res
    );
  } finally {
    console.error = originalError;
  }

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 1);
  assert.equal(getDirectMailerCallCount(), 0);
  assert.ok(errorLogs.some((line) => line.includes('delivery incomplete')));
  assert.ok(!errorLogs.some((line) => line.includes('sensitive SMTP failure detail')));
  assert.ok(!errorLogs.some((line) => line.includes('whsec_')));
});

test('post-payment webhook acknowledges payment and redacts an unexpected helper exception', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
  } = loadPostPaymentWebhook({
    orders: [order],
    helperShouldThrow: true,
  });
  const res = mockResponse();

  try {
    await stripePaymentWebhook(
      {
        headers: { 'stripe-signature': 'sig_test' },
        body: Buffer.from('{}'),
      },
      res
    );
  } finally {
    console.error = originalError;
  }

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 1);
  assert.equal(getDirectMailerCallCount(), 0);
  assert.ok(errorLogs.some((line) => line.includes('orchestration failure')));
  assert.ok(!errorLogs.some((line) => line.includes('sensitive SMTP failure detail')));
  assert.ok(!errorLogs.some((line) => line.includes('whsec_')));
});

test('post-payment webhook delegates legacy replay idempotency to the shared helper', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const sentAt = new Date('2026-06-18T00:00:00.000Z');
  const order = buildOrderForPostPayment({
    paymentStatus: 'paid',
    status: 'ordered',
    paidConfirmationEmailSentAt: sentAt,
  });
  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
  } = loadPostPaymentWebhook({
    orders: [order],
    helperResult: {
      sent: false,
      skipped: true,
      failed: false,
      emailSent: true,
      emailSkipped: false,
      emailFailed: false,
      reason: 'already_sent_legacy',
    },
  });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 1);
  assert.equal(getDirectMailerCallCount(), 0);
  assert.equal(order.paidConfirmationEmailSentAt, sentAt);
});

test('post-payment webhook does not reopen or email a refunded order', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment({
    paymentStatus: 'refunded',
    status: 'refunded',
  });
  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
  } = loadPostPaymentWebhook({ orders: [order] });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 0);
  assert.equal(getDirectMailerCallCount(), 0);
  assert.equal(order.paymentStatus, 'refunded');
  assert.equal(order.status, 'refunded');
});

test('post-payment webhook does not send confirmation on failed payment event', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
    getInventoryReleaseCount,
  } = loadPostPaymentWebhook({
    orders: [order],
    eventType: 'payment_intent.payment_failed',
  });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 0);
  assert.equal(getDirectMailerCallCount(), 0);
  assert.equal(order.paidConfirmationEmailSentAt, null);
  assert.equal(order.lifecycleEmailLog.length, 0);
  assert.equal(getInventoryReleaseCount(), 1);
  assert.equal(order.paymentStatus, 'failed');
  assert.equal(order.status, 'cancelled');
});

test('post-payment webhook does not send confirmation on canceled payment event', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const {
    stripePaymentWebhook,
    getHelperCalls,
    getDirectMailerCallCount,
    getInventoryReleaseCount,
  } = loadPostPaymentWebhook({
    orders: [order],
    eventType: 'payment_intent.canceled',
  });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getHelperCalls().length, 0);
  assert.equal(getDirectMailerCallCount(), 0);
  assert.equal(getInventoryReleaseCount(), 1);
  assert.equal(order.paymentStatus, 'failed');
  assert.equal(order.status, 'cancelled');
});

test('initiateOrder no longer sends pre-payment customer or vendor emails', () => {
  const source = fs.readFileSync(orderControllerPath, 'utf8');

  assert.ok(!source.includes('sendCustomerOrderPlacedEmail'));
  assert.ok(!source.includes('sendVendorNewOrderEmail'));
});

test('primary order webhook controller wires paid confirmation helper', () => {
  const webhookSource = fs.readFileSync(
    path.resolve(__dirname, '../../controllers/webhookController.js'),
    'utf8'
  );
  assert.ok(webhookSource.includes('sendOrderPaidConfirmationIfNeeded'));
  assert.ok(webhookSource.includes("payment_intent.succeeded"));
});

test('retrieveIntent paid reconcile wires paid confirmation helper', () => {
  const paymentSource = fs.readFileSync(
    path.resolve(__dirname, '../../controllers/stripePaymentController.js'),
    'utf8'
  );
  assert.ok(paymentSource.includes('sendOrderPaidConfirmationIfNeeded'));
  assert.ok(paymentSource.includes('reconcileSucceededPaymentIntentOrders'));
});
