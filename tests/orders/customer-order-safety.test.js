const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderControllerPath = path.resolve(__dirname, '../../controllers/orderController.js');

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

function makeOrder(overrides = {}) {
  let saveCalls = 0;
  return {
    _id: 'order-1',
    userId: { _id: 'customer-1', email: 'customer@example.com' },
    status: 'ordered',
    paymentStatus: 'pending',
    paymentId: null,
    items: [],
    statusHistory: [],
    lifecycleEmailLog: [],
    async save() {
      saveCalls += 1;
    },
    getSaveCalls() {
      return saveCalls;
    },
    ...overrides,
  };
}

function loadOrderController({
  orders = [],
  order = null,
  variant = null,
  refundError = null,
} = {}) {
  const originalLoad = Module._load;
  const calls = {
    find: [],
    findOne: [],
    populate: [],
    email: [],
    refundCreate: [],
    variantFindById: [],
    sequence: [],
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || request.replace(/\\/g, '/').includes('/stripe/')) {
      return function Stripe() {
        return {
          refunds: {
            create: async (payload) => {
              calls.sequence.push('refund');
              calls.refundCreate.push(payload);
              if (refundError) throw refundError;
              return { id: 're_test' };
            },
          },
        };
      };
    }

    if (request.endsWith('models/Order')) {
      return {
        find(filter) {
          calls.find.push(filter);
          const query = {
            sort(sortBy) {
              calls.sort = sortBy;
              return this;
            },
            populate(field, select) {
              calls.populate.push({ field, select });
              return this;
            },
            then(resolve, reject) {
              return Promise.resolve(orders).then(resolve, reject);
            },
          };
          return query;
        },
        findOne(filter) {
          calls.findOne.push(filter);
          return {
            populate(field, select) {
              calls.populate.push({ field, select });
              return Promise.resolve(order);
            },
            then(resolve, reject) {
              return Promise.resolve(order).then(resolve, reject);
            },
          };
        },
      };
    }

    if (request.endsWith('models/ProductVariant')) {
      return {
        findById: async (id) => {
          calls.sequence.push('variant');
          calls.variantFindById.push(id);
          return variant;
        },
      };
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
        sendOrderUpdateEmail: async (...args) => calls.email.push(['update', ...args]),
        sendOrderLifecycleEmail: async (...args) => calls.email.push(['lifecycle', ...args]),
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
  const controller = require(orderControllerPath);
  Module._load = originalLoad;

  return { controller, calls };
}

test('getUserOrders scopes reads to the authenticated customer and excludes created drafts', async () => {
  const { controller, calls } = loadOrderController({ orders: [] });
  const res = mockResponse();

  await controller.getUserOrders({ user: { _id: 'customer-1' }, query: {} }, res);

  assert.deepEqual(calls.find, [
    {
      userId: 'customer-1',
      status: { $ne: 'created' },
    },
  ]);
  assert.deepEqual(calls.populate, [
    { field: 'vendorId', select: 'name' },
    { field: 'items.productId', select: 'title coverImage' },
    { field: 'items.variantId', select: 'color sizes images' },
  ]);
  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(res.body.count, 0);
});

test('getUserOrders applies optional status filter while keeping customer scope', async () => {
  const { controller, calls } = loadOrderController({ orders: [] });
  const res = mockResponse();

  await controller.getUserOrders(
    { user: { id: 'customer-2' }, query: { status: 'delivered' } },
    res
  );

  assert.deepEqual(calls.find, [
    {
      userId: 'customer-2',
      status: 'delivered',
    },
  ]);
});

test('cancelOrderByUser does not restore accepted-order stock when refund fails', async () => {
  const order = makeOrder({
    status: 'accepted',
    paymentStatus: 'paid',
    paymentId: 'pi_failed',
    items: [{ variantId: 'variant-1', size: 'M', quantity: 2 }],
  });
  const { controller, calls } = loadOrderController({
    order,
    refundError: new Error('Stripe unavailable'),
  });
  const res = mockResponse();

  await controller.cancelOrderByUser(
    { user: { _id: 'customer-1' }, params: { orderId: 'order-1' } },
    res
  );

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.message, 'Failed to process refund. Please try again or contact support.');
  assert.deepEqual(calls.findOne, [{ _id: 'order-1', userId: 'customer-1' }]);
  assert.equal(calls.refundCreate.length, 1);
  assert.deepEqual(calls.variantFindById, []);
  assert.deepEqual(calls.sequence, ['refund']);
  assert.equal(order.status, 'accepted');
  assert.equal(order.paymentStatus, 'paid');
  assert.deepEqual(order.statusHistory, []);
  assert.deepEqual(calls.email, []);
  assert.equal(order.getSaveCalls(), 0);
});

test('cancelOrderByUser restores accepted-order stock after successful refund', async () => {
  const size = { size: 'M', stock: 3 };
  const variant = {
    sizes: [size],
    async save() {
      this.saveCalls = (this.saveCalls || 0) + 1;
    },
  };
  const order = makeOrder({
    status: 'accepted',
    paymentStatus: 'paid',
    paymentId: 'pi_success',
    items: [{ variantId: 'variant-1', size: 'M', quantity: 2 }],
  });
  const { controller, calls } = loadOrderController({ order, variant });
  const res = mockResponse();

  await controller.cancelOrderByUser(
    { user: { id: 'customer-1' }, params: { orderId: 'order-1' } },
    res
  );

  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(calls.sequence[0], 'refund');
  assert.equal(calls.sequence[1], 'variant');
  assert.deepEqual(calls.refundCreate, [
    {
      payment_intent: 'pi_success',
      reason: 'requested_by_customer',
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: {
        custom_reason: 'order_cancelled_by_user',
        order_id: 'order-1',
      },
    },
  ]);
  assert.equal(size.stock, 5);
  assert.equal(variant.saveCalls, 1);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.paymentStatus, 'refunded');
  assert.deepEqual(order.statusHistory, [{ status: 'cancelled' }]);
  assert.equal(order.lifecycleEmailLog.length, 1);
  assert.equal(order.lifecycleEmailLog[0].event, 'order_cancelled');
  assert.equal(order.lifecycleEmailLog[0].deliveryStatus, 'sent');
  assert.equal(res.body.order.lifecycleEmailLog, undefined);
  assert.equal(calls.email.length, 1);
  assert.equal(calls.email[0][0], 'lifecycle');
  assert.equal(calls.email[0][1], 'customer@example.com');
  assert.equal(calls.email[0][3], 'order_cancelled');
  assert.equal(order.getSaveCalls(), 2);
});
