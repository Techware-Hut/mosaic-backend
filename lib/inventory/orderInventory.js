/**
 * Order inventory mutations.
 *
 * ProductVariant.stock is authoritative. Checkout reserves stock atomically
 * before returning a PaymentIntent client secret. Payment success finalizes
 * that reservation without decrementing a second time; failed/cancelled
 * payments release it.
 */

const mongoose = require('mongoose');
const Order = require('../../models/Order');
const ProductVariant = require('../../models/ProductVariant');

const INVENTORY_CLOSED_ORDER_STATUSES = [
  'rejected',
  'cancelled',
  'returned',
  'refunded',
];

async function runInventoryTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function toQty(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function getVariantAttribute(variantDoc, key) {
  if (!variantDoc?.attributes) return null;
  if (typeof variantDoc.attributes.get === 'function') {
    const direct = variantDoc.attributes.get(key);
    if (direct != null) return direct;
    const fallbackKey = Array.from(variantDoc.attributes.keys()).find(
      (attrKey) => String(attrKey).toLowerCase() === String(key).toLowerCase()
    );
    return fallbackKey ? variantDoc.attributes.get(fallbackKey) : null;
  }
  const entries = Object.entries(variantDoc.attributes);
  const match = entries.find(
    ([attrKey]) => String(attrKey).toLowerCase() === String(key).toLowerCase()
  );
  return match ? match[1] : null;
}

function resolveVariantStockView(variantDoc, requestedValue) {
  const requested = requestedValue == null ? '' : String(requestedValue).trim();
  const sizes = Array.isArray(variantDoc?.sizes) ? variantDoc.sizes : null;
  const allowBackorder = Boolean(variantDoc?.allowBackorder);
  const stock = Number(variantDoc?.stock || 0);

  if (sizes && sizes.length) {
    const selectedSize = sizes.find((entry) => String(entry.size) === requested);
    if (!selectedSize) return null;
    return {
      key: String(selectedSize.size),
      stock,
      allowBackorder,
      nestedSize: selectedSize,
    };
  }

  const attributeSize = getVariantAttribute(variantDoc, 'size');
  const normalizedKey = requested || attributeSize || 'default';
  if (
    attributeSize &&
    requested &&
    String(attributeSize).toLowerCase() !== requested.toLowerCase()
  ) {
    return null;
  }

  return {
    key: String(normalizedKey),
    stock,
    allowBackorder,
    nestedSize: null,
  };
}

function applyStockToVariantDoc(variantDoc, nextStock, nestedSize) {
  const safe = Math.max(0, Number(nextStock) || 0);
  variantDoc.stock = safe;
  if (nestedSize && Array.isArray(variantDoc.sizes)) {
    nestedSize.stock = safe;
  }
}

async function syncLegacySizeStock(variantDoc, size, session) {
  if (!variantDoc || !Array.isArray(variantDoc.sizes) || !variantDoc.sizes.length) {
    return;
  }

  const sizeKey = String(size || '');
  let dirty = false;
  for (const entry of variantDoc.sizes) {
    if (String(entry.size) === sizeKey || variantDoc.sizes.length === 1) {
      if (Number(entry.stock) !== Number(variantDoc.stock || 0)) {
        entry.stock = Number(variantDoc.stock || 0);
        dirty = true;
      }
    }
  }

  if (dirty) {
    variantDoc.markModified?.('sizes');
    await variantDoc.save?.({ session });
  }
}

function inventoryError(reason, details = {}) {
  const error = new Error(reason);
  error.inventoryReason = reason;
  Object.assign(error, details);
  return error;
}

async function claimOrderInventoryReservation(orderId, session) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      inventoryReservedAt: null,
      inventoryDecrementedAt: null,
    },
    {
      $set: { inventoryReservedAt: new Date() },
      $unset: {
        inventoryRestoredAt: 1,
        inventoryAdjustments: 1,
        inventoryAdjustmentVersion: 1,
      },
    },
    { new: true, session }
  );
}

async function clearOrderInventoryReservation(orderId, session) {
  await Order.updateOne(
    { _id: orderId, inventoryDecrementedAt: null },
    {
      $unset: {
        inventoryReservedAt: 1,
        inventoryAdjustments: 1,
        inventoryAdjustmentVersion: 1,
      },
    },
    { session }
  );
}

