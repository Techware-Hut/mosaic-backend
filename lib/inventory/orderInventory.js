/**
 * Order inventory mutations — decrement on payment success (idempotent).
 * Authoritative stock: ProductVariant.stock (legacy sizes[] synced when present).
 */

const Order = require('../../models/Order');
const ProductVariant = require('../../models/ProductVariant');

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

/**
 * Resolve size key for matching; stock always reads ProductVariant.stock (SoT).
 */
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

/**
 * Atomically claim the decrement slot on the order. Returns the claimed order
 * document, or null if inventory was already decremented.
 */
async function claimOrderInventoryDecrement(orderId) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      $or: [
        { inventoryDecrementedAt: null },
        { inventoryDecrementedAt: { $exists: false } },
      ],
    },
    { $set: { inventoryDecrementedAt: new Date() } },
    { new: true }
  );
}

async function releaseOrderInventoryClaim(orderId) {
  await Order.updateOne(
    { _id: orderId },
    { $unset: { inventoryDecrementedAt: 1 } }
  );
}

/**
 * Decrement ProductVariant.stock for each order line. Idempotent via
 * order.inventoryDecrementedAt. Safe to call from payment webhooks.
 *
 * @param {import('mongoose').Document|object} order
 * @returns {Promise<{ decremented: boolean, reason?: string, lines?: Array<object> }>}
 */
async function decrementInventoryForPaidOrder(order) {
  if (!order?._id) {
    return { decremented: false, reason: 'missing_order' };
  }

  const claimed = await claimOrderInventoryDecrement(order._id);
  if (!claimed) {
    return { decremented: false, reason: 'already_decremented' };
  }

  const lines = [];

  try {
    for (const item of order.items || []) {
      const qty = toQty(item.quantity);
      if (!item.variantId || qty < 1) continue;

      const variant = await ProductVariant.findById(item.variantId);
      if (!variant) {
        lines.push({
          variantId: String(item.variantId),
          skipped: true,
          reason: 'variant_not_found',
        });
        continue;
      }

      const view = resolveVariantStockView(variant, item.size);
      if (!view) {
        lines.push({
          variantId: String(item.variantId),
          skipped: true,
          reason: 'size_mismatch',
        });
        continue;
      }

      const before = Number(variant.stock || 0);
      // Prefer atomic conditional decrement when enough stock; else floor at 0
      // (payment already succeeded — do not fail the webhook).
      let updated = await ProductVariant.findOneAndUpdate(
        { _id: variant._id, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true }
      );

      if (!updated) {
        updated = await ProductVariant.findOneAndUpdate(
          { _id: variant._id },
          [
            {
              $set: {
                stock: {
                  $max: [0, { $subtract: [{ $ifNull: ['$stock', 0] }, qty] }],
                },
              },
            },
          ],
          { new: true }
        );
      }

      // Keep legacy sizes[] in sync with SoT when present
      if (updated && Array.isArray(updated.sizes) && updated.sizes.length) {
        const sizeKey = String(item.size || '');
        let dirty = false;
        for (const entry of updated.sizes) {
          if (String(entry.size) === sizeKey || updated.sizes.length === 1) {
            if (Number(entry.stock) !== Number(updated.stock)) {
              entry.stock = updated.stock;
              dirty = true;
            }
          }
        }
        if (dirty) {
          updated.markModified('sizes');
          await updated.save();
        }
      }

      lines.push({
        variantId: String(variant._id),
        quantity: qty,
        stockBefore: before,
        stockAfter: Number(updated?.stock || 0),
        undersold: before < qty,
      });
    }

    return { decremented: true, lines };
  } catch (error) {
    await releaseOrderInventoryClaim(order._id);
    throw error;
  }
}

/**
 * Restore stock when cancelling/refunding an order that already decremented inventory.
 */
async function restoreInventoryForOrder(order) {
  if (!order?._id || !order.inventoryDecrementedAt) {
    return { restored: false, reason: 'not_decremented' };
  }

  const lines = [];

  for (const item of order.items || []) {
    const qty = toQty(item.quantity);
    if (!item.variantId || qty < 1) continue;

    const updated = await ProductVariant.findOneAndUpdate(
      { _id: item.variantId },
      { $inc: { stock: qty } },
      { new: true }
    );

    if (updated && Array.isArray(updated.sizes) && updated.sizes.length) {
      const sizeKey = String(item.size || '');
      let dirty = false;
      for (const entry of updated.sizes) {
        if (String(entry.size) === sizeKey || updated.sizes.length === 1) {
          entry.stock = Number(updated.stock || 0);
          dirty = true;
        }
      }
      if (dirty) {
        updated.markModified('sizes');
        await updated.save();
      }
    }

    lines.push({
      variantId: String(item.variantId),
      quantity: qty,
      stockAfter: Number(updated?.stock || 0),
    });
  }

  await Order.updateOne(
    { _id: order._id },
    { $unset: { inventoryDecrementedAt: 1 } }
  );

  return { restored: true, lines };
}

module.exports = {
  toQty,
  resolveVariantStockView,
  applyStockToVariantDoc,
  claimOrderInventoryDecrement,
  releaseOrderInventoryClaim,
  decrementInventoryForPaidOrder,
  restoreInventoryForOrder,
};
