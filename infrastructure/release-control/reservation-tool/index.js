#!/usr/bin/env node
'use strict';

const ACTIVE_RESERVATION_FILTER = Object.freeze({
  inventoryReservedAt: { $ne: null },
  inventoryDecrementedAt: null,
  inventoryRestoredAt: null,
});

// This closes the continuous release-safety handoff: before payment, the
// inventory reservation blocks; after payment reconciliation, the order stays
// blocked until paid-order delivery reaches its aggregate terminal marker.
const INCOMPLETE_PAID_ORDER_FILTER = Object.freeze({
  paymentStatus: 'paid',
  paidConfirmationEmailSentAt: null,
});

// Any non-paid order that still references an issued PaymentIntent can become
// paid after checkout initiation is gated. It therefore remains a cutover
// liability until an operator proves the intent canceled and clears the
// reference, or the complete paid-order workflow reaches its terminal marker.
const UNRESOLVED_PAYMENT_INTENT_FILTER = Object.freeze({
  paymentId: { $exists: true, $type: 'string', $ne: '' },
  paymentStatus: { $ne: 'paid' },
});

const RELEASE_BLOCKER_PIPELINE = Object.freeze([
  {
    $facet: {
      activeReservations: [
        { $match: ACTIVE_RESERVATION_FILTER },
        { $count: 'count' },
      ],
      incompletePaidOrders: [
        { $match: INCOMPLETE_PAID_ORDER_FILTER },
        { $count: 'count' },
      ],
      unresolvedPaymentIntents: [
        { $match: UNRESOLVED_PAYMENT_INTENT_FILTER },
        { $count: 'count' },
      ],
    },
  },
  {
    $project: {
      _id: 0,
      activeReservationCount: {
        $ifNull: [{ $arrayElemAt: ['$activeReservations.count', 0] }, 0],
      },
      incompletePaidOrderCount: {
        $ifNull: [{ $arrayElemAt: ['$incompletePaidOrders.count', 0] }, 0],
      },
      unresolvedPaymentIntentCount: {
        $ifNull: [{ $arrayElemAt: ['$unresolvedPaymentIntents.count', 0] }, 0],
      },
    },
  },
]);

async function countReleaseBlockers({
  uri = process.env.MONGODB_URI,
  MongoClientClass,
} = {}) {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('Production database connection is unavailable');
  }

  const Client = MongoClientClass || require('mongodb').MongoClient;
  const client = new Client(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    readPreference: 'primary',
    retryWrites: false,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 15000,
  });
  await client.connect();
  try {
    const orders = client.db().collection('orders');
    const rows = await orders.aggregate(RELEASE_BLOCKER_PIPELINE, {
      maxTimeMS: 10000,
      allowDiskUse: false,
      readConcern: { level: 'majority' },
    }).toArray();
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error('Release-blocking aggregation returned an invalid result');
    }
    const {
      activeReservationCount,
      incompletePaidOrderCount,
      unresolvedPaymentIntentCount,
    } = rows[0];
    if (
      !Number.isSafeInteger(activeReservationCount)
      || activeReservationCount < 0
      || !Number.isSafeInteger(incompletePaidOrderCount)
      || incompletePaidOrderCount < 0
      || !Number.isSafeInteger(unresolvedPaymentIntentCount)
      || unresolvedPaymentIntentCount < 0
    ) {
      throw new Error('Release-blocking count is invalid');
    }
    return {
      activeReservationCount,
      incompletePaidOrderCount,
      unresolvedPaymentIntentCount,
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const counts = await countReleaseBlockers();
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}

if (require.main === module) {
  main().catch(() => {
    // Never echo driver errors: they can contain connection details.
    process.stderr.write('Trusted reservation count could not complete\n');
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIVE_RESERVATION_FILTER,
  INCOMPLETE_PAID_ORDER_FILTER,
  RELEASE_BLOCKER_PIPELINE,
  UNRESOLVED_PAYMENT_INTENT_FILTER,
  countReleaseBlockers,
  main,
};
