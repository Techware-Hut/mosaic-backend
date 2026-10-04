#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

// Release-only reconciliation. This module is inert unless invoked as a CLI.
// The restricted mapping belongs only in the internal ledger. The normal
// admin audit API returns its events verbatim on the deployed baseline.
const ACTION_CODE = 'release_terminal_payment_reference_retirement';
const CONFIRMATION = 'RETIRE_TERMINAL_PAYMENT_REFERENCES';
const REASON = 'release_cutover_terminal_reference_retirement';
const EXPECTED = Object.freeze({ A1: 5, B: 3, total: 8 });
const REQUIRED_LEDGER_INDEXES = Object.freeze([
  Object.freeze({ field: 'ledgerEntryId', name: 'ledgerEntryId_1' }),
  Object.freeze({ field: 'orderId', name: 'orderId_1' }),
  Object.freeze({ field: 'priorPaymentId', name: 'priorPaymentId_1' }),
]);
const A1_STATUSES = new Set(['refunded', 'rejected', 'cancelled']);
const PAYMENT_REFERENCE = { $exists: true, $type: 'string', $ne: '' };
const ORDER_FIELDS = '_id paymentId paymentStatus status totalAmount currency inventoryReservedAt inventoryDecrementedAt inventoryRestoredAt';

function blocked(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function parseArgs(argv) {
  let mode = 'dry-run';
  let modeSeen = false;
  let confirmSeen = false;
  let confirmation = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--apply') {
      if (modeSeen) blocked('DUPLICATE_OR_CONFLICTING_MODE');
      modeSeen = true;
      mode = arg === '--apply' ? 'apply' : 'dry-run';
    } else if (arg === '--confirm') {
      if (confirmSeen || i + 1 >= argv.length) blocked('INVALID_CONFIRMATION');
      confirmSeen = true;
      confirmation = argv[++i];
    } else {
      blocked('UNKNOWN_ARGUMENT');
    }
  }
  if (mode === 'apply' && confirmation !== CONFIRMATION) blocked('APPLY_CONFIRMATION_REQUIRED');
  if (mode !== 'apply' && confirmSeen) blocked('CONFIRMATION_WITHOUT_APPLY');
  return { mode };
}

function validateActor(actorUserId) {
  if (typeof actorUserId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(actorUserId)) {
    blocked('VALID_ACTOR_USER_ID_REQUIRED');
  }
  return actorUserId;
}

function discoveryQuery() {
  return {
    paymentId: PAYMENT_REFERENCE,
    $or: [
      { paymentStatus: 'refunded' },
      {
        paymentStatus: 'failed', status: 'cancelled',
        inventoryReservedAt: null, inventoryDecrementedAt: null,
      },
    ],
  };
}

function mongoClass(order) {
  if (!order || typeof order.paymentId !== 'string' || !order.paymentId.trim()) return null;
  const hasActiveReservation = order.inventoryReservedAt != null
    && order.inventoryDecrementedAt == null && order.inventoryRestoredAt == null;
  if (order.paymentStatus === 'refunded' && A1_STATUSES.has(order.status)
      && !hasActiveReservation) return 'A1';
  if (order.paymentStatus === 'failed' && order.status === 'cancelled'
      && order.inventoryReservedAt == null && order.inventoryDecrementedAt == null) return 'B';
  return null;
}

function sameDate(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return new Date(a).getTime() === new Date(b).getTime();
}

function mongoStateUnchanged(before, current) {
  return !!current && String(current._id) === String(before._id)
    && current.paymentId === before.paymentId
    && current.paymentStatus === before.paymentStatus
    && current.status === before.status
    && current.totalAmount === before.totalAmount
    && current.currency === before.currency
    && sameDate(current.inventoryReservedAt, before.inventoryReservedAt)
    && sameDate(current.inventoryDecrementedAt, before.inventoryDecrementedAt)
    && sameDate(current.inventoryRestoredAt, before.inventoryRestoredAt)
    && mongoClass(current) === mongoClass(before);
}

async function stripeRead(call) {
  try { return await call(); } catch (_error) { blocked('STRIPE_READ_FAILED'); }
}

