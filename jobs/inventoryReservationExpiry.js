const cron = require('node-cron');
const Stripe = require('stripe');
const Order = require('../models/Order');
const {
  decrementInventoryForPaidOrder,
  releaseInventoryReservation,
} = require('../lib/inventory/orderInventory');

function getInventoryReservationExpiryConfig() {
  const ttlMinutes = Number(process.env.INVENTORY_RESERVATION_TTL_MINUTES);
  const batchLimit = Number(process.env.INVENTORY_RESERVATION_EXPIRY_BATCH_LIMIT);

  return {
    // Product must approve the abandonment TTL before automated release is
    // activated. The scheduler is therefore opt-in even though the proposed
    // TTL below remains configurable.
    enabled: process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY === 'true',
    cronExpression:
      process.env.INVENTORY_RESERVATION_EXPIRY_CRON || '*/5 * * * *',
    ttlMinutes:
      Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 30,
    batchLimit:
      Number.isFinite(batchLimit) && batchLimit > 0
        ? Math.floor(batchLimit)
        : 50,
  };
}

function getReservationCutoff(ttlMinutes, now = Date.now()) {
  return new Date(Number(now) - ttlMinutes * 60 * 1000);
}

async function loadExpiredReservations({ OrderModel, cutoff, batchLimit }) {
  return OrderModel.find({
    inventoryReservedAt: { $ne: null, $lte: cutoff },
    inventoryDecrementedAt: null,
  })
    .sort({ inventoryReservedAt: 1, _id: 1 })
    .limit(batchLimit)
    .exec();
}

async function reconcileExpiredReservation({
  order,
  OrderModel,
  stripe,
  releaseReservation,
  finalizeReservation,
}) {
  let paymentIntent = null;

  if (order.paymentId) {
    try {
      paymentIntent = await stripe.paymentIntents.cancel(order.paymentId, {
        cancellation_reason: 'abandoned',
      });
    } catch (cancelError) {
      paymentIntent = await stripe.paymentIntents.retrieve(order.paymentId);
      if (paymentIntent?.status !== 'canceled') {
        if (paymentIntent?.status === 'succeeded') {
          await OrderModel.findByIdAndUpdate(order._id, {
            paymentStatus: 'paid',
            status: 'ordered',
          });
          order.paymentStatus = 'paid';
          order.status = 'ordered';
          await finalizeReservation(order);
          return { action: 'finalized_succeeded_payment' };
        }
        throw cancelError;
      }
    }
  }

  if (order.paymentId && paymentIntent?.status !== 'canceled') {
    throw new Error(
      `PaymentIntent ${order.paymentId} was not canceled before inventory release`
    );
  }

  const released = await releaseReservation(order);
  if (released.restored) {
    await OrderModel.findByIdAndUpdate(order._id, {
      paymentStatus: 'failed',
      status: 'cancelled',
    });
  }

  return {
    action: released.restored ? 'released_expired_reservation' : 'already_reconciled',
  };
}

async function runInventoryReservationExpiryBatch({
  config = getInventoryReservationExpiryConfig(),
  now = Date.now(),
  OrderModel = Order,
  stripe = null,
  releaseReservation = releaseInventoryReservation,
  finalizeReservation = decrementInventoryForPaidOrder,
} = {}) {
  if (!config.enabled) return { enabled: false, processed: 0, results: [] };

  const expired = await loadExpiredReservations({
    OrderModel,
    cutoff: getReservationCutoff(config.ttlMinutes, now),
    batchLimit: config.batchLimit,
  });
  const stripeClient =
    stripe || (expired.some((order) => order.paymentId)
      ? new Stripe(process.env.STRIPE_SECRET_KEY)
      : null);
  const results = [];

  for (const order of expired) {
    try {
      const result = await reconcileExpiredReservation({
        order,
        OrderModel,
        stripe: stripeClient,
        releaseReservation,
        finalizeReservation,
      });
      results.push({ orderId: String(order._id), ...result });
    } catch (error) {
      console.error(
        `Failed to reconcile expired inventory reservation for order ${order._id}:`,
        error
      );
      results.push({
        orderId: String(order._id),
        action: 'failed',
        error: error?.message || 'Unknown reservation expiry error',
      });
    }
  }

  if (expired.length) {
    console.log(
      `Inventory reservation expiry batch complete: processed=${expired.length}`
    );
  }
  return { enabled: true, processed: expired.length, results };
}

function startInventoryReservationExpiryScheduler() {
  const config = getInventoryReservationExpiryConfig();

  if (!config.enabled) {
    console.log(
      'Inventory reservation expiry scheduler disabled (set ENABLE_INVENTORY_RESERVATION_EXPIRY=true after TTL approval)'
    );
    return null;
  }
  if (!cron.validate(config.cronExpression)) {
    console.error(
      `Invalid INVENTORY_RESERVATION_EXPIRY_CRON expression: ${config.cronExpression}`
    );
    return null;
  }

  const task = cron.schedule(config.cronExpression, async () => {
    try {
      await runInventoryReservationExpiryBatch({ config });
    } catch (error) {
      console.error(
        'Inventory reservation expiry batch failed:',
        error?.message || 'Unknown reservation expiry error'
      );
    }
  });

  console.log(
    `Inventory reservation expiry scheduler started (cron: ${config.cronExpression}, ttlMinutes: ${config.ttlMinutes})`
  );
  return task;
}

module.exports = {
  getInventoryReservationExpiryConfig,
  getReservationCutoff,
  reconcileExpiredReservation,
  runInventoryReservationExpiryBatch,
  startInventoryReservationExpiryScheduler,
};
