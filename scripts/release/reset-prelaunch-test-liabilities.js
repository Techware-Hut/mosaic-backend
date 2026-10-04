#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const {
  ACTIVE_RESERVATION_FILTER,
  INCOMPLETE_PAID_ORDER_FILTER,
  UNRESOLVED_PAYMENT_INTENT_FILTER,
  countReleaseBlockers,
} = require('../../infrastructure/release-control/reservation-tool');

const ACTION_CODE = 'release_prelaunch_test_liability_reset';
const APPLY_CONFIRMATION = 'RESET_PRELAUNCH_TEST_LIABILITIES';
const BUSINESS_REASON = 'prelaunch_test_data_retirement';
const EXPECTED = Object.freeze({ A1: 5, B: 3, D: 21, G: 34, H: 1, total: 63 });
const REQUIRED_ARCHIVE_INDEXES = Object.freeze([
  Object.freeze({ field: 'archiveEntryId', name: 'archiveEntryId_1' }),
  Object.freeze({ field: 'sourceOrderId', name: 'sourceOrderId_1' }),
]);
const ORDER_FIELDS = [
  '_id', 'paymentId', 'paymentStatus', 'status', 'totalAmount', 'currency',
  'inventoryReservedAt', 'inventoryDecrementedAt', 'inventoryRestoredAt',
  'inventoryAdjustments', 'inventoryAdjustmentVersion',
  'paidConfirmationEmailSentAt', 'paidOrderEmailDelivery', 'items',
].join(' ');
const TERMINAL_REFUNDED_STATUSES = new Set(['refunded', 'rejected', 'cancelled']);

function blocked(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function parseArgs(argv) {
  let mode = 'dry-run';
  let modeSeen = false;
  let confirmSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--apply' || arg === '--verify-reset') {
      if (modeSeen) blocked('DUPLICATE_OR_CONFLICTING_MODE');
      modeSeen = true;
      mode = arg.slice(2);
    } else if (arg === '--confirm') {
      if (confirmSeen || i + 1 >= argv.length) blocked('INVALID_CONFIRMATION');
      confirmSeen = true;
      if (argv[++i] !== APPLY_CONFIRMATION) blocked('APPLY_CONFIRMATION_REQUIRED');
    } else {
      blocked('UNKNOWN_ARGUMENT');
    }
  }
  if (mode === 'apply' && !confirmSeen) blocked('APPLY_CONFIRMATION_REQUIRED');
  if (mode !== 'apply' && confirmSeen) blocked('CONFIRMATION_WITHOUT_APPLY');
  return { mode };
}

function validateActor(actorUserId) {
  if (typeof actorUserId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(actorUserId)) {
    blocked('VALID_ACTOR_USER_ID_REQUIRED');
  }
  return actorUserId;
}

function validateSourceSha(env) {
  const expected = env.RESET_EXPECTED_SOURCE_SHA;
  const actual = env.RESET_SOURCE_BACKEND_SHA;
  if (!/^[0-9a-f]{40}$/i.test(expected || '') || actual !== expected) {
    blocked('SOURCE_SHA_MISMATCH');
  }
  return actual;
}

function ensureCheckoutGated(env) {
  if (env.CHECKOUT_INITIATION_GATED !== 'true') blocked('CHECKOUT_GATE_REQUIRED');
}

function discoveryQuery() {
  return {
    $or: [
      ACTIVE_RESERVATION_FILTER,
      INCOMPLETE_PAID_ORDER_FILTER,
      UNRESOLVED_PAYMENT_INTENT_FILTER,
    ],
  };
}

function hasPaymentReference(order) {
  return typeof order?.paymentId === 'string' && order.paymentId.trim() !== '';
}

function hasActiveReservation(order) {
  return order?.inventoryReservedAt != null
    && order.inventoryDecrementedAt == null
    && order.inventoryRestoredAt == null;
}

function matchesG(order) {
  return order?.paymentStatus === 'paid' && order.paidConfirmationEmailSentAt == null;
}

function assertTestMode(object) {
  if (object && object.livemode !== false) blocked('LIVE_STRIPE_OBJECT');
}

async function stripeRead(call) {
  try { return await call(); } catch (_error) { blocked('STRIPE_READ_FAILED'); }
}

