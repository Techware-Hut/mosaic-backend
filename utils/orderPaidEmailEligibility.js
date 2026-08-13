const CLOSED_ORDER_STATUSES = new Set([
  "rejected",
  "cancelled",
  "returned",
  "refunded",
]);

function isClosedOrderStatus(status) {
  return CLOSED_ORDER_STATUSES.has(String(status || "").toLowerCase());
}

module.exports = {
  CLOSED_ORDER_STATUSES,
  isClosedOrderStatus,
};
