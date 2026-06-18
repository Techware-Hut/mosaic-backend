/**
 * Frontend-safe PaymentIntent and order poll shapes for retrieve-intent.
 */

function sanitizePaymentIntentForClient(paymentIntent) {
  if (!paymentIntent) {
    return null;
  }

  const metadata = paymentIntent.metadata || {};
  const safeMetadata = {};

  if (metadata.orderId) {
    safeMetadata.orderId = String(metadata.orderId);
  }
  if (metadata.groupOrderId) {
    safeMetadata.groupOrderId = String(metadata.groupOrderId);
  }

  return {
    id: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    created: paymentIntent.created,
    ...(Object.keys(safeMetadata).length > 0 ? { metadata: safeMetadata } : {}),
  };
}

function sanitizeOrderForPaymentPoll(order) {
  if (!order) {
    return null;
  }

  const plain = typeof order.toObject === 'function' ? order.toObject() : order;

  return {
    id: plain._id?.toString?.() || plain._id,
    groupOrderId: plain.groupOrderId,
    status: plain.status,
    paymentStatus: plain.paymentStatus,
    totalAmount: plain.totalAmount,
    currency: plain.currency,
    items: Array.isArray(plain.items)
      ? plain.items.map((item) => ({
          productId: item.productId?._id?.toString?.() || item.productId,
          title: item.productId?.title || item.title || null,
          quantity: item.quantity,
          price: item.price,
          size: item.size,
        }))
      : [],
  };
}

module.exports = {
  sanitizePaymentIntentForClient,
  sanitizeOrderForPaymentPoll,
};