async function stripeEligibility(order, classification, stripe) {
  const intent = await stripeRead(() => stripe.paymentIntents.retrieve(order.paymentId));
  if (!intent || intent.id !== order.paymentId) return false;
  const metadataOrder = intent.metadata?.orderId;
  if (metadataOrder != null && metadataOrder !== '' && metadataOrder !== String(order._id)) return false;
  if (classification === 'B') return intent.status === 'canceled';
  if (classification !== 'A1' || intent.status !== 'succeeded'
      || typeof intent.latest_charge !== 'string' || !intent.latest_charge) return false;

  const charge = await stripeRead(() => stripe.charges.retrieve(intent.latest_charge));
  if (!charge || charge.id !== intent.latest_charge || charge.payment_intent !== intent.id
      || charge.paid !== true || charge.status !== 'succeeded' || charge.refunded !== true
      || charge.disputed !== false || !Number.isSafeInteger(charge.amount)
      || charge.amount <= 0 || charge.amount_refunded !== charge.amount
      || !Number.isSafeInteger(intent.amount) || intent.amount_received !== charge.amount
      || !Number.isFinite(order.totalAmount)
      || Math.round(order.totalAmount * 100) !== intent.amount
      || typeof order.currency !== 'string'
      || order.currency.toLowerCase() !== intent.currency
      || charge.currency !== intent.currency) return false;

  const refunds = await stripeRead(() => stripe.refunds.list({ charge: charge.id, limit: 100 }));
  const disputes = await stripeRead(() => stripe.disputes.list({ charge: charge.id, limit: 100 }));
  if (!refunds || !Array.isArray(refunds.data) || refunds.has_more !== false
      || refunds.data.length !== 1) return false;
  const refund = refunds.data[0];
  if (!refund || refund.status !== 'succeeded' || refund.amount !== charge.amount
      || refund.charge !== charge.id) return false;
  return !!disputes && Array.isArray(disputes.data)
    && disputes.has_more === false && disputes.data.length === 0;
}

function isPriorLedger(entry) {
  return !!entry && entry.outcome === 'success' && entry.reason === REASON
    && typeof entry.ledgerEntryId === 'string' && entry.ledgerEntryId.length > 0
    && entry.orderId != null && typeof entry.priorPaymentId === 'string'
    && entry.priorPaymentId.length > 0 && ['A1', 'B'].includes(entry.classification);
}

function ledgerCollectionName(ReleaseReconciliationLedger) {
  const name = ReleaseReconciliationLedger?.collection?.name
    || ReleaseReconciliationLedger?.collection?.collectionName;
  if (typeof name !== 'string' || !name) blocked('LEDGER_STORAGE_NOT_PREPARED');
  return name;
}

async function ledgerCollectionExists({ mongoose, ReleaseReconciliationLedger }) {
  const db = mongoose?.connection?.db || ReleaseReconciliationLedger?.db?.db;
  if (!db || typeof db.listCollections !== 'function') blocked('LEDGER_STORAGE_NOT_PREPARED');
  const name = ledgerCollectionName(ReleaseReconciliationLedger);
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return Array.isArray(matches) && matches.some((collection) => collection.name === name);
}

function indexMatches(index, required) {
  return !!index && index.name === required.name && index.unique === true
    && index.key && Object.keys(index.key).length === 1 && index.key[required.field] === 1;
}

function assertLedgerIndexes(indexes) {
  if (!Array.isArray(indexes)) blocked('LEDGER_STORAGE_NOT_PREPARED');
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    const required = REQUIRED_LEDGER_INDEXES.find((candidate) =>
      Object.prototype.hasOwnProperty.call(index.key || {}, candidate.field));
    if (!required || !indexMatches(index, required)) blocked('LEDGER_STORAGE_NOT_PREPARED');
  }
  for (const required of REQUIRED_LEDGER_INDEXES) {
    if (!indexes.some((index) => indexMatches(index, required))) {
      blocked('LEDGER_STORAGE_NOT_PREPARED');
    }
  }
  return true;
}

async function verifyLedgerStoragePrepared({ mongoose, ReleaseReconciliationLedger }) {
  if (!await ledgerCollectionExists({ mongoose, ReleaseReconciliationLedger })) {
    blocked('LEDGER_STORAGE_NOT_PREPARED');
  }
  const indexes = await ReleaseReconciliationLedger.collection.indexes();
  return assertLedgerIndexes(indexes);
}

