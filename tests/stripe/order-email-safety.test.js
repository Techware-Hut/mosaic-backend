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

function loadPostPaymentWebhook({ orders = [], mailShouldFail = false } = {}) {
  let emailSendCount = 0;

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
      retrieve: async () => ({
        transfer: 'tr_test_001',
        application_fee: 'fee_test_001',
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
        find: () => ({
          populate: async () => orders,
        }),
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
});

test('initiateOrder no longer sends pre-payment customer or vendor emails', () => {
  const source = fs.readFileSync(orderControllerPath, 'utf8');

  assert.ok(!source.includes('sendCustomerOrderPlacedEmail'));
  assert.ok(!source.includes('sendVendorNewOrderEmail'));
});
