const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderControllerPath = path.resolve(__dirname, '../../controllers/orderController.js');

function loadOrderController({ aggregateResponses }) {
  const pipelines = [];
  const Order = {
    aggregate: async (pipeline) => {
      pipelines.push(pipeline);
      return aggregateResponses.shift() || [];
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Order') return Order;
    if (request === 'stripe') return function Stripe() {
      return { refunds: { create: async () => ({}) } };
    };
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[orderControllerPath];
  const controller = require(orderControllerPath);
  Module._load = originalLoad;
  return { controller, pipelines };
}

function makeRes() {
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

test('getAdminSalesSummary returns sales and vendor totals without platform fee invention', async () => {
  const vendorId = '507f1f77bcf86cd799439011';
  const { controller, pipelines } = loadOrderController({
    aggregateResponses: [
      [
        {
          _id: 'USD',
          totalOrders: 3,
          grossSalesAmount: 12000,
          paidSalesAmount: 9000,
          refundedSalesAmount: 3000,
          subtotalAmount: 10000,
          taxAmount: 700,
          shippingAmount: 1300,
        },
      ],
      [{ vendorId, currency: 'USD', orderCount: 2, totalSalesAmount: 9000 }],
      [{ _id: 'paid', count: 2 }],
      [{ _id: 'ordered', count: 2 }],
    ],
  });
  const res = makeRes();

  await controller.getAdminSalesSummary(
    {
      query: {
        paymentStatus: 'paid',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.salesByCurrency, [
    {
      currency: 'USD',
      totalOrders: 3,
      grossSalesAmount: 12000,
      paidSalesAmount: 9000,
      refundedSalesAmount: 3000,
      subtotalAmount: 10000,
      taxAmount: 700,
      shippingAmount: 1300,
    },
  ]);
  assert.deepEqual(res.body.data.topVendors, [
    {
      vendorId,
      currency: 'USD',
      orderCount: 2,
      totalSalesAmount: 9000,
    },
  ]);
  assert.deepEqual(res.body.data.platformRevenue, {
    supported: false,
    amount: null,
    reason: 'Order records do not persist platform fee amounts yet.',
  });
  assert.equal(res.body.data.summary.payment.paid, 2);
  assert.equal(res.body.data.summary.payment.pending, 0);
  assert.equal(res.body.data.summary.status.ordered, 2);
  assert.equal(pipelines[0][0].$match.paymentStatus, 'paid');
  assert.ok(pipelines[0][0].$match.createdAt.$gte instanceof Date);
});

test('getAdminSalesSummary omits paid top vendors for non-paid payment filters', async () => {
  const { controller, pipelines } = loadOrderController({
    aggregateResponses: [
      [{ _id: 'USD', totalOrders: 1, grossSalesAmount: 3000, refundedSalesAmount: 3000 }],
      [{ _id: 'refunded', count: 1 }],
      [{ _id: 'refunded', count: 1 }],
    ],
  });
  const res = makeRes();

  await controller.getAdminSalesSummary(
    { query: { paymentStatus: 'refunded' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.topVendors, []);
  assert.equal(pipelines.length, 3);
  assert.equal(pipelines[0][0].$match.paymentStatus, 'refunded');
});
