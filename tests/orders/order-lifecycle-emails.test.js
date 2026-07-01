const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderControllerPath = path.resolve(__dirname, '../../controllers/orderController.js');
const lifecycleDeliveryPath = path.resolve(
  __dirname,
  '../../utils/orderLifecycleEmailDelivery.js'
);

function createResponse() {
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

function buildOrder(overrides = {}) {
  return {
    _id: 'order-email-1',
    groupOrderId: 'MBH-ORDER-EMAIL-001',
    vendorId: 'vendor-1',
    userId: { _id: 'customer-1', email: 'customer@example.com', name: 'Customer User' },
    businessId: { stripeConnectAccountId: 'acct_test' },
    status: 'accepted',
    paymentStatus: 'paid',
    paymentId: 'pi_test',
    totalAmount: 42,
    items: [],
    statusHistory: [],
    lifecycleEmailLog: [],
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
    ...overrides,
  };
}

function buildOrderQuery(order, calls) {
  return {
    populate(field, select) {
      calls.populate.push({ field, select });
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(order).then(resolve, reject);
    },
  };
}

function loadOrderController({
  order,
  sendOrderUpdateEmail,
  sendOrderLifecycleEmail,
} = {}) {
  const calls = {
    email: [],
    populate: [],
    refundCreate: [],
  };
  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return function Stripe() {
        return {
          refunds: {
            create: async (payload) => {
              calls.refundCreate.push(payload);
              return { id: 're_test' };
            },
          },
        };
      };
    }
    if (request.endsWith('models/Order')) {
      return {
        findOne: () => buildOrderQuery(order, calls),
        find: () => ({
          sort: () => ({
            populate: () => ({
              populate: () => ({
                populate: async () => [],
              }),
            }),
          }),
        }),
      };
    }
    if (request.endsWith('models/ProductVariant')) {
      return { findById: async () => null };
    }
    if (request.endsWith('models/User') || request.endsWith('models/Business') || request.endsWith('models/Cart')) {
      return {};
    }
    if (request.endsWith('utils/checkoutGuards')) {
      return { getBusinessCheckoutBlock: async () => null };
    }
    if (request.endsWith('utils/orderPhase')) {
      return {
        sendOrderStatusEmail: async (...args) => calls.email.push(['status', ...args]),
        sendOrderUpdateEmail: sendOrderUpdateEmail || (async (...args) => {
          calls.email.push(['update', ...args]);
        }),
        sendOrderLifecycleEmail: sendOrderLifecycleEmail || (async (...args) => {
          calls.email.push(['lifecycle', ...args]);
        }),
        sendVendorNewOrderEmail: async () => {},
        sendCustomerOrderPlacedEmail: async () => {},
      };
    }
    if (request.endsWith('utils/vendorShipping')) {
      return {
        calculateShippingForVendor: () => 0,
        normalizeDeliverySpeed: (value) => value,
      };
    }
    if (request.endsWith('utils/vendorTax')) {
      return {
        getResolvedTaxCategory: () => null,
        getTaxRateForCategory: () => 0,
        buildTaxAwareAmounts: () => ({}),
        extractTaxFromInclusiveAmount: () => 0,
        roundCurrency: (value) => value,
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[orderControllerPath];
  delete require.cache[lifecycleDeliveryPath];
  const controller = require(orderControllerPath);
  Module._load = originalLoad;

  return { controller, calls };
}

test('shipOrder sends one tracking email after tracking is saved', async () => {
  const order = buildOrder({ status: 'accepted' });
  const { controller, calls } = loadOrderController({ order });
  const res = createResponse();

  await controller.shipOrder(
    {
      user: { _id: 'vendor-1' },
      params: { orderId: 'order-email-1' },
      body: { trackingId: 'TRACK-123', trackingUrl: 'https://carrier.example/track/TRACK-123' },
    },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(order.status, 'shipped');
  assert.deepEqual(order.trackingInfo, {
    trackingId: 'TRACK-123',
    trackingUrl: 'https://carrier.example/track/TRACK-123',
  });
  assert.equal(calls.email.length, 1);
  assert.deepEqual(calls.email[0], [
    'update',
    'customer@example.com',
    'shipped',
    'https://carrier.example/track/TRACK-123',
    { trackingId: 'TRACK-123' },
  ]);
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].event, 'order_shipped');
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
  assert.equal(order.saveCount, 2);
});

test('shipOrder keeps shipped state when tracking email fails', async () => {
  const order = buildOrder({ status: 'accepted' });
  const { controller } = loadOrderController({
    order,
    sendOrderUpdateEmail: async () => {
      throw new Error('SMTP unavailable');
    },
  });
  const res = createResponse();

  await controller.shipOrder(
    {
      user: { _id: 'vendor-1' },
      params: { orderId: 'order-email-1' },
      body: { trackingId: 'TRACK-FAIL', trackingUrl: 'https://carrier.example/track/TRACK-FAIL' },
    },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(res.body.emailDelivery.emailFailed, true);
  assert.equal(order.status, 'shipped');
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'failed');
  assert.ok(order.lifecycleEmailLog[0].error.includes('SMTP unavailable'));
});

test('initiateReturn sends return received email after returned state is saved', async () => {
  const order = buildOrder({ status: 'delivered' });
  const { controller, calls } = loadOrderController({ order });
  const res = createResponse();

  await controller.initiateReturn(
    {
      user: { _id: 'customer-1' },
      params: { orderId: 'order-email-1' },
    },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(order.status, 'returned');
  assert.equal(calls.email.length, 1);
  assert.deepEqual(calls.email[0], ['lifecycle', 'customer@example.com', order, 'return_initiated']);
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].event, 'return_initiated');
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
});

test('acceptReturn sends refund processed email after refund succeeds', async () => {
  const order = buildOrder({ status: 'returned', paymentStatus: 'paid' });
  const { controller, calls } = loadOrderController({ order });
  const res = createResponse();

  await controller.acceptReturn(
    {
      user: { _id: 'vendor-1' },
      params: { orderId: 'order-email-1' },
    },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(order.status, 'refunded');
  assert.equal(order.paymentStatus, 'refunded');
  assert.equal(calls.refundCreate.length, 1);
  assert.equal(calls.email.length, 1);
  assert.deepEqual(calls.email[0], ['lifecycle', 'customer@example.com', order, 'order_refunded']);
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].event, 'order_refunded');
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
});
