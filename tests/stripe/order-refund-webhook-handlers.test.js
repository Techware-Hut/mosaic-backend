const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const webhookControllerPath = path.resolve(__dirname, '../../controllers/webhookController.js');

const ORDER_ID = '507f1f77bcf86cd799439020';
const CHARGE_ID = 'ch_test_refund_001';

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadChargeRefundedWebhook({ orderIdInMetadata } = {}) {
  const updates = [];
  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: 'charge.refunded',
        data: {
          object: {
            id: CHARGE_ID,
            metadata: orderIdInMetadata ? { orderId: orderIdInMetadata } : {},
          },
        },
      }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return function StripeClient() {
        return stripeMock;
      };
    }
    if (request.endsWith('models/Order')) {
      return {
        findByIdAndUpdate: async (id, update) => {
          updates.push({ id, update });
          return id ? { _id: id, ...update } : null;
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

test('charge.refunded webhook marks order refunded when charge metadata includes orderId', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates } = loadChargeRefundedWebhook({
    orderIdInMetadata: ORDER_ID,
  });
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
  assert.equal(String(getUpdates()[0].id), ORDER_ID);
  assert.equal(getUpdates()[0].update.paymentStatus, 'refunded');
  assert.equal(getUpdates()[0].update.status, 'refunded');
});

test('charge.refunded webhook does not update order when charge metadata lacks orderId', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates } = loadChargeRefundedWebhook({
    orderIdInMetadata: undefined,
  });
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
  assert.equal(getUpdates()[0].id, undefined);
});
