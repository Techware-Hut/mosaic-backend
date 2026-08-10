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
  mailShouldFail = false,
  eventType = 'payment_intent.succeeded',
} = {}) {
  let emailSendCount = 0;
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
          emailSendCount += 1;
          if (mailShouldFail) {
            throw new Error('SMTP unavailable');
          }
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
    getEmailSendCount: () => emailSendCount,
    getInventoryReleaseCount: () => inventoryReleaseCount,
  };
}

test('post-payment webhook calls sendOrderPaidEmails on success', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const { stripePaymentWebhook, getEmailSendCount } = loadPostPaymentWebhook({ orders: [order] });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getEmailSendCount(), 1);
  assert.ok(order.paidConfirmationEmailSentAt instanceof Date);
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].event, 'order_paid_confirmation');
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
});

test('post-payment webhook still returns received when email send fails', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const { stripePaymentWebhook, getEmailSendCount } = loadPostPaymentWebhook({
    orders: [order],
    mailShouldFail: true,
  });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  console.error = originalError;

  assert.ok(res.body.received);
  assert.equal(getEmailSendCount(), 1);
  assert.equal(order.paidConfirmationEmailSentAt, null);
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'failed');
  assert.ok(order.lifecycleEmailLog[0].error.includes('SMTP unavailable'));
  assert.ok(errorLogs.some((line) => line.includes('SMTP unavailable')));
  assert.ok(!errorLogs.some((line) => line.includes('whsec_')));
});

test('post-payment webhook skips duplicate paid confirmation emails', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment({
    paidConfirmationEmailSentAt: new Date('2026-06-18T00:00:00.000Z'),
  });
  const { stripePaymentWebhook, getEmailSendCount } = loadPostPaymentWebhook({ orders: [order] });
  const res = mockResponse();

  await stripePaymentWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.ok(res.body.received);
  assert.equal(getEmailSendCount(), 0);
  assert.equal(order.lifecycleEmailLog.length, 0);
});

test('post-payment webhook does not send confirmation on failed payment event', async () => {
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = 'whsec_post_payment_test';
  const order = buildOrderForPostPayment();
  const {
    stripePaymentWebhook,
    getEmailSendCount,
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
  assert.equal(getEmailSendCount(), 0);
  assert.equal(order.paidConfirmationEmailSentAt, null);
  assert.equal(order.lifecycleEmailLog.length, 0);
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
