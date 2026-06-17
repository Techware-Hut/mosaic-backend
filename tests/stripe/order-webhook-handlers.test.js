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
          };
        },
      };
    }
    if (request.endsWith('models/Subscription')) {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[webhookControllerPath];
  const { handleStripeWebhook } = require(webhookControllerPath);
  Module._load = originalLoad;

  return { handleStripeWebhook, getUpdates: () => updates };
}

function loadFailedPaymentWebhook() {
  const updates = [];
  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: PAYMENT_ID,
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
        findByIdAndUpdate: async (id, update) => {
          updates.push({ id, update });
          return { _id: id, ...update };
        },
      };
    }
    if (request.endsWith('models/Subscription')) {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[webhookControllerPath];
  const { handleStripeWebhook } = require(webhookControllerPath);
  Module._load = originalLoad;

  return { handleStripeWebhook, getUpdates: () => updates };
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

test('order status webhook marks order paid and ordered on payment_intent.succeeded', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates } = loadOrderStatusWebhook();
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

test('order status webhook marks failed payment as cancelled', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates } = loadFailedPaymentWebhook();
  const res = mockResponse();

  await handleStripeWebhook(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: Buffer.from('{}'),
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(getUpdates()[0].update.paymentStatus, 'failed');
  assert.equal(getUpdates()[0].update.status, 'cancelled');
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