async function claimOrderInventoryDecrement(orderId, session) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      paymentStatus: 'paid',
      status: { $nin: INVENTORY_CLOSED_ORDER_STATUSES },
      inventoryReservedAt: null,
      inventoryDecrementedAt: null,
    },
    {
      $set: { inventoryDecrementedAt: new Date() },
      $unset: {
        inventoryRestoredAt: 1,
        inventoryAdjustments: 1,
        inventoryAdjustmentVersion: 1,
      },
    },
    { new: true, session }
  );
}

async function releaseOrderInventoryClaim(orderId, session) {
  await Order.updateOne(
    { _id: orderId },
    {
      $unset: {
        inventoryDecrementedAt: 1,
        inventoryAdjustments: 1,
        inventoryAdjustmentVersion: 1,
      },
    },
    { session }
  );
}

async function decrementAvailableStock(variant, item, { allowBackorder, session }) {
  const qty = toQty(item.quantity);
  const before = Math.max(0, Number(variant.stock || 0));

  let updated = await ProductVariant.findOneAndUpdate(
    { _id: variant._id, stock: { $gte: qty } },
    { $inc: { stock: -qty } },
    { new: true, session }
  );

  let adjustedQuantity = qty;
  if (!updated && allowBackorder) {
    // Backorders may exceed on-hand stock, but stock itself never becomes
    // negative. Compare-and-set preserves the exact amount consumed so a
    // later release cannot inflate inventory.
    for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
      const current = await ProductVariant.findById(variant._id, null, { session });
      const available = Math.max(0, Number(current?.stock || 0));
      if (available === 0) {
        updated = current;
        adjustedQuantity = 0;
        break;
      }
      updated = await ProductVariant.findOneAndUpdate(
        { _id: variant._id, stock: available },
        { $set: { stock: 0 } },
        { new: true, session }
      );
      if (updated) adjustedQuantity = available;
    }
  }

  if (!updated) {
    throw inventoryError('insufficient_stock', {
      variantId: String(variant._id),
      requestedQuantity: qty,
      availableStock: before,
    });
  }

  await syncLegacySizeStock(updated, item.size, session);
  return {
    variantId: variant._id,
    size: String(item.size || ''),
    quantity: adjustedQuantity,
    requestedQuantity: qty,
    stockBefore: Number(updated.stock || 0) + adjustedQuantity,
    stockAfter: Number(updated.stock || 0),
  };
}

async function incrementStock(adjustment, session) {
  const qty = toQty(adjustment.quantity);
  if (!adjustment.variantId || qty < 1) return null;
  const updated = await ProductVariant.findOneAndUpdate(
    { _id: adjustment.variantId },
    { $inc: { stock: qty } },
    { new: true, session }
  );
  if (!updated) {
    throw inventoryError('variant_not_found', {
      variantId: String(adjustment.variantId),
    });
  }
  await syncLegacySizeStock(updated, adjustment.size, session);
  return updated;
}

function normalizeAdjustments(order) {
  if (
    Number(order?.inventoryAdjustmentVersion) === 1 &&
    Array.isArray(order?.inventoryAdjustments)
  ) {
    return order.inventoryAdjustments.map((line) => ({
      variantId: line.variantId,
      size: line.size,
      quantity: toQty(line.quantity),
    }));
  }

  return (order?.items || []).map((item) => ({
    variantId: item.variantId,
    size: item.size,
    quantity: toQty(item.quantity),
  }));
}

async function persistAdjustments(orderId, adjustments, session) {
  const persisted = adjustments
    .filter((line) => toQty(line.quantity) > 0)
    .map((line) => ({
      variantId: line.variantId,
      size: line.size,
      quantity: toQty(line.quantity),
    }));
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        inventoryAdjustments: persisted,
        inventoryAdjustmentVersion: 1,
      },
    },
    { session }
  );
  return persisted;
}

