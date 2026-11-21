'use strict';

// Atomic guard for order status transitions.
//
// Order handlers load an order, check its current status, run side effects
// (Stripe refunds, inventory restore) and then save(). Two concurrent requests
// (buyer cancel vs vendor ship, or a double-clicked reject) can both pass the
// in-memory status check. Claiming this lock with a conditional update on the
// expected status makes exactly one of them win; the other gets a 409.

// Stripe may take 80 seconds per attempt plus retries; retain ownership for five minutes.
const LOCK_TTL_MS = 5 * 60 * 1000;

function toStatusList(expected) {
  return Array.isArray(expected) ? expected : [expected];
}

/**
 * @returns {Promise<boolean>} true when this request now owns the transition.
 */
async function claimOrderTransition(OrderModel, orderId, expectedStatus, now = new Date()) {
  const staleBefore = new Date(now.getTime() - LOCK_TTL_MS);
  const result = await OrderModel.updateOne(
    {
      _id: orderId,
      status: { $in: toStatusList(expectedStatus) },
      $or: [
        { transitionLockedAt: null },
        { transitionLockedAt: { $exists: false } },
        { transitionLockedAt: { $lt: staleBefore } },
      ],
    },
    { $set: { transitionLockedAt: now } }
  );
  return Number(result?.modifiedCount ?? result?.nModified ?? 0) === 1;
}

/**
 * Release a lock this request claimed. Matches on the claim timestamp so a
 * request whose lock went stale cannot release a newer owner's lock.
 */
async function releaseOrderTransition(OrderModel, orderId, claimedAt) {
  try {
    await OrderModel.updateOne(
      { _id: orderId, transitionLockedAt: claimedAt },
      { $set: { transitionLockedAt: null } }
    );
  } catch (err) {
    // A leftover lock self-expires after LOCK_TTL_MS; never fail the request on release.
    console.error(`releaseOrderTransition failed for order ${orderId}:`, err?.message || err);
  }
}

/**
 * Claims the transition, runs fn, and always releases. Returns
 * { claimed: false } without running fn when another transition holds the
 * order or its status changed since it was read.
 */
async function withOrderTransition(OrderModel, orderId, expectedStatus, fn) {
  const claimedAt = new Date();
  const claimed = await claimOrderTransition(OrderModel, orderId, expectedStatus, claimedAt);
  if (!claimed) return { claimed: false };
  try {
    return { claimed: true, value: await fn() };
  } finally {
    await releaseOrderTransition(OrderModel, orderId, claimedAt);
  }
}

const TRANSITION_CONFLICT_RESPONSE = Object.freeze({
  success: false,
  code: 'ORDER_TRANSITION_CONFLICT',
  message: 'This order was just updated. Refresh and try again.',
});

module.exports = {
  LOCK_TTL_MS,
  claimOrderTransition,
  releaseOrderTransition,
  withOrderTransition,
  TRANSITION_CONFLICT_RESPONSE,
};
