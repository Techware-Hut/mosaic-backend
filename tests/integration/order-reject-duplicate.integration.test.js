// Duplicate rejection of a PAID order, against a real Mongo replica set
// (transactions on) and a mocked Stripe client. All data is synthetic.
//
// Invariants:
//   1. Stock decremented at payment is restored exactly once.
//   2. A double-submit or retry never creates a second Stripe refund.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  startHarness,
  resetDatabase,
  stopHarness,
} = require('./setup/harness');
const {
  getStripeRefundCalls,
  getStripeRefundsCreated,
} = require('./helpers/providerStubs');

let Order;
let ProductVariant;
let orderController;

const START_STOCK = 4; // units left on the shelf after this order was paid
const QTY = 2;

test.before(async () => {
  await startHarness({ transactions: true });
  Order = require('../../models/Order');
  ProductVariant = require('../../models/ProductVariant');
  orderController = require('../../controllers/orderController');
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function seedPaidOrder() {
  const vendorId = new mongoose.Types.ObjectId();
  const businessId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();

  await mongoose.connection.collection('businesses').insertOne({
    _id: businessId,
    ownerId: vendorId,
    businessName: 'Synthetic Reject Shop',
    stripeConnectAccountId: 'acct_synthetic_vendor',
  });

  await ProductVariant.collection.insertOne({
    _id: variantId,
    productId: new mongoose.Types.ObjectId(),
    businessId,
    ownerId: vendorId,
    attributes: { size: 'M' },
    sku: 'SYN-REJECT-1',
    price: mongoose.Types.Decimal128.fromString('12.50'),
    stock: START_STOCK,
    isPublished: true,
    isDeleted: false,
  });

  // userId points at no user: no customer email/SMS is attempted.
  const order = await Order.create({
    groupOrderId: `grp_synthetic_${variantId}`,
    userId: new mongoose.Types.ObjectId(),
    vendorId,
    businessId,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId,
        color: 'Blue',
        size: 'M',
        quantity: QTY,
        price: 12.5,
      },
    ],
    totalAmount: 25,
    subtotalAmount: 25,
    status: 'ordered',
    paymentStatus: 'paid',
    paymentId: 'pi_synthetic_reject',
    inventoryReservedAt: new Date(),
    inventoryDecrementedAt: new Date(),
  });

  return { order, vendorId, variantId };
}

function rejectAs(vendorId, orderId) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return orderController
    .rejectOrder({ user: { _id: vendorId }, params: { orderId: String(orderId) } }, res)
    .then(() => res);
}

async function stockOf(variantId) {
  return (await ProductVariant.findById(variantId).lean()).stock;
}

test('concurrent double-submit: one refund, one restock, loser gets 409/400', async () => {
  const { order, vendorId, variantId } = await seedPaidOrder();

  const results = await Promise.all(
    Array.from({ length: 5 }, () => rejectAs(vendorId, order._id))
  );
  const codes = results.map((r) => r.statusCode).sort();

  assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one winner, got ${codes}`);
  assert.ok(codes.every((c) => c === 200 || c === 409 || c === 400), `unexpected codes ${codes}`);
  assert.equal(getStripeRefundCalls().length, 1, 'Stripe refund called once');
  assert.equal(await stockOf(variantId), START_STOCK + QTY, 'stock restored exactly once');

  const saved = await Order.findById(order._id).lean();
  assert.equal(saved.status, 'rejected');
  assert.equal(saved.paymentStatus, 'refunded');
  assert.ok(saved.inventoryRestoredAt, 'restore is recorded');
  assert.equal(saved.inventoryDecrementedAt, undefined);
  assert.equal(saved.transitionLockedAt, null, 'lock released');
});

test('sequential retry after success is refused before Stripe and stock', async () => {
  const { order, vendorId, variantId } = await seedPaidOrder();

  const first = await rejectAs(vendorId, order._id);
  const retry = await rejectAs(vendorId, order._id);

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.inventoryRestore, 'restored');
  assert.equal(retry.statusCode, 400);
  assert.equal(getStripeRefundCalls().length, 1);
  assert.equal(await stockOf(variantId), START_STOCK + QTY);
});

test('retry after the order save failed reuses the refund and does not restock again', async () => {
  const { order, vendorId, variantId } = await seedPaidOrder();

  // Simulate a crash between "refund + restock" and persisting the order.
  const realSave = Order.prototype.save;
  let failNext = true;
  Order.prototype.save = function flakySave(...args) {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error('synthetic write failure'));
    }
    return realSave.apply(this, args);
  };

  let first;
  let retry;
  try {
    first = await rejectAs(vendorId, order._id);
    retry = await rejectAs(vendorId, order._id);
  } finally {
    Order.prototype.save = realSave;
  }

  assert.equal(first.statusCode, 500, 'first attempt fails on save');
  assert.equal(retry.statusCode, 200, 'retry completes the rejection');

  const calls = getStripeRefundCalls();
  assert.equal(calls.length, 2, 'Stripe was asked twice');
  assert.equal(calls[0].idempotencyKey, `refund:${order._id}:rejected_by_merchant`);
  assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey, 'retry reuses the key');
  assert.equal(getStripeRefundsCreated(), 1, 'but only one refund exists');

  assert.equal(await stockOf(variantId), START_STOCK + QTY, 'stock restored exactly once');
  assert.equal(retry.body.inventoryRestore, 'not_needed');

  const saved = await Order.findById(order._id).lean();
  assert.equal(saved.status, 'rejected');
  assert.equal(saved.paymentStatus, 'refunded');
});
