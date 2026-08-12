const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const webhookControllerPath = path.resolve(__dirname, '../../controllers/webhookController.js');

const ORDER_ID = '507f1f77bcf86cd799439020';
const CHARGE_ID = 'ch_test_refund_001';
const PAYMENT_ID = 'pi_test_refund_001';

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

function loadChargeRefundedWebhook({
  orderIdInMetadata,
  paymentIntentId = PAYMENT_ID,
  persistedPaymentId = PAYMENT_ID,
  refunded = true,
  amount = 3000,
  amountRefunded = amount,
} = {}) {
  const updates = [];
  let inventoryRestoreCalls = 0;
  const stripeMock = {
    webhooks: {
      constructEvent: () => ({
        type: 'charge.refunded',
        data: {
          object: {
            id: CHARGE_ID,
            payment_intent: paymentIntentId,
            amount,
            amount_refunded: amountRefunded,
            refunded,
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
        findOneAndUpdate: async (filter, update) => {
          updates.push({ filter, update });
          if (
            String(filter._id) !== ORDER_ID ||
            filter.paymentId !== persistedPaymentId
          ) {
            return null;
          }
          return { _id: ORDER_ID, paymentId: persistedPaymentId, ...update.$set };
        },
      };
    }
    if (request.endsWith('models/Subscription')) {
      return {};
    }
    if (request.endsWith('utils/sendOrderPaidConfirmation')) {
      return {
        sendOrderPaidConfirmationIfNeeded: async () => ({
          sent: false,
          skipped: true,
        }),
      };
    }
    if (request.endsWith('lib/inventory/orderInventory')) {
      return {
        decrementInventoryForPaidOrder: async () => ({ decremented: false }),
        releaseInventoryReservation: async () => ({ restored: false }),
        restoreInventoryForRefundedOrder: async () => {
          inventoryRestoreCalls += 1;
          return { restored: true };
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
    getInventoryRestoreCalls: () => inventoryRestoreCalls,
  };
}

test('charge.refunded webhook marks order refunded when charge metadata includes orderId', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates, getInventoryRestoreCalls } =
    loadChargeRefundedWebhook({ orderIdInMetadata: ORDER_ID });
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
  assert.equal(String(getUpdates()[0].filter._id), ORDER_ID);
  assert.equal(getUpdates()[0].filter.paymentId, PAYMENT_ID);
  assert.equal(
    Object.hasOwn(getUpdates()[0].filter, 'paymentStatus'),
    false,
    'a fully refunded charge must win even when its webhook arrives before payment success reconciliation'
  );
  assert.equal(getUpdates()[0].update.$set.paymentStatus, 'refunded');
  assert.equal(getUpdates()[0].update.$set.status, 'refunded');
  assert.equal(getInventoryRestoreCalls(), 1);
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
  assert.equal(getUpdates().length, 0);
});

test('charge.refunded webhook cannot refund a mismatched authoritative order', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates, getInventoryRestoreCalls } = loadChargeRefundedWebhook({
    orderIdInMetadata: ORDER_ID,
    paymentIntentId: 'pi_mismatched_refund',
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
  assert.equal(getUpdates()[0].filter.paymentId, 'pi_mismatched_refund');
  assert.equal(getInventoryRestoreCalls(), 0);
});

test('charge.refunded webhook does not close a whole order for a partial refund', async () => {
  process.env.STRIPE_ORDER_WEBHOOK_SECRET = 'whsec_order_test';
  const { handleStripeWebhook, getUpdates, getInventoryRestoreCalls } = loadChargeRefundedWebhook({
    orderIdInMetadata: ORDER_ID,
    refunded: false,
    amount: 3000,
    amountRefunded: 1000,
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
  assert.equal(getUpdates().length, 0);
  assert.equal(getInventoryRestoreCalls(), 0);
});
