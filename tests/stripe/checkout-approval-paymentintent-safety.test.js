const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');

const stripePaymentControllerPath = path.resolve(
  __dirname,
  '../../controllers/stripePaymentController.js'
);
const appPath = path.resolve(__dirname, '../../app.js');

const userId = '507f1f77bcf86cd799439015';
const otherUserId = '507f1f77bcf86cd799439016';
const productId = '507f1f77bcf86cd799439013';
const paymentId = 'pi_test_retrieve_001';
const orderId = '507f1f77bcf86cd799439020';

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

function loadRetrieveIntent({
  orders = [],
  stripeError = null,
  paymentIntentStatus = 'succeeded',
  reconcileMiss = false,
  authoritativeOrder = null,
  emailResult = {
    sent: true,
    skipped: false,
    failed: false,
    emailSent: true,
    emailSkipped: false,
    emailFailed: false,
  },
} = {}) {
  const orderUpdates = [];
  let inventoryCalls = 0;
  let emailCalls = 0;

  const stripeMock = {
    paymentIntents: {
      retrieve: async () => {
        if (stripeError) {
          throw stripeError;
        }
        return {
          id: paymentId,
          status: paymentIntentStatus,
          amount: 3000,
          currency: 'usd',
          created: 1710000000,
          client_secret: 'pi_secret_should_not_leak',
          charges: { data: [{ id: 'ch_secret' }] },
          payment_method: 'pm_secret',
          transfer_data: { destination: 'acct_secret' },
          metadata: { orderId, internalNote: 'private' },
          customer: 'cus_secret',
          last_payment_error: { message: 'card declined' },
        };
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || (request.includes('node_modules') && request.replace(/\\/g, '/').includes('/stripe/'))) {
      return class Stripe {
        constructor() {
          return stripeMock;
        }
      };
    }
    if (request.endsWith('models/Order')) {
      return {
        find: () => ({
          select: () => ({
            populate: async () => orders,
          }),
        }),
        findOneAndUpdate: async (filter, update) => {
          orderUpdates.push({ filter, update });
          if (reconcileMiss) return null;
          const order = orders.find(
            (candidate) => String(candidate._id) === String(filter._id)
          );
          if (!order || order.paymentStatus === 'refunded') return null;
          if (
            order.paymentStatus === 'paid' &&
            ['rejected', 'cancelled', 'returned', 'refunded'].includes(order.status)
          ) {
            return null;
          }
          const previousPaymentStatus = order.paymentStatus;
          const previousStatus = order.status;
          order.paymentStatus = 'paid';
          if (
            previousStatus === 'created' ||
            (previousPaymentStatus === 'failed' && previousStatus === 'cancelled')
          ) {
            order.status = 'ordered';
            order.statusHistory ||= [];
            order.statusHistory.push({ status: 'ordered' });
          }
          return order;
        },
        findById: async () => authoritativeOrder,
      };
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => {
          inventoryCalls += 1;
          return { decremented: true, lines: [] };
        },
        releaseInventoryReservation: async () => ({ restored: true, lines: [] }),
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
        sendOrderPaidConfirmationIfNeeded: async () => {
          emailCalls += 1;
          return emailResult;
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[stripePaymentControllerPath];
  const { retrieveIntent } = require(stripePaymentControllerPath);
  Module._load = originalLoad;

  return {
    retrieveIntent,
    getOrderUpdates: () => orderUpdates,
    getInventoryCalls: () => inventoryCalls,
    getEmailCalls: () => emailCalls,
  };
}

test('retrieveIntent returns sanitized paymentIntent without Stripe internals', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-001',
    status: 'ordered',
    paymentStatus: 'paid',
    totalAmount: 30,
    currency: 'USD',
    items: [{
      productId: { _id: productId, title: 'Test Product' },
      quantity: 1,
      price: 25,
      size: 'M',
    }],
  }];

  const { retrieveIntent } = loadRetrieveIntent({ orders });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.paymentIntent.id, paymentId);
  assert.equal(res.body.paymentIntent.status, 'succeeded');
  assert.equal(res.body.paymentIntent.metadata.orderId, orderId);
  assert.equal(res.body.paymentIntent.charges, undefined);
  assert.equal(res.body.paymentIntent.payment_method, undefined);
  assert.equal(res.body.paymentIntent.transfer_data, undefined);
  assert.equal(res.body.paymentIntent.client_secret, undefined);
  assert.equal(res.body.paymentIntent.customer, undefined);
  assert.ok(Array.isArray(res.body.orders));
  assert.equal(res.body.orders[0].status, 'ordered');
  assert.equal(res.body.orders[0].items[0].title, 'Test Product');
  assert.equal(res.body.orders[0].userId, undefined);
  assert.deepEqual(res.body.emailDelivery, {
    emailSent: true,
    emailSkipped: false,
    emailFailed: false,
  });
});

