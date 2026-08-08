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
  const supported = new Set(['--report', '--require-zero']);
  if (argv.length !== 1 || !supported.has(argv[0])) {
    throw new Error('Usage: query-active-reservations.js --report|--require-zero');
  }
  return argv[0];
}

async function queryActiveReservations(OrderModel) {
  return OrderModel.find(ACTIVE_RESERVATION_FILTER, ACTIVE_RESERVATION_PROJECTION)
    .sort({ inventoryReservedAt: 1 })
    .lean()
    .exec();
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

async function run({ mode, mongoose, OrderModel, mongoUri }) {
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required; the connection value is never printed');
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    const reservations = await queryActiveReservations(OrderModel);
    console.log(`Active inventory reservations: ${reservations.length}`);
    for (const order of reservations) {
      console.log(JSON.stringify(printableReservation(order)));
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
    console.error(`Active-reservation query failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIVE_RESERVATION_FILTER,
  ACTIVE_RESERVATION_PROJECTION,
  parseMode,
  queryActiveReservations,
  printableReservation,
  run,
};
