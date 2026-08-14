#!/usr/bin/env node
'use strict';

require('dotenv').config();

const ACTIVE_RESERVATION_FILTER = Object.freeze({
  inventoryReservedAt: { $ne: null },
  inventoryDecrementedAt: null,
  inventoryRestoredAt: null,
});

const ACTIVE_RESERVATION_PROJECTION = Object.freeze({
  _id: 1,
  paymentId: 1,
  paymentStatus: 1,
  status: 1,
  inventoryReservedAt: 1,
  inventoryAdjustments: 1,
});

function parseMode(argv) {
  const supported = new Set(['--report', '--require-zero', '--count-json']);
  if (argv.length !== 1 || !supported.has(argv[0])) {
    throw new Error(
      'Usage: query-active-reservations.js --report|--require-zero|--count-json'
    );
  }
  return argv[0];
}

async function queryActiveReservations(OrderModel) {
  return OrderModel.find(ACTIVE_RESERVATION_FILTER, ACTIVE_RESERVATION_PROJECTION)
    .sort({ inventoryReservedAt: 1 })
    .lean()
    .exec();
}

async function queryActiveReservationCount(OrderModel) {
  return OrderModel.countDocuments(ACTIVE_RESERVATION_FILTER).exec();
}

function printableReservation(order) {
  return {
    orderId: String(order._id),
    paymentId: order.paymentId || null,
    paymentStatus: order.paymentStatus || null,
    status: order.status || null,
    inventoryReservedAt: order.inventoryReservedAt || null,
    inventoryAdjustments: order.inventoryAdjustments || [],
  };
}

async function run({ mode, mongoose, OrderModel, mongoUri, logger = console }) {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required; the connection value is never printed');
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    if (mode === '--count-json') {
      const count = await queryActiveReservationCount(OrderModel);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Reservation count was not a non-negative safe integer');
      }
      // This mode is the only supported automation/SSM interface. Its stdout is
      // deliberately a one-field JSON object and can never contain order data.
      logger.log(JSON.stringify({ activeReservationCount: count }));
      return count;
    }

    const reservations = await queryActiveReservations(OrderModel);
    logger.log(`Active inventory reservations: ${reservations.length}`);
    for (const order of reservations) {
      logger.log(JSON.stringify(printableReservation(order)));
    }

    if (mode === '--require-zero' && reservations.length !== 0) {
      throw new Error(`Expected zero active reservations; found ${reservations.length}`);
    }

    return reservations.length;
  } finally {
    await mongoose.disconnect();
  }
}

async function main(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  const mongoose = require('mongoose');
  const OrderModel = require('../../models/Order');

  await run({
    mode,
    mongoose,
    OrderModel,
    mongoUri: process.env.MONGODB_URI,
  });
}

if (require.main === module) {
  main().catch((error) => {
    const safeMessages = [
      'MONGODB_URI is required; the connection value is never printed',
      'Reservation count was not a non-negative safe integer',
    ];
    const safeMessage = safeMessages.includes(error.message)
      ? error.message
      : /^Expected zero active reservations; found \d+$/.test(error.message)
        ? error.message
        : 'Read-only reservation query could not complete';
    console.error(`Active-reservation query failed: ${safeMessage}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIVE_RESERVATION_FILTER,
  ACTIVE_RESERVATION_PROJECTION,
  parseMode,
  queryActiveReservationCount,
  queryActiveReservations,
  printableReservation,
  run,
};