async function readPriorLedger({ mongoose, ReleaseReconciliationLedger, requirePrepared = false }) {
  const exists = await ledgerCollectionExists({ mongoose, ReleaseReconciliationLedger });
  if (!exists) {
    if (requirePrepared) blocked('LEDGER_STORAGE_NOT_PREPARED');
    return [];
  }
  if (requirePrepared) await verifyLedgerStoragePrepared({ mongoose, ReleaseReconciliationLedger });
  return ReleaseReconciliationLedger.find({ reason: REASON, outcome: 'success' })
    .select('ledgerEntryId orderId priorPaymentId classification reason outcome').lean();
}

async function discover({ Order, ReleaseReconciliationLedger, mongoose, stripe,
  requireLedgerStorage = false }) {
  const orders = await Order.find(discoveryQuery()).select(ORDER_FIELDS).lean();
  if (!Array.isArray(orders) || orders.length > 1000) blocked('INVALID_DISCOVERY_RESULT');
  const priorLedger = await readPriorLedger({
    mongoose, ReleaseReconciliationLedger, requirePrepared: requireLedgerStorage,
  });
  if (!Array.isArray(priorLedger) || priorLedger.some((entry) => !isPriorLedger(entry))) {
    blocked('INVALID_PRIOR_LEDGER');
  }
  const priorTargets = new Set(priorLedger.map((entry) => String(entry.orderId)));
  const priorPaymentIds = new Set(priorLedger.map((entry) => entry.priorPaymentId));
  if (priorTargets.size !== priorLedger.length || priorPaymentIds.size !== priorLedger.length) {
    blocked('DUPLICATE_PRIOR_LEDGER');
  }
  const seenPaymentIds = new Set();
  const eligible = [];
  let ineligible = 0;
  for (const order of orders) {
    if (typeof order?.paymentId !== 'string' || seenPaymentIds.has(order.paymentId)) {
      blocked('DUPLICATE_OR_INVALID_PAYMENT_REFERENCE');
    }
    seenPaymentIds.add(order.paymentId);
    const classification = mongoClass(order);
    if (!classification || priorTargets.has(String(order._id))
        || priorPaymentIds.has(order.paymentId)) {
      ineligible += 1;
      continue;
    }
    if (await stripeEligibility(order, classification, stripe)) eligible.push({ order, classification });
    else ineligible += 1;
  }
  eligible.sort((a, b) => String(a.order._id).localeCompare(String(b.order._id)));
  const A1 = eligible.filter((item) => item.classification === 'A1').length;
  const B = eligible.filter((item) => item.classification === 'B').length;
  return {
    eligible,
    summary: {
      A1Eligible: A1,
      BEligible: B,
      alreadyReconciled: priorLedger.length,
      driftedIneligible: ineligible,
      totalEligible: eligible.length,
    },
  };
}

function conditionalFilter(order) {
  return {
    _id: order._id,
    paymentId: order.paymentId,
    paymentStatus: order.paymentStatus,
    status: order.status,
    totalAmount: order.totalAmount,
    currency: order.currency,
    inventoryReservedAt: order.inventoryReservedAt ?? null,
    inventoryDecrementedAt: order.inventoryDecrementedAt ?? null,
    inventoryRestoredAt: order.inventoryRestoredAt ?? null,
  };
}