async function stripeClassify(order, stripe) {
  if (!hasPaymentReference(order)) return { classification: null, stripeSummary: { hasPaymentId: false } };
  const intent = await stripeRead(() => stripe.paymentIntents.retrieve(order.paymentId));
  if (!intent || intent.id !== order.paymentId) blocked('STRIPE_STATE_CHANGED');
  assertTestMode(intent);
  const summary = {
    paymentIntentStatus: intent.status,
    paymentIntentLivemode: intent.livemode,
    hasLatestCharge: typeof intent.latest_charge === 'string' && intent.latest_charge.length > 0,
  };

  if (order.paymentStatus === 'refunded' && TERMINAL_REFUNDED_STATUSES.has(order.status)
      && !hasActiveReservation(order)) {
    if (intent.status !== 'succeeded' || !summary.hasLatestCharge) blocked('STRIPE_STATE_CHANGED');
    const charge = await stripeRead(() => stripe.charges.retrieve(intent.latest_charge));
    assertTestMode(charge);
    if (!charge || charge.payment_intent !== intent.id || charge.paid !== true
        || charge.status !== 'succeeded' || charge.refunded !== true
        || charge.disputed !== false || charge.amount_refunded !== charge.amount) {
      blocked('STRIPE_STATE_CHANGED');
    }
    const refunds = await stripeRead(() => stripe.refunds.list({ charge: charge.id, limit: 100 }));
    const disputes = await stripeRead(() => stripe.disputes.list({ charge: charge.id, limit: 100 }));
    if (!refunds || !Array.isArray(refunds.data) || refunds.has_more !== false
        || refunds.data.length !== 1) blocked('STRIPE_STATE_CHANGED');
    const refund = refunds.data[0];
    assertTestMode(refund);
    if (!refund || refund.status !== 'succeeded' || refund.amount !== charge.amount
        || refund.charge !== charge.id) blocked('STRIPE_STATE_CHANGED');
    if (!disputes || !Array.isArray(disputes.data) || disputes.has_more !== false
        || disputes.data.length !== 0) blocked('STRIPE_STATE_CHANGED');
    return {
      classification: 'A1',
      stripeSummary: { ...summary, chargeStatus: charge.status, refundStatus: refund.status, disputeCount: 0 },
    };
  }

  if (order.paymentStatus === 'failed' && order.status === 'cancelled'
      && !hasActiveReservation(order)) {
    if (intent.status !== 'canceled') blocked('STRIPE_STATE_CHANGED');
    return { classification: 'B', stripeSummary: summary };
  }

  if (order.paymentStatus !== 'paid') {
    if (intent.status !== 'requires_payment_method') blocked('STRIPE_STATE_CHANGED');
    return { classification: 'D', stripeSummary: summary };
  }

  if (matchesG(order)) return { classification: 'G', stripeSummary: summary };
  return { classification: null, stripeSummary: summary };
}

async function classifyOrder(order, stripe) {
  if (matchesG(order) && !hasPaymentReference(order)) {
    return { order, classification: 'G', hOverlay: false, stripeSummary: { hasPaymentId: false } };
  }
  const { classification, stripeSummary } = await stripeClassify(order, stripe);
  return { order, classification, hOverlay: hasActiveReservation(order), stripeSummary };
}

function summarizeClassified(classified) {
  const summary = { A1: 0, B: 0, D: 0, G: 0, H: 0, total: classified.length };
  for (const item of classified) {
    if (summary[item.classification] == null) blocked('UNCLASSIFIED_ORDER');
    summary[item.classification] += 1;
    if (item.hOverlay) summary.H += 1;
  }
  return summary;
}

function assertExpectedSummary(summary) {
  for (const [key, value] of Object.entries(EXPECTED)) {
    if (summary[key] !== value) blocked('EXPECTED_COUNT_DRIFT');
  }
}

async function discover({ Order, stripe }) {
  const rows = await Order.find(discoveryQuery()).select(ORDER_FIELDS).lean();
  if (!Array.isArray(rows) || rows.length > 200) blocked('INVALID_DISCOVERY_RESULT');
  const seen = new Set();
  const classified = [];
  for (const order of rows) {
    const id = String(order?._id || '');
    if (!id || seen.has(id)) blocked('DUPLICATE_OR_INVALID_ORDER');
    seen.add(id);
    const item = await classifyOrder(order, stripe);
    if (!item.classification) blocked('UNCLASSIFIED_ORDER');
    classified.push(item);
  }
  const summary = summarizeClassified(classified);
  assertExpectedSummary(summary);
  if (classified.filter((item) => item.hOverlay && item.classification === 'D').length !== EXPECTED.H) {
    blocked('H_OVERLAY_MISMATCH');
  }
  return { classified, summary };
}

