const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderInventoryPath = path.resolve(
  __dirname,
  '../../lib/inventory/orderInventory.js'
);

function loadOrderInventory({
  claimResult,
  variantStock = 10,
  findOneAndUpdateImpl,
} = {}) {
  const orderUpdates = [];
  const variantUpdates = [];
  let stock = variantStock;

  const Order = {
    findOneAndUpdate: async (filter, update, opts) => {
      orderUpdates.push({ filter, update, opts });
      if (claimResult === null) return null;
      if (claimResult !== undefined) return claimResult;
      return {
        _id: filter._id,
        inventoryDecrementedAt: update?.$set?.inventoryDecrementedAt || new Date(),
      };
    },
    updateOne: async (filter, update) => {
      orderUpdates.push({ filter, update, type: 'updateOne' });
      return { acknowledged: true };
    },
  };

  const ProductVariant = {
    findById: async (id) => ({
      _id: id,
      stock,
      sizes: [{ size: 'M', stock }],
      allowBackorder: false,
    }),
    findOneAndUpdate: async (filter, update, opts) => {
      variantUpdates.push({ filter, update, opts });
      if (findOneAndUpdateImpl) {
        return findOneAndUpdateImpl(filter, update, opts, () => stock);
      }
      const qty =
        update?.$inc?.stock != null
          ? -update.$inc.stock
          : 0;
      if (filter.stock?.$gte != null && stock < filter.stock.$gte) {
        return null;
      }
      if (update?.$inc?.stock != null) {
        stock = Math.max(0, stock + update.$inc.stock);
      }
      return {
        _id: filter._id,
        stock,
        sizes: [{ size: 'M', stock }],
        markModified() {},
        save: async function save() {
          return this;
        },
      };
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Order')) return Order;
    if (request.endsWith('models/ProductVariant')) return ProductVariant;
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[orderInventoryPath];
  const mod = require(orderInventoryPath);
  Module._load = originalLoad;

  return {
    ...mod,
    getOrderUpdates: () => orderUpdates,
    getVariantUpdates: () => variantUpdates,
    getStock: () => stock,
  };
}

test('decrementInventoryForPaidOrder is idempotent when already claimed', async () => {
  const { decrementInventoryForPaidOrder, getVariantUpdates } = loadOrderInventory({
    claimResult: null,
    variantStock: 5,
  });

  const result = await decrementInventoryForPaidOrder({
    _id: 'order-1',
    items: [{ variantId: 'var-1', size: 'M', quantity: 2 }],
  });

  assert.equal(result.decremented, false);
  assert.equal(result.reason, 'already_decremented');
  assert.equal(getVariantUpdates().length, 0);
});

test('decrementInventoryForPaidOrder decrements ProductVariant.stock once', async () => {
  const { decrementInventoryForPaidOrder, getStock, getVariantUpdates } =
    loadOrderInventory({ variantStock: 5 });

  const result = await decrementInventoryForPaidOrder({
    _id: 'order-1',
    items: [{ variantId: 'var-1', size: 'M', quantity: 2 }],
  });

  assert.equal(result.decremented, true);
  assert.equal(getStock(), 3);
  assert.ok(getVariantUpdates().length >= 1);
  assert.equal(result.lines[0].stockAfter, 3);
});

test('restoreInventoryForOrder skips when inventory was not decremented', async () => {
  const { restoreInventoryForOrder, getVariantUpdates } = loadOrderInventory({
    variantStock: 3,
  });

  const result = await restoreInventoryForOrder({
    _id: 'order-1',
    inventoryDecrementedAt: null,
    items: [{ variantId: 'var-1', size: 'M', quantity: 2 }],
  });

  assert.equal(result.restored, false);
  assert.equal(result.reason, 'not_decremented');
  assert.equal(getVariantUpdates().length, 0);
});

test('restoreInventoryForOrder restores stock and clears claim', async () => {
  const { restoreInventoryForOrder, getStock, getOrderUpdates } = loadOrderInventory({
    variantStock: 3,
  });

  const result = await restoreInventoryForOrder({
    _id: 'order-1',
    inventoryDecrementedAt: new Date(),
    items: [{ variantId: 'var-1', size: 'M', quantity: 2 }],
  });

  assert.equal(result.restored, true);
  assert.equal(getStock(), 5);
  assert.ok(
    getOrderUpdates().some(
      (u) => u.type === 'updateOne' && u.update?.$unset?.inventoryDecrementedAt
    )
  );
});
