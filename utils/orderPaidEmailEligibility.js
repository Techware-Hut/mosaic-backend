const CLOSED_ORDER_STATUSES = new Set([
  "rejected",
  "cancelled",
  "returned",
  "refunded",
]);

function isClosedOrderStatus(status) {
  return CLOSED_ORDER_STATUSES.has(String(status || "").toLowerCase());
}

/**
 * A genuinely late success may recover a failed/cancelled checkout race. Once
 * an already-paid order enters a post-payment terminal state, however, a stale
 * succeeded event must not reopen commerce or send a delayed paid receipt.
 */
function canReconcileSucceededPayment(order) {
  if (!order) return false;
  if (String(order.paymentStatus || "").toLowerCase() === "refunded") {
    return false;
  }
  return !(
    String(order.paymentStatus || "").toLowerCase() === "paid" &&
    isClosedOrderStatus(order.status)
  );
}

function shouldAdvanceToOrdered(order) {
  if (String(order?.status || "").toLowerCase() === "created") return true;
  return (
    String(order?.paymentStatus || "").toLowerCase() === "failed" &&
    String(order?.status || "").toLowerCase() === "cancelled"
  );
}

function buildSucceededPaymentReconciliationFilter(orderId, paymentId) {
  return {
    _id: orderId,
    paymentId,
    paymentStatus: { $ne: "refunded" },
    $nor: [
      {
        paymentStatus: "paid",
        status: { $in: [...CLOSED_ORDER_STATUSES] },
      },
    ],
  };
}

/**
 * Advance a correlated order and append ordered history in one database write.
 * Optional provider-side charge evidence is applied to every order item in the
 * same atomic update, avoiding a stale document save after a concurrent refund.
 */
function buildSucceededPaymentReconciliationPipeline(paymentEvidence = {}) {
  const shouldAdvance = {
    $or: [
      { $eq: ["$status", "created"] },
      {
        $and: [
          { $eq: ["$paymentStatus", "failed"] },
          { $eq: ["$status", "cancelled"] },
        ],
      },
    ],
  };
  const itemEvidence = {};
  for (const field of ["chargeId", "transferId", "applicationFeeId"]) {
    if (paymentEvidence[field]) itemEvidence[field] = paymentEvidence[field];
  }
  const set = {
    status: { $cond: [shouldAdvance, "ordered", "$status"] },
    statusHistory: {
      $cond: [
        shouldAdvance,
        {
          $concatArrays: [
            { $ifNull: ["$statusHistory", []] },
            [{ status: "ordered", updatedAt: "$$NOW" }],
          ],
        },
        "$statusHistory",
      ],
    },
    paymentStatus: "paid",
  };

  if (Object.keys(itemEvidence).length) {
    set.items = {
      $map: {
        input: { $ifNull: ["$items", []] },
        as: "item",
        in: { $mergeObjects: ["$$item", itemEvidence] },
      },
    };
  }

  return [{ $set: set }];
}

module.exports = {
  CLOSED_ORDER_STATUSES,
  buildSucceededPaymentReconciliationFilter,
  buildSucceededPaymentReconciliationPipeline,
  canReconcileSucceededPayment,
  isClosedOrderStatus,
  shouldAdvanceToOrdered,
};
