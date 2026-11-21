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
  getStatusEmailCalls,
  getCancelledSmsCalls,
  setStripeShouldFail,
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
    slug: `synthetic-${businessId}`,
    stripeConnectAccountId: 'acct_synthetic_vendor',
  });

  await ProductVariant.collection.insertOne({
    _id: variantId,
    productId: new mongoose.Types.ObjectId(),
    businessId,
    ownerId: vendorId,
    attributes: { size: 'M' },
    sku: `SYN-REJECT-${variantId}`,
    price: mongoose.Types.Decimal128.fromString('12.50'),
    stock: START_STOCK,
    isPublished: true,
    isDeleted: false,
  });

  const userId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('users').insertOne({ _id: userId, email: `synthetic-${userId}@example.com`, name: 'Synthetic Customer', mobile: '+12025550199' });
  const order = await Order.create({
    groupOrderId: `grp_synthetic_${variantId}`,
    userId,
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

test('concurrent double-submit: one refund, one restock, losers get 409', async () => {
  const { order, vendorId, variantId } = await seedPaidOrder();

  const results = await Promise.all(
    Array.from({ length: 5 }, () => rejectAs(vendorId, order._id))
  );
  const codes = results.map((r) => r.statusCode).sort();

  assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one winner, got ${codes}`);
  assert.ok(codes.every((c) => c === 200 || c === 409 || c === 400), `unexpected codes ${codes}`);
  assert.equal(getStripeRefundCalls().length, 1, 'Stripe refund called once');
  assert.equal(getStatusEmailCalls().length, 1);
  assert.equal(getCancelledSmsCalls().length, 1);
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
  assert.equal(getStatusEmailCalls().length, 1);
  assert.equal(getStripeRefundCalls().length, 1);
  assert.equal(await stockOf(variantId), START_STOCK + QTY);
});

test('retry after the order save failed reuses the refund and does not restock again', async () => {
  const { order, vendorId, variantId } = await seedPaidOrder();

  // Simulate a crash between "refund + restock" and persisting the order.
  const realSave = Order.updateOne;
  let failNext = true;
  Order.updateOne = function flakySave(...args) {
    if (failNext && args[1]?.$set?.status === "rejected") {
      failNext = false;
      return Promise.reject(new Error('synthetic write failure'));
    }
    return realSave.apply(this, args);
  };

  let first;
  let retry;
  try {
    first = await rejectAs(vendorId, order._id);
    const interrupted = await Order.findById(order._id).lean();
    assert.equal(interrupted.status, 'ordered');
    assert.equal(interrupted.paymentStatus, 'refunded');
    assert.ok(interrupted.rejectionRefundId);
    assert.ok(interrupted.rejectionRefundedAt);
    retry = await rejectAs(vendorId, order._id);
  } finally {
    Order.updateOne = realSave;
  }

  assert.equal(first.statusCode, 500, 'first attempt fails on save');
  assert.equal(retry.statusCode, 200, 'retry completes the rejection');

  const calls = getStripeRefundCalls();
  assert.equal(calls.length, 1, 'durable evidence skips Stripe');
  assert.equal(calls[0].idempotencyKey, `refund:${order._id}:rejected_by_merchant`);

  assert.equal(getStripeRefundsCreated(), 1, 'but only one refund exists');

  assert.equal(await stockOf(variantId), START_STOCK + QTY, 'stock restored exactly once');
  assert.equal(retry.body.inventoryRestore, 'not_needed');

  const saved = await Order.findById(order._id).lean();
  assert.equal(saved.status, 'rejected');
  assert.equal(saved.paymentStatus, 'refunded');
});

test('restock failure preserves reconciliation marker', async () => {
 const {order,vendorId,variantId}=await seedPaidOrder();
 await ProductVariant.deleteOne({_id:variantId});
 const result=await rejectAs(vendorId,order._id);
 assert.equal(result.statusCode,200);
 assert.equal(result.body.inventoryRestore,'failed');
 const saved=await Order.findById(order._id).lean();
 assert.equal(saved.status,'rejected'); assert.equal(saved.paymentStatus,'refunded');
 assert.ok(saved.inventoryDecrementedAt); assert.equal(saved.inventoryRestoredAt,null);
 assert.equal(saved.transitionLockedAt,null);
});
test('refund failure leaves status and stock unchanged and releases lock', async () => {
 const {order,vendorId,variantId}=await seedPaidOrder(); setStripeShouldFail(true);
 const result=await rejectAs(vendorId,order._id);
 assert.equal(result.statusCode,500); assert.equal(result.body.message,'Refund failed');
 const saved=await Order.findById(order._id).lean();
 assert.equal(saved.status,'ordered'); assert.equal(saved.paymentStatus,'paid');
 assert.equal(saved.transitionLockedAt,null); assert.equal(await stockOf(variantId),START_STOCK);
 assert.equal(getStatusEmailCalls().length,0);
});
test('unpaid rejection restores only decremented stock', async () => {
 for(const decremented of [true,false]) {
 const {order,vendorId,variantId}=await seedPaidOrder();
 await Order.updateOne({_id:order._id},{$set:{paymentStatus:'pending',inventoryDecrementedAt:decremented?new Date():null}});
 const result=await rejectAs(vendorId,order._id); assert.equal(result.statusCode,200);
 assert.equal(result.body.inventoryRestore,decremented?'restored':'not_needed');
 assert.equal(await stockOf(variantId),START_STOCK+(decremented?QTY:0));
 } assert.equal(getStripeRefundCalls().length,0);
});
test('another vendor gets 404 without side effects', async () => {
 const {order,variantId}=await seedPaidOrder();
 const result=await rejectAs(new mongoose.Types.ObjectId(),order._id);
 assert.equal(result.statusCode,404); assert.equal(getStripeRefundCalls().length,0);
 assert.equal(getStatusEmailCalls().length,0); assert.equal(await stockOf(variantId),START_STOCK);
});

// Inject writes at the persistence boundary, keeping real Mongo claim semantics.
test('Stripe success followed by evidence failure retries one idempotent refund', async () => {
  const {order,vendorId,variantId}=await seedPaidOrder();
  const real=Order.updateOne; let fail=true;
  Order.updateOne=function(...args) {
    if(fail && args[1]?.$set?.rejectionRefundedAt) { fail=false; throw new Error('evidence unavailable'); }
    return real.apply(this,args);
  };
  try {
    const first=await rejectAs(vendorId,order._id);
    assert.equal(first.statusCode,500); assert.equal(first.body.code,'ORDER_REJECT_RECONCILE');
    assert.equal(getStatusEmailCalls().length,0);
    assert.equal((await rejectAs(vendorId,order._id)).statusCode,200);
  } finally {Order.updateOne=real;}
  const saved=await Order.findById(order._id).lean();
  assert.equal(saved.status,'rejected'); assert.equal(saved.paymentStatus,'refunded');
  assert.equal(saved.statusHistory.filter(e=>e.status==='refunded').length,1);
  assert.equal(getStripeRefundsCreated(),1); assert.equal(getStatusEmailCalls().length,1);
  assert.equal(await stockOf(variantId),START_STOCK+QTY);
});

test('stale owner cannot write evidence or notify after takeover', async () => {
  const {order,vendorId}=await seedPaidOrder(); const real=Order.updateOne; let takeover=true;
  Order.updateOne=async function(...args) {
    if(takeover && args[1]?.$set?.rejectionRefundedAt) {
      takeover=false;
      await real.call(this,{_id:order._id},{$set:{transitionLockedAt:new Date(Date.now()-600000)}});
      assert.equal((await rejectAs(vendorId,order._id)).statusCode,200);
    }
    return real.apply(this,args);
  };
  try {const result=await rejectAs(vendorId,order._id); assert.equal(result.statusCode,409); assert.equal(result.body.code,'ORDER_TRANSITION_CONFLICT');}
  finally {Order.updateOne=real;}
  assert.equal(getStripeRefundsCreated(),1); assert.equal(getStatusEmailCalls().length,1);
});

test('not_decremented restore result preserves local reconciliation marker', async () => {
  const {order,vendorId,variantId}=await seedPaidOrder();
  await Order.updateOne({_id:order._id},{$set:{inventoryRestoredAt:new Date()}});
  const result=await rejectAs(vendorId,order._id);
  assert.equal(result.statusCode,200); assert.equal(result.body.inventoryRestore,'not_needed');
  assert.ok((await Order.findById(order._id).lean()).inventoryDecrementedAt);
  assert.equal(await stockOf(variantId),START_STOCK);
});

test('previous pending refund recovers charge_already_refunded', async () => {
  const {order,vendorId}=await seedPaidOrder();
  await Order.updateOne({_id:order._id},{$set:{rejectionRefundRequestedAt:new Date()}});
  require('./helpers/providerStubs').setStripeRefundErrorCode('charge_already_refunded');
  const result=await rejectAs(vendorId,order._id); assert.equal(result.statusCode,200);
  const saved=await Order.findById(order._id).lean();
  assert.equal(saved.status,'rejected'); assert.equal(saved.paymentStatus,'refunded');
  assert.equal(saved.rejectionRefundId,null); assert.ok(saved.rejectionRefundedAt);
});

test('final transition losing ownership sends no notifications', async () => {
  const {order,vendorId}=await seedPaidOrder(); const real=Order.updateOne;
  Order.updateOne=async function(...args) {
    if(args[1]?.$set?.status==='rejected') {
      await real.call(this,{_id:order._id},{$set:{transitionLockedAt:new Date(Date.now()+10000)}});
    }
    return real.apply(this,args);
  };
  try {assert.equal((await rejectAs(vendorId,order._id)).statusCode,409);}
  finally {Order.updateOne=real;}
  assert.equal(getStatusEmailCalls().length,0); assert.equal(getCancelledSmsCalls().length,0);
  assert.equal((await Order.findById(order._id).lean()).status,'ordered');
});