async function reserveInventoryForOrder(order) {
  if (!order?._id) return { reserved: false, reason: 'missing_order' };

  try {
    const result = await runInventoryTransaction(async (session) => {
      const claimed = await claimOrderInventoryReservation(order._id, session);
      if (!claimed) {
        return { reserved: false, reason: 'already_reserved_or_decremented' };
      }

      const adjustments = [];
      for (const item of order.items || []) {
        const qty = toQty(item.quantity);
        if (!item.variantId || qty < 1) {
          throw inventoryError('invalid_order_line', {
            variantId: item.variantId ? String(item.variantId) : null,
          });
        }

        const variant = await ProductVariant.findById(item.variantId, null, {
          session,
        });
        if (!variant) {
          throw inventoryError('variant_not_found', {
            variantId: String(item.variantId),
          });
        }

        const view = resolveVariantStockView(variant, item.size);
        if (!view) {
          throw inventoryError('size_mismatch', {
            variantId: String(item.variantId),
          });
        }

        adjustments.push(
          await decrementAvailableStock(variant, item, {
            allowBackorder: view.allowBackorder,
            session,
          })
        );
      }

      const persisted = await persistAdjustments(
        order._id,
        adjustments,
        session
      );
      return {
        reserved: true,
        reservedAt: claimed.inventoryReservedAt || new Date(),
        adjustments: persisted,
        lines: adjustments,
      };
    });

    if (result.reserved) {
      order.inventoryReservedAt = result.reservedAt;
      order.inventoryAdjustments = result.adjustments;
      order.inventoryAdjustmentVersion = 1;
    }
    return result;
  } catch (error) {
    if (error.inventoryReason) {
      return {
        reserved: false,
        reason: error.inventoryReason,
        variantId: error.variantId,
        requestedQuantity: error.requestedQuantity,
        availableStock: error.availableStock,
      };
    }
    throw error;
  }
}

async function finalizeInventoryReservation(order) {
  const finalized = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: 'paid',
      status: { $nin: INVENTORY_CLOSED_ORDER_STATUSES },
      inventoryReservedAt: { $ne: null },
      inventoryDecrementedAt: null,
    },
    {
      $set: { inventoryDecrementedAt: new Date() },
      $unset: { inventoryReservedAt: 1, inventoryRestoredAt: 1 },
    },
    { new: true }
  );

  if (!finalized) return null;
  order.inventoryReservedAt = undefined;
  order.inventoryDecrementedAt = finalized.inventoryDecrementedAt || new Date();
  order.inventoryAdjustments = finalized.inventoryAdjustments || order.inventoryAdjustments;
  order.inventoryAdjustmentVersion = 1;
  return finalized;
}

/**
 * Finalize a checkout reservation on payment success. Legacy orders created
 * before reservation support still use a strict atomic paid-time decrement.
 */
async function decrementInventoryForPaidOrder(order) {
  if (!order?._id) return { decremented: false, reason: 'missing_order' };

  const finalized = await finalizeInventoryReservation(order);
  if (finalized) {
    return {
      decremented: true,
      reason: 'reservation_finalized',
      lines: finalized.inventoryAdjustments || order.inventoryAdjustments || [],
    };
  }

  if (order.inventoryDecrementedAt) {
    return { decremented: false, reason: 'already_decremented' };
  }

  try {
    const result = await runInventoryTransaction(async (session) => {
      const claimed = await claimOrderInventoryDecrement(order._id, session);
      if (!claimed) {
        return { decremented: false, reason: 'already_decremented' };
      }

      const adjustments = [];
      for (const item of order.items || []) {
        const qty = toQty(item.quantity);
        if (!item.variantId || qty < 1) {
          throw inventoryError('invalid_order_line');
        }
        const variant = await ProductVariant.findById(item.variantId, null, {
          session,
        });
        if (!variant) throw inventoryError('variant_not_found');
        const view = resolveVariantStockView(variant, item.size);
        if (!view) throw inventoryError('size_mismatch');
        adjustments.push(
          await decrementAvailableStock(variant, item, {
            allowBackorder: view.allowBackorder,
            session,
          })
        );
      }

      const persisted = await persistAdjustments(
        order._id,
        adjustments,
        session
      );
      return {
        decremented: true,
        decrementedAt: claimed.inventoryDecrementedAt || new Date(),
        adjustments: persisted,
        lines: adjustments,
      };
    });

    if (result.decremented) {
      order.inventoryDecrementedAt = result.decrementedAt;
      order.inventoryAdjustments = result.adjustments;
      order.inventoryAdjustmentVersion = 1;
    }
    return result;
  } catch (error) {
    if (error.inventoryReason) {
      return { decremented: false, reason: error.inventoryReason };
    }
    throw error;
  }
}

