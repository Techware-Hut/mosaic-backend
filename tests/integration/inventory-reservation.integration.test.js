const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const {
  startHarness,
  resetDatabase,
  stopHarness,
} = require('./setup/harness');

let Order;
let ProductVariant;
let inventory;
let app;

test.before(async () => {
  app = await startHarness({ transactions: true });
  Order = require('../../models/Order');
  ProductVariant = require('../../models/ProductVariant');
  inventory = require('../../lib/inventory/orderInventory');
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

async function insertVariant(stock, sku = 'INV-RACE-1') {
  const _id = new mongoose.Types.ObjectId();
  await ProductVariant.collection.insertOne({
    _id,
    productId: new mongoose.Types.ObjectId(),
    businessId: new mongoose.Types.ObjectId(),
    ownerId: new mongoose.Types.ObjectId(),
    attributes: { size: 'M' },
    sku,
    price: mongoose.Types.Decimal128.fromString('10.00'),
    stock,
    isPublished: true,
    isDeleted: false,
  });
  return _id;
}

async function insertOrder(variantId, quantity = 1) {
  return insertOrderItems([{ variantId, size: 'M', quantity }]);
}

async function insertOrderItems(items) {
  const _id = new mongoose.Types.ObjectId();
  await Order.collection.insertOne({
    _id,
    items,
    inventoryReservedAt: null,
    inventoryDecrementedAt: null,
    inventoryRestoredAt: null,
    inventoryAdjustments: [],
  });
  return Order.findById(_id);
}

test('real Mongo conditional updates let only one buyer reserve the final unit', async () => {
  const variantId = await insertVariant(1);
  const firstOrder = await insertOrder(variantId);
  const secondOrder = await insertOrder(variantId);

  const results = await Promise.all([
    inventory.reserveInventoryForOrder(firstOrder),
    inventory.reserveInventoryForOrder(secondOrder),
  ]);

  assert.equal(results.filter((result) => result.reserved).length, 1);
  assert.equal(
    results.filter((result) => result.reason === 'insufficient_stock').length,
    1
  );
  assert.equal((await ProductVariant.findById(variantId)).stock, 0);

  const winningOrder = results[0].reserved ? firstOrder : secondOrder;
  const finalized = await inventory.decrementInventoryForPaidOrder(winningOrder);
  const replay = await inventory.decrementInventoryForPaidOrder(winningOrder);

  assert.equal(finalized.reason, 'reservation_finalized');
  assert.equal(replay.reason, 'already_decremented');
  assert.equal((await ProductVariant.findById(variantId)).stock, 0);
});

test('real Mongo legacy paid-time fallback rejects a second buyer of the final unit', async () => {
  const variantId = await insertVariant(1, 'INV-LEGACY-RACE');
  const firstOrder = await insertOrder(variantId);
  const secondOrder = await insertOrder(variantId);

  const results = await Promise.all([
    inventory.decrementInventoryForPaidOrder(firstOrder),
    inventory.decrementInventoryForPaidOrder(secondOrder),
  ]);

  assert.equal(results.filter((result) => result.decremented).length, 1);
  assert.equal(
    results.filter((result) => result.reason === 'insufficient_stock').length,
    1
  );
  assert.equal((await ProductVariant.findById(variantId)).stock, 0);
});

test('real Mongo transaction rolls line one back when line two cannot reserve', async () => {
  const firstVariantId = await insertVariant(2, 'INV-MULTI-1');
  const missingVariantId = new mongoose.Types.ObjectId();
  const order = await insertOrderItems([
    { variantId: firstVariantId, size: 'M', quantity: 2 },
    { variantId: missingVariantId, size: 'M', quantity: 1 },
  ]);

  const result = await inventory.reserveInventoryForOrder(order);
  const storedOrder = await Order.findById(order._id);

  assert.equal(result.reserved, false);
  assert.equal(result.reason, 'variant_not_found');
  assert.equal((await ProductVariant.findById(firstVariantId)).stock, 2);
  assert.equal(storedOrder.inventoryReservedAt, null);
  assert.equal(storedOrder.inventoryDecrementedAt, null);
});

test('real Mongo transaction keeps a multi-line release all-or-none', async () => {
  const firstVariantId = await insertVariant(1, 'INV-RELEASE-MULTI-1');
  const secondVariantId = await insertVariant(1, 'INV-RELEASE-MULTI-2');
  const order = await insertOrderItems([
    { variantId: firstVariantId, size: 'M', quantity: 1 },
    { variantId: secondVariantId, size: 'M', quantity: 1 },
  ]);

  assert.equal((await inventory.reserveInventoryForOrder(order)).reserved, true);
  await ProductVariant.deleteOne({ _id: secondVariantId });

  await assert.rejects(
    inventory.releaseInventoryReservation(order),
    /variant_not_found/
  );

  const storedOrder = await Order.findById(order._id);
  assert.equal((await ProductVariant.findById(firstVariantId)).stock, 0);
  assert.ok(storedOrder.inventoryReservedAt);
  assert.equal(storedOrder.inventoryRestoredAt, null);
});

test('real Mongo failed-payment release is idempotent and variant-scoped', async () => {
  const reservedVariantId = await insertVariant(2, 'INV-RELEASE-1');
  const untouchedVariantId = await insertVariant(4, 'INV-RELEASE-2');
  const order = await insertOrder(reservedVariantId, 2);

  const reserved = await inventory.reserveInventoryForOrder(order);
  const released = await inventory.releaseInventoryReservation(order);
  const duplicate = await inventory.releaseInventoryReservation(order);

  assert.equal(reserved.reserved, true);
  assert.equal(released.restored, true);
  assert.equal(duplicate.reason, 'not_reserved');
  assert.equal((await ProductVariant.findById(reservedVariantId)).stock, 2);
  assert.equal((await ProductVariant.findById(untouchedVariantId)).stock, 4);
});

test('real Mongo concurrent paid-cancellation restore is idempotent', async () => {
  const variantId = await insertVariant(1, 'INV-PAID-RESTORE');
  const order = await insertOrder(variantId, 1);

  assert.equal((await inventory.reserveInventoryForOrder(order)).reserved, true);
  assert.equal(
    (await inventory.decrementInventoryForPaidOrder(order)).reason,
    'reservation_finalized'
  );

  const [firstCopy, secondCopy] = await Promise.all([
    Order.findById(order._id),
    Order.findById(order._id),
  ]);
  const results = await Promise.all([
    inventory.restoreInventoryForOrder(firstCopy),
    inventory.restoreInventoryForOrder(secondCopy),
  ]);

  assert.equal(results.filter((result) => result.restored).length, 1);
  assert.equal((await ProductVariant.findById(variantId)).stock, 1);
});

test('guest cart variant mini exposes authoritative top-level stock without sizes', async () => {
  const variantId = await insertVariant(7, 'INV-MINI-1');

  const response = await request(app)
    .post('/api/cart/variants/mini')
    .send({
      ids: [String(variantId)],
      filters: [{ variantId: String(variantId), size: 'M' }],
    })
    .expect(200);

  assert.equal(response.body.length, 1);
  assert.equal(response.body[0]._id, String(variantId));
  assert.equal(response.body[0].stock, 7);
  assert.deepEqual(response.body[0].sizes, []);
});
