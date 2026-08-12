const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderInventoryPath = path.resolve(
  __dirname,
  '../../lib/inventory/orderInventory.js'
);

function matches(actual, expected) {
  if (expected === null) return actual == null;
  if (expected && typeof expected === 'object' && '$ne' in expected) {
    return actual !== expected.$ne && actual != null;
  }
  if (expected && typeof expected === 'object' && '$nin' in expected) {
    return !expected.$nin.some((value) => String(actual) === String(value));
  }
  if (expected && typeof expected === 'object' && '$gte' in expected) {
    return Number(actual) >= Number(expected.$gte);
  }
  return String(actual) === String(expected);
}

function applyUpdate(target, update) {
  for (const [key, value] of Object.entries(update?.$set || {})) target[key] = value;
  for (const key of Object.keys(update?.$unset || {})) delete target[key];
  return target;
}

function loadOrderInventory({
  variantStocks = { 'var-1': 10 },
  allowBackorder = false,
  orderStates = {},
} = {}) {
  const orders = new Map(
    Object.entries(orderStates).map(([id, state]) => [id, { _id: id, ...state }])
  );
  const stocks = new Map(
    Object.entries(variantStocks).map(([id, stock]) => [id, Number(stock)])
  );
  const orderUpdates = [];
  const variantUpdates = [];
  let transactionQueue = Promise.resolve();

  const cloneOrders = () =>
    new Map(
      Array.from(orders.entries(), ([id, state]) => [
        id,
        {
          ...state,
          inventoryAdjustments: state.inventoryAdjustments?.map((line) => ({
            ...line,
          })),
        },
      ])
    );

  const restoreMap = (target, snapshot) => {
    target.clear();
    for (const [key, value] of snapshot) target.set(key, value);
  };

  const mongoose = {
    startSession: async () => ({
      async withTransaction(work) {
        const previous = transactionQueue;
        let release;
        transactionQueue = new Promise((resolve) => {
          release = resolve;
        });
        await previous;
        const orderSnapshot = cloneOrders();
        const stockSnapshot = new Map(stocks);
        try {
          return await work();
        } catch (error) {
          restoreMap(orders, orderSnapshot);
          restoreMap(stocks, stockSnapshot);
          throw error;
        } finally {
          release();
        }
      },
      async endSession() {},
    }),
  };

  const getOrder = (id) => {
    const key = String(id);
    if (!orders.has(key)) orders.set(key, { _id: key });
    return orders.get(key);
  };

  const Order = {
    findOneAndUpdate: async (filter, update, opts) => {
      const state = getOrder(filter._id);
      const ok = Object.entries(filter).every(([key, expected]) =>
        key === '_id' ? true : matches(state[key], expected)
      );
      orderUpdates.push({ filter, update, opts, matched: ok });
      if (!ok) return null;
      applyUpdate(state, update);
      return { ...state };
    },
    updateOne: async (filter, update) => {
      const state = getOrder(filter._id);
      const ok = Object.entries(filter).every(([key, expected]) =>
        key === '_id' ? true : matches(state[key], expected)
      );
      orderUpdates.push({ filter, update, type: 'updateOne', matched: ok });
      if (ok) applyUpdate(state, update);
      return { acknowledged: true, matchedCount: ok ? 1 : 0 };
    },
  };

  const variantDoc = (id) => {
    const key = String(id);
    if (!stocks.has(key)) return null;
    const stock = stocks.get(key);
    return {
      _id: key,
      stock,
      sizes: [{ size: 'M', stock }],
      allowBackorder,
      markModified() {},
      async save() {
        return this;
      },
    };
  };

  const ProductVariant = {
    findById: async (id) => variantDoc(id),
    findOneAndUpdate: async (filter, update, opts) => {
      const key = String(filter._id);
      const current = stocks.get(key);
      if (current == null || !matches(current, filter.stock ?? current)) return null;
      if (update?.$inc?.stock != null) stocks.set(key, current + update.$inc.stock);
      if (update?.$set?.stock != null) stocks.set(key, Number(update.$set.stock));
      variantUpdates.push({ filter, update, opts });
      return variantDoc(key);
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'mongoose') return mongoose;
    if (request.endsWith('models/Order')) return Order;
    if (request.endsWith('models/ProductVariant')) return ProductVariant;
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[orderInventoryPath];
  const mod = require(orderInventoryPath);
  Module._load = originalLoad;

  return {
    ...mod,
    getOrder: (id) => getOrder(id),
    setOrder: (id, update) => Object.assign(getOrder(id), update),
    getStock: (id = 'var-1') => stocks.get(id),
    getOrderUpdates: () => orderUpdates,
    getVariantUpdates: () => variantUpdates,
  };
}

function makeOrder(id, variantId = 'var-1', quantity = 1) {
  return {
    _id: id,
    items: [{ variantId, size: 'M', quantity }],
  };
}

test('legacy paid order decrement is atomic and idempotent', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 5 },
    orderStates: {
      'order-1': { paymentStatus: 'paid', status: 'ordered' },
    },
  });
  const order = makeOrder('order-1', 'var-1', 2);

  const first = await inventory.decrementInventoryForPaidOrder(order);
  const duplicate = await inventory.decrementInventoryForPaidOrder(order);

  assert.equal(first.decremented, true);
  assert.equal(duplicate.decremented, false);
  assert.equal(duplicate.reason, 'already_decremented');
  assert.equal(inventory.getStock(), 3);
});