async function applyAll({ eligible, actorUserId, Order, ReleaseReconciliationLedger,
  AdminAuditEvent, User, mongoose, stripe }) {
  validateActor(actorUserId);
  if (!await User.exists({ _id: actorUserId, role: 'admin' })) blocked('ACTOR_NOT_ADMIN');
  // A terminal Stripe state is checked again immediately before the Mongo transaction.
  for (const item of eligible) {
    if (!await stripeEligibility(item.order, item.classification, stripe)) {
      blocked('STRIPE_STATE_CHANGED');
    }
  }
  const session = await mongoose.startSession();
  if (!session || typeof session.withTransaction !== 'function') blocked('TRANSACTION_UNAVAILABLE');
  try {
    await session.withTransaction(async () => {
      for (const { order, classification } of eligible) {
        const current = await Order.findOne({ _id: order._id }).select(ORDER_FIELDS).session(session).lean();
        if (!mongoStateUnchanged(order, current)) blocked('ORDER_STATE_CHANGED');
        const prior = await ReleaseReconciliationLedger.findOne({ orderId: order._id })
          .session(session).lean();
        if (prior) blocked('ALREADY_RECONCILED');
        const ledgerEntryId = crypto.randomUUID();
        const safeSummary = {
          classification,
          priorPaymentStatus: order.paymentStatus,
          priorOrderStatus: order.status,
          stripeTerminalStatus: classification === 'A1' ? 'succeeded' : 'canceled',
          reason: REASON,
        };
        const ledgerEntry = {
          ledgerEntryId,
          orderId: order._id,
          priorPaymentId: order.paymentId,
          ...safeSummary,
          actorUserId,
          outcome: 'success',
        };
        const insertedLedger = await ReleaseReconciliationLedger.create([ledgerEntry], { session });
        if (!Array.isArray(insertedLedger) || insertedLedger.length !== 1) {
          blocked('LEDGER_INSERT_FAILED');
        }
        const event = {
          actorUserId,
          actorRole: 'release_operator',
          actionCode: ACTION_CODE,
          targetType: 'ReleaseReconciliationLedger',
          targetId: ledgerEntryId,
          outcome: 'success',
          changeSummary: safeSummary,
        };
        const inserted = await AdminAuditEvent.create([event], { session });
        if (!Array.isArray(inserted) || inserted.length !== 1) blocked('AUDIT_INSERT_FAILED');
        const result = await Order.updateOne(
          conditionalFilter(order), { $unset: { paymentId: '' } },
          { session, timestamps: false }
        );
        if (result?.matchedCount !== 1 || result?.modifiedCount !== 1) {
          blocked('PAYMENT_REFERENCE_CLEAR_FAILED');
        }
      }
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
  } catch (error) {
    if (error?.safeCode) throw error;
    blocked('TRANSACTION_FAILED');
  } finally {
    await session.endSession();
  }
}

async function run({ argv, env, deps }) {
  const { mode } = parseArgs(argv);
  const actorUserId = mode === 'apply' ? validateActor(env.RECONCILIATION_ACTOR_USER_ID) : null;
  if (mode === 'apply') await verifyLedgerStoragePrepared(deps);
  const { eligible, summary } = await discover({
    ...deps, requireLedgerStorage: mode === 'apply',
  });
  if (mode === 'dry-run') return { mode, ...summary, applied: 0 };
  if (summary.A1Eligible !== EXPECTED.A1 || summary.BEligible !== EXPECTED.B
      || summary.totalEligible !== EXPECTED.total) blocked('EXPECTED_COUNT_DRIFT');
  await applyAll({ eligible, actorUserId, ...deps });
  return { mode, ...summary, applied: EXPECTED.total };
}

async function main() {
  // Argument and actor checks precede all connection and Stripe setup.
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.mode === 'apply') validateActor(process.env.RECONCILIATION_ACTOR_USER_ID);
  if (!process.env.MONGODB_URI || !process.env.STRIPE_SECRET_KEY) blocked('CONNECTION_CONFIG_REQUIRED');
  const mongoose = require('mongoose');
  const Stripe = require('stripe');
  const deps = {
    mongoose,
    Order: require('../../models/Order'),
    AdminAuditEvent: require('../../models/AdminAuditEvent'),
    ReleaseReconciliationLedger: require('../../models/ReleaseReconciliationLedger'),
    User: require('../../models/User'),
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 10000 }),
  };
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const result = await run({ argv: process.argv.slice(2), env: process.env, deps });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`BLOCKED: ${error?.safeCode || 'UNEXPECTED_FAILURE'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTION_CODE, CONFIRMATION, EXPECTED, parseArgs, validateActor,
  discoveryQuery, mongoClass, mongoStateUnchanged, stripeEligibility,
  ledgerCollectionName, ledgerCollectionExists, assertLedgerIndexes,
  verifyLedgerStoragePrepared, readPriorLedger,
  discover, conditionalFilter, applyAll, run,
  REQUIRED_LEDGER_INDEXES,
};
