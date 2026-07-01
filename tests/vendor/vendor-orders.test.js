const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderControllerPath = path.resolve(__dirname, '../../controllers/orderController.js');
const vendorId = '507f1f77bcf86cd799439011';

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

function loadOrderController({ orders = [], order = null } = {}) {
  const originalLoad = Module._load;
  let capturedFilter = null;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || (request.includes('node_modules') && request.replace(/\\/g, '/').includes('/stripe/'))) {
      return class Stripe {
        constructor() {
          this.refunds = { create: async () => ({ id: 're_test' }) };
        }
      };
    }
    if (request.endsWith('models/Order')) {
      return {
        find: (filter) => {
          capturedFilter = filter;
          return {
            sort: () => ({
              populate: () => ({
                populate: () => ({
                  populate: async () => orders,
                }),
              }),
            }),
          };
        },
        findOne: () => ({
          populate: async () => order,
        }),
      };
    }
    if (request.endsWith('models/ProductVariant')) {
      return { findById: async () => null };
    }
    if (request.endsWith('models/User')) {
      return {};
    }
    if (request.endsWith('models/Business')) {
      return {};
    }
    if (request.endsWith('models/Cart')) {
      return {};
    }
    if (request.endsWith('utils/orderPhase')) {
      return {
        sendOrderStatusEmail: async () => {},
        sendOrderUpdateEmail: async () => {},
        sendOrderLifecycleEmail: async () => {},
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

  return { controller, getCapturedFilter: () => capturedFilter };
}

test('getVendorOrders scopes query to authenticated vendor and paid statuses', async () => {
  const { controller, getCapturedFilter } = loadOrderController({ orders: [] });
  const res = mockResponse();

  await controller.getVendorOrders({ user: { _id: vendorId }, query: {} }, res);

  const filter = getCapturedFilter();
  assert.equal(String(filter.vendorId), String(vendorId));
  assert.deepEqual(filter.paymentStatus.$in, ['paid', 'refunded']);
  assert.equal(res.statusCode, null);
  assert.equal(res.body.success, true);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.orders, []);
});

test('getVendorOrders applies optional status and businessId filters', async () => {
  const { controller, getCapturedFilter } = loadOrderController({ orders: [] });
  const res = mockResponse();

  await controller.getVendorOrders(
    {
      user: { _id: vendorId },
      query: { status: 'ordered', businessId: 'biz-1' },
    },
    res
  );

  const filter = getCapturedFilter();
  assert.equal(filter.status, 'ordered');
  assert.equal(filter.businessId, 'biz-1');
});

test('acceptOrder returns 404 when order belongs to another vendor', async () => {
  const { controller } = loadOrderController({ order: null });
  const res = mockResponse();

  await controller.acceptOrder(
    {
      user: { _id: vendorId },
      params: { orderId: 'order-1' },
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /not found or unauthorized/i);
});

test('acceptOrder rejects non-ordered status', async () => {
  const { controller } = loadOrderController({
    order: {
      _id: 'order-1',
      vendorId,
      status: 'shipped',
      items: [],
    },
  });
  const res = mockResponse();

  await controller.acceptOrder(
    {
      user: { _id: vendorId },
      params: { orderId: 'order-1' },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Only "ordered" orders can be accepted/);
});
