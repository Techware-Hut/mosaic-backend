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

function loadRetrieveIntent({ orders = [], stripeError = null } = {}) {
  const stripeMock = {
    paymentIntents: {
      retrieve: async () => {
        if (stripeError) {
          throw stripeError;
        }
        return {
          id: paymentId,
          status: 'succeeded',
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
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[stripePaymentControllerPath];
  const { retrieveIntent } = require(stripePaymentControllerPath);
  Module._load = originalLoad;

  return { retrieveIntent };
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