test('two buyers cannot reserve the final unit', async () => {
  const inventory = loadOrderInventory({ variantStocks: { 'var-1': 1 } });
  const [first, second] = await Promise.all([
    inventory.reserveInventoryForOrder(makeOrder('order-1')),
    inventory.reserveInventoryForOrder(makeOrder('order-2')),
  ]);

  assert.equal([first.reserved, second.reserved].filter(Boolean).length, 1);
  assert.equal(
    [first.reason, second.reason].filter((reason) => reason === 'insufficient_stock').length,
    1
  );
  assert.equal(inventory.getStock(), 0);
});

test('multi-line reservation aborts all stock changes when line two fails', async () => {
  const inventory = loadOrderInventory({ variantStocks: { 'var-1': 2 } });
  const order = {
    _id: 'order-1',
    items: [
      { variantId: 'var-1', size: 'M', quantity: 2 },
      { variantId: 'missing', size: 'M', quantity: 1 },
    ],
  };

  const result = await inventory.reserveInventoryForOrder(order);

  assert.equal(result.reserved, false);
  assert.equal(result.reason, 'variant_not_found');
  assert.equal(inventory.getStock('var-1'), 2);
  assert.equal(inventory.getOrder('order-1').inventoryReservedAt, undefined);
});

test('legacy paid-time multi-line decrement aborts all stock changes', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 2 },
    orderStates: {
      'order-1': { paymentStatus: 'paid', status: 'ordered' },
    },
  });
  const order = {
    _id: 'order-1',
    items: [
      { variantId: 'var-1', size: 'M', quantity: 2 },
      { variantId: 'missing', size: 'M', quantity: 1 },
    ],
  };

  const result = await inventory.decrementInventoryForPaidOrder(order);

  assert.equal(result.decremented, false);
  assert.equal(result.reason, 'variant_not_found');
  assert.equal(inventory.getStock('var-1'), 2);
  assert.equal(inventory.getOrder('order-1').inventoryDecrementedAt, undefined);
});

test('payment success finalizes a reservation without decrementing twice', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 2 },
    orderStates: {
      'order-1': { paymentStatus: 'paid', status: 'ordered' },
    },
  });
  const order = makeOrder('order-1');

  const reserved = await inventory.reserveInventoryForOrder(order);
  const finalized = await inventory.decrementInventoryForPaidOrder(order);
  const replay = await inventory.decrementInventoryForPaidOrder(order);

  assert.equal(reserved.reserved, true);
  assert.equal(finalized.decremented, true);
  assert.equal(finalized.reason, 'reservation_finalized');
  assert.equal(replay.reason, 'already_decremented');
  assert.equal(inventory.getStock(), 1);
});