function archiveCollectionName(PrelaunchTestOrderArchive) {
  const name = PrelaunchTestOrderArchive?.collection?.name
    || PrelaunchTestOrderArchive?.collection?.collectionName;
  if (typeof name !== 'string' || !name) blocked('ARCHIVE_STORAGE_NOT_PREPARED');
  return name;
}

async function archiveCollectionExists({ mongoose, PrelaunchTestOrderArchive }) {
  const db = mongoose?.connection?.db || PrelaunchTestOrderArchive?.db?.db;
  if (!db || typeof db.listCollections !== 'function') blocked('ARCHIVE_STORAGE_NOT_PREPARED');
  const name = archiveCollectionName(PrelaunchTestOrderArchive);
  const matches = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return Array.isArray(matches) && matches.some((collection) => collection.name === name);
}

function indexMatches(index, required) {
  return !!index && index.name === required.name && index.unique === true
    && index.key && Object.keys(index.key).length === 1 && index.key[required.field] === 1;
}

function assertArchiveIndexes(indexes) {
  if (!Array.isArray(indexes)) blocked('ARCHIVE_STORAGE_NOT_PREPARED');
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    const required = REQUIRED_ARCHIVE_INDEXES.find((candidate) =>
      Object.prototype.hasOwnProperty.call(index.key || {}, candidate.field));
    if (!required || !indexMatches(index, required)) blocked('ARCHIVE_STORAGE_NOT_PREPARED');
  }
  for (const required of REQUIRED_ARCHIVE_INDEXES) {
    if (!indexes.some((index) => indexMatches(index, required))) {
      blocked('ARCHIVE_STORAGE_NOT_PREPARED');
    }
  }
  return true;
}

async function verifyArchiveStoragePrepared({ mongoose, PrelaunchTestOrderArchive }) {
  if (!await archiveCollectionExists({ mongoose, PrelaunchTestOrderArchive })) {
    blocked('ARCHIVE_STORAGE_NOT_PREPARED');
  }
  return assertArchiveIndexes(await PrelaunchTestOrderArchive.collection.indexes());
}

async function cancelDIntents(classified, stripe) {
  for (const item of classified.filter((entry) => entry.classification === 'D')) {
    const current = await stripeRead(() => stripe.paymentIntents.retrieve(item.order.paymentId));
    assertTestMode(current);
    if (current.status !== 'requires_payment_method') blocked('STRIPE_STATE_CHANGED');
    const canceled = await stripeRead(() => stripe.paymentIntents.cancel(current.id));
    assertTestMode(canceled);
    if (!canceled || canceled.status !== 'canceled') blocked('STRIPE_CANCEL_FAILED');
    item.stripeSummary = { ...item.stripeSummary, canceledStatus: canceled.status };
  }
}

async function restoreHReservation(classified, releaseInventoryReservation) {
  const hItems = classified.filter((item) => item.hOverlay);
  if (hItems.length !== 1 || hItems[0].classification !== 'D') blocked('H_OVERLAY_MISMATCH');
  const result = await releaseInventoryReservation(hItems[0].order);
  if (!result?.restored) blocked('INVENTORY_RESTORE_FAILED');
  hItems[0].inventoryRestored = true;
  hItems[0].inventoryRestoreLineCount = Array.isArray(result.lines) ? result.lines.length : 0;
}

function expectedRereadFilter(item) {
  return {
    _id: item.order._id,
    paymentStatus: item.order.paymentStatus,
    status: item.order.status,
    inventoryDecrementedAt: item.order.inventoryDecrementedAt ?? null,
  };
}

function buildArchive(item, { actorUserId, sourceBackendSha, now }) {
  return {
    archiveEntryId: crypto.randomUUID(),
    sourceOrderId: item.order._id,
    priorPaymentId: hasPaymentReference(item.order) ? item.order.paymentId : null,
    classification: item.classification,
    sourceOrder: item.order,
    stripeSummary: item.stripeSummary,
    actorUserId,
    businessReason: BUSINESS_REASON,
    sourceBackendSha,
    archivedAt: now(),
  };
}