async function releaseInventoryReservation(order) {
  if (!order?._id) return { restored: false, reason: 'missing_order' };

  const result = await runInventoryTransaction(async (session) => {
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        inventoryReservedAt: { $ne: null },
        inventoryDecrementedAt: null,
        inventoryRestoredAt: null,
      },
      { $set: { inventoryRestoredAt: new Date() } },
      { new: true, session }
    );

    if (!claimed) {
      return { restored: false, reason: 'not_reserved' };
    }

    const adjustments = normalizeAdjustments(
      Number(claimed.inventoryAdjustmentVersion) === 1 ? claimed : order
    );
    for (const adjustment of adjustments) {
      await incrementStock(adjustment, session);
    }
    await Order.updateOne(
      { _id: order._id },
      {
        $unset: {
          inventoryReservedAt: 1,
          inventoryAdjustments: 1,
          inventoryAdjustmentVersion: 1,
        },
      },
      { session }
    );
    return {
      restored: true,
      restoredAt: claimed.inventoryRestoredAt || new Date(),
      lines: adjustments,
    };
  });

  if (result.restored) {
    order.inventoryReservedAt = undefined;
    order.inventoryRestoredAt = result.restoredAt;
    order.inventoryAdjustments = [];
    order.inventoryAdjustmentVersion = undefined;
  }
  return result;
}

async function restoreInventoryForOrder(order) {
  if (!order?._id) return { restored: false, reason: 'missing_order' };

  const result = await runInventoryTransaction(async (session) => {
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        inventoryDecrementedAt: { $ne: null },
        inventoryRestoredAt: null,
      },
      { $set: { inventoryRestoredAt: new Date() } },
      { new: true, session }
    );

    if (!claimed) {
      return { restored: false, reason: 'not_decremented' };
    }

    const adjustments = normalizeAdjustments(
      Number(claimed.inventoryAdjustmentVersion) === 1 ? claimed : order
    );
    for (const adjustment of adjustments) {
      await incrementStock(adjustment, session);
    }
    await Order.updateOne(
      { _id: order._id },
      {
        $unset: {
          inventoryDecrementedAt: 1,
          inventoryAdjustments: 1,
          inventoryAdjustmentVersion: 1,
        },
      },
      { session }
    );
    return {
      restored: true,
      restoredAt: claimed.inventoryRestoredAt || new Date(),
      lines: adjustments,
    };
  });

  if (result.restored) {
    order.inventoryDecrementedAt = undefined;
    order.inventoryRestoredAt = result.restoredAt;
    order.inventoryAdjustments = [];
    order.inventoryAdjustmentVersion = undefined;
  }
  return result;
}

/**
 * A full refund can race either side of reservation finalization. Restore the
 * checkout decrement from whichever authoritative state won, with the existing
 * per-order inventoryRestoredAt claims providing replay idempotency.
 */
async function restoreInventoryForRefundedOrder(order) {
  if (!order?._id) return { restored: false, reason: 'missing_order' };

  const reservation = await releaseInventoryReservation(order);
  if (reservation.restored) {
    return { ...reservation, reason: 'reservation_released' };
  }

  const finalized = await restoreInventoryForOrder(order);
  if (finalized.restored) {
    return { ...finalized, reason: 'paid_inventory_restored' };
  }

  return {
    restored: false,
    reason: 'inventory_not_decremented_or_already_restored',
    lines: [],
  };
}

module.exports = {
  toQty,
  resolveVariantStockView,
  applyStockToVariantDoc,
  claimOrderInventoryReservation,
  claimOrderInventoryDecrement,
  releaseOrderInventoryClaim,
  reserveInventoryForOrder,
  releaseInventoryReservation,
  decrementInventoryForPaidOrder,
  restoreInventoryForOrder,
  restoreInventoryForRefundedOrder,
};