test('failed/cancelled payment releases a reservation exactly once', async () => {
  const inventory = loadOrderInventory({ variantStocks: { 'var-1': 2 } });
  const order = makeOrder('order-1');

  await inventory.reserveInventoryForOrder(order);
  const released = await inventory.releaseInventoryReservation(order);
  const replay = await inventory.releaseInventoryReservation(order);

  assert.equal(released.restored, true);
  assert.equal(replay.restored, false);
  assert.equal(replay.reason, 'not_reserved');
  assert.equal(inventory.getStock(), 2);
});

test('paid cancellation restores finalized inventory exactly once', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 3 },
    orderStates: {
      'order-1': { paymentStatus: 'paid', status: 'ordered' },
    },
  });
  const order = makeOrder('order-1', 'var-1', 2);

  await inventory.reserveInventoryForOrder(order);
  await inventory.decrementInventoryForPaidOrder(order);
  const restored = await inventory.restoreInventoryForOrder(order);
  const replay = await inventory.restoreInventoryForOrder(order);

  assert.equal(restored.restored, true);
  assert.equal(replay.restored, false);
  assert.equal(inventory.getStock(), 3);
});

test('concurrent paid cancellation restores finalized inventory exactly once', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 0 },
    orderStates: {
      'order-1': {
        inventoryDecrementedAt: new Date(),
        inventoryRestoredAt: null,
        inventoryAdjustmentVersion: 1,
        inventoryAdjustments: [
          { variantId: 'var-1', size: 'M', quantity: 1 },
        ],
      },
    },
  });

  const [first, second] = await Promise.all([
    inventory.restoreInventoryForOrder(makeOrder('order-1')),
    inventory.restoreInventoryForOrder(makeOrder('order-1')),
  ]);

  assert.equal([first.restored, second.restored].filter(Boolean).length, 1);
  assert.equal(inventory.getStock(), 1);
});

test('stale paid document cannot finalize a reservation after the authoritative order is refunded', async () => {
  const reservedAt = new Date('2026-08-12T12:00:00.000Z');
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 0 },
    orderStates: {
      'order-1': {
        paymentStatus: 'refunded',
        status: 'refunded',
        inventoryReservedAt: reservedAt,
        inventoryDecrementedAt: null,
        inventoryRestoredAt: null,
        inventoryAdjustmentVersion: 1,
        inventoryAdjustments: [
          { variantId: 'var-1', size: 'M', quantity: 1 },
        ],
      },
    },
  });
  const stalePaidOrder = {
    ...makeOrder('order-1'),
    paymentStatus: 'paid',
    status: 'ordered',
    inventoryReservedAt: reservedAt,
  };

  const result = await inventory.decrementInventoryForPaidOrder(stalePaidOrder);

  assert.equal(result.decremented, false);
  assert.equal(result.reason, 'already_decremented');
  assert.equal(inventory.getStock(), 0);
  assert.equal(inventory.getOrder('order-1').inventoryReservedAt, reservedAt);
  assert.equal(inventory.getOrder('order-1').inventoryDecrementedAt, null);
});

test('stale paid document cannot claim a legacy decrement after the authoritative order is closed', async () => {
  for (const status of ['rejected', 'cancelled', 'returned', 'refunded']) {
    const inventory = loadOrderInventory({
      variantStocks: { 'var-1': 1 },
      orderStates: {
        'order-1': {
          paymentStatus: status === 'refunded' ? 'refunded' : 'failed',
          status,
          inventoryReservedAt: null,
          inventoryDecrementedAt: null,
        },
      },
    });
    const stalePaidOrder = {
      ...makeOrder('order-1'),
      paymentStatus: 'paid',
      status: 'ordered',
    };

    const result = await inventory.decrementInventoryForPaidOrder(stalePaidOrder);

    assert.equal(result.decremented, false, status);
    assert.equal(inventory.getStock(), 1, status);
    assert.equal(inventory.getOrder('order-1').inventoryDecrementedAt, null, status);
  }
});