function buildAudit(archive) {
  return {
    actorUserId: archive.actorUserId,
    actorRole: 'release_operator',
    actionCode: ACTION_CODE,
    targetType: 'PrelaunchTestOrderArchive',
    targetId: archive.archiveEntryId,
    outcome: 'success',
    changeSummary: {
      classification: archive.classification,
      businessReason: BUSINESS_REASON,
      sourceBackendSha: archive.sourceBackendSha,
    },
  };
}

async function applyArchiveAndDelete({ classified, actorUserId, sourceBackendSha, Order,
  PrelaunchTestOrderArchive, AdminAuditEvent, User, mongoose, now }) {
  validateActor(actorUserId);
  if (!await User.exists({ _id: actorUserId, role: 'admin' })) blocked('ACTOR_NOT_ADMIN');
  const session = await mongoose.startSession();
  if (!session || typeof session.withTransaction !== 'function') blocked('TRANSACTION_UNAVAILABLE');
  try {
    await session.withTransaction(async () => {
      for (const item of classified) {
        const current = await Order.findOne(expectedRereadFilter(item)).select(ORDER_FIELDS)
          .session(session).lean();
        if (!current || String(current._id) !== String(item.order._id)) blocked('ORDER_STATE_CHANGED');
        const archive = buildArchive({ ...item, order: current }, { actorUserId, sourceBackendSha, now });
        const insertedArchive = await PrelaunchTestOrderArchive.create([archive], { session });
        if (!Array.isArray(insertedArchive) || insertedArchive.length !== 1) {
          blocked('ARCHIVE_INSERT_FAILED');
        }
        const insertedAudit = await AdminAuditEvent.create([buildAudit(archive)], { session });
        if (!Array.isArray(insertedAudit) || insertedAudit.length !== 1) blocked('AUDIT_INSERT_FAILED');
        const deleted = await Order.deleteOne({ _id: current._id }, { session });
        if (deleted?.deletedCount !== 1) blocked('ORDER_DELETE_FAILED');
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

function sanitizedResult(mode, summary, extra = {}) {
  return { mode, ...summary, ...extra };
}

async function run({ argv, env, deps, now = () => new Date() }) {
  const { mode } = parseArgs(argv);
  if (mode === 'verify-reset') {
    return sanitizedResult(mode, await deps.countReleaseBlockers());
  }
  const actorUserId = mode === 'apply' ? validateActor(env.RESET_ACTOR_USER_ID) : null;
  const sourceBackendSha = mode === 'apply' ? validateSourceSha(env) : null;
  if (mode === 'apply') {
    ensureCheckoutGated(env);
    await verifyArchiveStoragePrepared(deps);
  }
  const { classified, summary } = await discover(deps);
  if (mode === 'dry-run') return sanitizedResult(mode, summary, { applied: 0 });
  await cancelDIntents(classified, deps.stripe);
  await restoreHReservation(classified, deps.releaseInventoryReservation);
  await applyArchiveAndDelete({ classified, actorUserId, sourceBackendSha, now, ...deps });
  return sanitizedResult(mode, summary, { applied: EXPECTED.total });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.mode === 'apply') validateActor(process.env.RESET_ACTOR_USER_ID);
  if (!process.env.MONGODB_URI || !process.env.STRIPE_SECRET_KEY) blocked('CONNECTION_CONFIG_REQUIRED');
  const mongoose = require('mongoose');
  const Stripe = require('stripe');
  const deps = {
    mongoose,
    Order: require('../../models/Order'),
    AdminAuditEvent: require('../../models/AdminAuditEvent'),
    PrelaunchTestOrderArchive: require('../../models/PrelaunchTestOrderArchive'),
    User: require('../../models/User'),
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 10000 }),
    releaseInventoryReservation: require('../../lib/inventory/orderInventory').releaseInventoryReservation,
    countReleaseBlockers,
  };
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      autoCreate: false,
      autoIndex: false,
    });
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
  ACTION_CODE,
  APPLY_CONFIRMATION,
  BUSINESS_REASON,
  EXPECTED,
  REQUIRED_ARCHIVE_INDEXES,
  parseArgs,
  validateActor,
  validateSourceSha,
  discoveryQuery,
  hasActiveReservation,
  matchesG,
  classifyOrder,
  discover,
  summarizeClassified,
  assertArchiveIndexes,
  archiveCollectionName,
  archiveCollectionExists,
  verifyArchiveStoragePrepared,
  cancelDIntents,
  restoreHReservation,
  applyArchiveAndDelete,
  run,
};
