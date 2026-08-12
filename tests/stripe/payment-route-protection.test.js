const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const paymentRoutesPath = path.resolve(__dirname, '../../routes/paymentRoutes.js');
const stripeRoutesPath = path.resolve(__dirname, '../../routes/stripe.routes.js');
const orderRoutesPath = path.resolve(__dirname, '../../routes/orderRoutes.js');
const paymentControllerPath = path.resolve(__dirname, '../../controllers/paymentController.js');
const ownershipPath = path.resolve(__dirname, '../../utils/stripeConnectOwnership.js');
const authenticatePath = path.resolve(__dirname, '../../middlewares/authenticate.js');

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

test('paymentRoutes wires authenticate and isCustomer before create-payment-intent', () => {
  const source = fs.readFileSync(paymentRoutesPath, 'utf8');
  const routeBlock = source.slice(source.indexOf("'/create-payment-intent'"));

  assert.ok(routeBlock.includes('authenticate'));
  assert.ok(routeBlock.includes('isCustomer'));
  assert.ok(routeBlock.indexOf('authenticate') < routeBlock.indexOf('createPaymentIntent'));
});

test('stripe.routes wires auth middleware on Connect helper routes', () => {
  const source = fs.readFileSync(stripeRoutesPath, 'utf8');

  assert.match(source, /router\.post\('\/account-session', authenticate, isBusinessOwner/);
  assert.match(source, /router\.post\('\/express-login-link', authenticate, isBusinessOwner/);
  assert.match(source, /router\.get\('\/account-balance', authenticate, isBusinessOwner/);
  assert.match(source, /router\.get\('\/last-payout', authenticate, isBusinessOwner/);
  assert.match(source, /router\.post\('\/backfill-customers', authenticate, isAdmin/);
});

test('orderRoutes requires customer role for initiate checkout', () => {
  const source = fs.readFileSync(orderRoutesPath, 'utf8');
  assert.match(source, /router\.post\('\/initiate', authenticate, isCustomer, initiateOrder\)/);
});

test('authenticate rejects unauthenticated payment route access', async () => {
  const authenticate = require(authenticatePath);
  const res = mockResponse();
  let calledNext = false;

  await authenticate({ headers: {}, cookies: {} }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
});

test('createPaymentIntent rejects orders owned by another customer', async () => {
  const ORDER_ID = '507f1f77bcf86cd799439011';
  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Order') {
      return {
        findById: async () => ({
          _id: ORDER_ID,
          userId: '507f1f77bcf86cd799439099',
          paymentStatus: 'pending',
          totalAmount: 25,
          currency: 'USD',
        }),
      };
    }
    if (request === 'stripe') {
      return () => ({
        paymentIntents: { create: async () => ({ id: 'pi_should_not_run', client_secret: 'secret' }) },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[paymentControllerPath];
  const { createPaymentIntent } = require(paymentControllerPath);
  Module._load = originalLoad;

  const res = mockResponse();
  await createPaymentIntent(
    {
      body: { orderId: ORDER_ID },
      user: { id: '507f1f77bcf86cd799439012' },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /Not allowed/i);
});

test('assertConnectAccountOwnedByUser returns 403 for foreign Connect account', async () => {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request.endsWith('models/Business')) {
      return {
        findOne: () => ({
          select: async () => null,
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[ownershipPath];
  const { assertConnectAccountOwnedByUser } = require(ownershipPath);
  Module._load = originalLoad;

  const result = await assertConnectAccountOwnedByUser('acct_foreign', '507f1f77bcf86cd799439012');
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('app.js keeps Stripe webhook raw-body mounts before express.json', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  const jsonIndex = source.indexOf('app.use(express.json');
  const vendorWebhookIndex = source.indexOf("app.use('/api/vendor-onboarding/webhook/payment'");
  const stripeWebhookIndex = source.indexOf("app.use('/api/stripe'");

  assert.ok(jsonIndex > -1, 'express.json middleware must exist in app.js');
  assert.ok(vendorWebhookIndex > -1 && vendorWebhookIndex < jsonIndex);
  assert.ok(stripeWebhookIndex > -1 && stripeWebhookIndex < jsonIndex);
});