test('refund convergence releases a reservation exactly once across replay', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 0 },
    orderStates: {
      'order-1': {
        paymentStatus: 'refunded',
        status: 'refunded',
        inventoryReservedAt: new Date('2026-08-12T12:00:00.000Z'),
        inventoryDecrementedAt: null,
        inventoryRestoredAt: null,
        inventoryAdjustmentVersion: 1,
        inventoryAdjustments: [
          { variantId: 'var-1', size: 'M', quantity: 2 },
        ],
      },
    },
  });
  const refundedOrder = makeOrder('order-1', 'var-1', 2);

  const first = await inventory.restoreInventoryForRefundedOrder(refundedOrder);
  const replay = await inventory.restoreInventoryForRefundedOrder(refundedOrder);

  assert.equal(first.restored, true);
  assert.equal(first.reason, 'reservation_released');
  assert.equal(replay.restored, false);
  assert.equal(replay.reason, 'inventory_not_decremented_or_already_restored');
  assert.equal(inventory.getStock(), 2);
  assert.equal(inventory.getOrder('order-1').inventoryReservedAt, undefined);
  assert.ok(inventory.getOrder('order-1').inventoryRestoredAt instanceof Date);
});

test('refund convergence restores finalized stock exactly once across replay', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 0 },
    orderStates: {
      'order-1': {
        paymentStatus: 'refunded',
        status: 'refunded',
        inventoryReservedAt: null,
        inventoryDecrementedAt: new Date('2026-08-12T12:01:00.000Z'),
        inventoryRestoredAt: null,
        inventoryAdjustmentVersion: 1,
        inventoryAdjustments: [
          { variantId: 'var-1', size: 'M', quantity: 2 },
        ],
      },
    },
  });
  const refundedOrder = makeOrder('order-1', 'var-1', 2);

  const first = await inventory.restoreInventoryForRefundedOrder(refundedOrder);
  const replay = await inventory.restoreInventoryForRefundedOrder(refundedOrder);

  assert.equal(first.restored, true);
  assert.equal(first.reason, 'paid_inventory_restored');
  assert.equal(replay.restored, false);
  assert.equal(replay.reason, 'inventory_not_decremented_or_already_restored');
  assert.equal(inventory.getStock(), 2);
  assert.equal(inventory.getOrder('order-1').inventoryDecrementedAt, undefined);
  assert.ok(inventory.getOrder('order-1').inventoryRestoredAt instanceof Date);
});

test('backorder release restores only the on-hand quantity actually adjusted', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 1 },
    allowBackorder: true,
  });
  const order = makeOrder('order-1', 'var-1', 3);

  const reserved = await inventory.reserveInventoryForOrder(order);
  await inventory.releaseInventoryReservation(order);

  assert.equal(reserved.reserved, true);
  assert.equal(reserved.lines[0].quantity, 1);
  assert.equal(inventory.getStock(), 1);
});

test('zero-stock backorder release does not manufacture inventory', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 0 },
    allowBackorder: true,
  });
  const order = makeOrder('order-1', 'var-1', 3);

  const reserved = await inventory.reserveInventoryForOrder(order);
  await inventory.releaseInventoryReservation(order);

  assert.equal(reserved.reserved, true);
  assert.equal(reserved.lines[0].quantity, 0);
  assert.equal(inventory.getStock(), 0);
});

test('one variant reservation does not mutate another variant', async () => {
  const inventory = loadOrderInventory({
    variantStocks: { 'var-1': 2, 'var-2': 4 },
  });

  await inventory.reserveInventoryForOrder(makeOrder('order-1', 'var-1', 2));

  assert.equal(inventory.getStock('var-1'), 0);
  assert.equal(inventory.getStock('var-2'), 4);
});