test('retrieveIntent exposes only frontend-safe email delivery flags and warning', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-001',
    status: 'ordered',
    paymentStatus: 'paid',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];

  const { retrieveIntent } = loadRetrieveIntent({
    orders,
    emailResult: {
      sent: false,
      skipped: false,
      failed: true,
      emailSent: false,
      emailSkipped: false,
      emailFailed: true,
      emailWarning: 'paid_order_email_delivery_incomplete',
      customer: {
        status: 'failed',
        claimToken: 'claim_token_must_not_leak',
        recipients: ['customer-private@example.com'],
        messageId: 'provider-message-id-private',
        error: 'raw SMTP auth error must not leak',
      },
      vendor: {
        status: 'sent',
        recipients: ['vendor-private@example.com'],
        messageId: 'provider-message-id-private-2',
      },
      order: {
        paidOrderEmailDelivery: {
          customer: { claimToken: 'nested_claim_token_must_not_leak' },
        },
      },
    },
  });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.emailDelivery, {
    emailSent: false,
    emailSkipped: false,
    emailFailed: true,
    emailWarning: 'paid_order_email_delivery_incomplete',
  });
  assert.deepEqual(Object.keys(res.body.emailDelivery).sort(), [
    'emailFailed',
    'emailSent',
    'emailSkipped',
    'emailWarning',
  ]);

  const serialized = JSON.stringify(res.body);
  for (const privateValue of [
    'customer-private@example.com',
    'vendor-private@example.com',
    'claim_token_must_not_leak',
    'nested_claim_token_must_not_leak',
    'provider-message-id-private',
    'raw SMTP auth error must not leak',
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.equal(res.body.emailDelivery.customer, undefined);
  assert.equal(res.body.emailDelivery.vendor, undefined);
  assert.equal(res.body.emailDelivery.messageId, undefined);
  assert.equal(res.body.emailDelivery.error, undefined);
});

test('retrieveIntent blocks access when order belongs to different customer', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => otherUserId },
    groupOrderId: 'grp-001',
    status: 'ordered',
    paymentStatus: 'paid',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];

  const { retrieveIntent } = loadRetrieveIntent({ orders });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /not allowed/i);
});

test('retrieveIntent maps Stripe errors without leaking internals', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-001',
    status: 'created',
    paymentStatus: 'pending',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];

  const { retrieveIntent } = loadRetrieveIntent({
    orders,
    stripeError: new Error('No such payment_intent: pi_test_retrieve_001'),
  });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Failed to fetch payment information');
  assert.equal(res.body.error, undefined);
  assert.equal(JSON.stringify(res.body).includes('sk_'), false);
});

test('retrieveIntent reconciles pending order and decrements inventory on succeeded PI', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-001',
    status: 'created',
    paymentStatus: 'pending',
    totalAmount: 30,
    currency: 'USD',
    items: [{
      productId: { _id: productId, title: 'Test Product' },
      variantId: 'var-1',
      quantity: 1,
      price: 25,
      size: 'M',
    }],
  }];

  const { retrieveIntent, getOrderUpdates, getInventoryCalls } = loadRetrieveIntent({
    orders,
  });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(orders[0].paymentStatus, 'paid');
  assert.equal(orders[0].status, 'ordered');
  assert.equal(getOrderUpdates().length, 1);
  assert.equal(getOrderUpdates()[0].filter.paymentId, paymentId);
  assert.ok(Array.isArray(getOrderUpdates()[0].update));
  assert.equal(getInventoryCalls(), 1);
  assert.equal(res.body.orders[0].paymentStatus, 'paid');
  assert.equal(res.body.orders[0].status, 'ordered');
});

test('retrieveIntent atomically revalidates an already-paid order before idempotent effects', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-001',
    status: 'ordered',
    paymentStatus: 'paid',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];

  const { retrieveIntent, getOrderUpdates, getInventoryCalls } = loadRetrieveIntent({
    orders,
  });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(getOrderUpdates().length, 1);
  assert.equal(getInventoryCalls(), 1);
});

test('retrieveIntent skips inventory and email when atomic reconciliation loses a refund race', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-race',
    status: 'created',
    paymentStatus: 'pending',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];
  const {
    retrieveIntent,
    getOrderUpdates,
    getInventoryCalls,
    getEmailCalls,
  } = loadRetrieveIntent({
    orders,
    reconcileMiss: true,
    authoritativeOrder: {
      ...orders[0],
      status: 'refunded',
      paymentStatus: 'refunded',
    },
  });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(getOrderUpdates().length, 1);
  assert.equal(getInventoryCalls(), 0);
  assert.equal(getEmailCalls(), 0);
  assert.equal(res.body.orders[0].paymentStatus, 'refunded');
  assert.equal(res.body.orders[0].status, 'refunded');
  assert.equal(res.body.emailDelivery, undefined);
});

test('retrieveIntent does not decrement inventory when PI is not succeeded', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-001',
    status: 'created',
    paymentStatus: 'pending',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];

  const { retrieveIntent, getOrderUpdates, getInventoryCalls } = loadRetrieveIntent({
    orders,
    paymentIntentStatus: 'requires_payment_method',
  });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(getOrderUpdates().length, 0);
  assert.equal(getInventoryCalls(), 0);
  assert.equal(res.body.emailDelivery, undefined);
});

test('retrieveIntent does not reopen or email a refunded order for a succeeded PI', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const orders = [{
    _id: orderId,
    userId: { toString: () => userId },
    groupOrderId: 'grp-refunded',
    status: 'refunded',
    paymentStatus: 'refunded',
    totalAmount: 30,
    currency: 'USD',
    items: [],
  }];

  const {
    retrieveIntent,
    getOrderUpdates,
    getInventoryCalls,
    getEmailCalls,
  } = loadRetrieveIntent({ orders });
  const res = mockResponse();

  await retrieveIntent({ params: { id: paymentId }, user: { id: userId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(getOrderUpdates().length, 0);
  assert.equal(getInventoryCalls(), 0);
  assert.equal(getEmailCalls(), 0);
  assert.equal(orders[0].paymentStatus, 'refunded');
  assert.equal(orders[0].status, 'refunded');
  assert.equal(res.body.emailDelivery, undefined);
});

test('featured-products route remains canonical', () => {
  const routesSource = fs.readFileSync(
    path.resolve(__dirname, '../../routes/featuredProductRoutes.js'),
    'utf8'
  );
  const appSource = fs.readFileSync(appPath, 'utf8');

  assert.ok(routesSource.includes('/featured-products'));
  assert.ok(!routesSource.includes('/products/featured'));
  assert.ok(!appSource.includes('/api/products/featured'));
});
