#!/usr/bin/env node
'use strict';

// Release-only reconciliation. This module is inert unless invoked as a CLI.
// Do not use the best-effort admin audit service here: the audit and order
// mutation must commit or roll back in the same MongoDB transaction.
const ACTION_CODE = 'release_terminal_payment_reference_retirement';
const CONFIRMATION = 'RETIRE_TERMINAL_PAYMENT_REFERENCES';
const REASON = 'release_cutover_terminal_reference_retirement';
const EXPECTED = Object.freeze({ A1: 5, B: 3, total: 8 });
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

function isPriorSuccess(event) {
  return !!event && event.actionCode === ACTION_CODE && event.outcome === 'success'
    && event.targetType === 'Order' && typeof event.targetId === 'string'
    && typeof event.changeSummary?.priorPaymentId === 'string'
    && ['A1', 'B'].includes(event.changeSummary?.classification)
    && event.changeSummary?.reason === REASON;
}

async function discover({ Order, AdminAuditEvent, stripe }) {
  const orders = await Order.find(discoveryQuery()).select(ORDER_FIELDS).lean();
  if (!Array.isArray(orders) || orders.length > 1000) blocked('INVALID_DISCOVERY_RESULT');
  const priorEvents = await AdminAuditEvent.find({
    actionCode: ACTION_CODE, outcome: 'success', targetType: 'Order',
  }).select('actionCode outcome targetType targetId changeSummary').lean();
  if (!Array.isArray(priorEvents) || priorEvents.some((event) => !isPriorSuccess(event))) {
    blocked('INVALID_PRIOR_AUDIT');
  }
  const priorTargets = new Set(priorEvents.map((event) => event.targetId));
  if (priorTargets.size !== priorEvents.length) blocked('DUPLICATE_PRIOR_AUDIT');
  const seenPaymentIds = new Set();
  const eligible = [];
  let ineligible = 0;
  for (const order of orders) {
    if (typeof order?.paymentId !== 'string' || seenPaymentIds.has(order.paymentId)) {
      blocked('DUPLICATE_OR_INVALID_PAYMENT_REFERENCE');
    }
    seenPaymentIds.add(order.paymentId);
    const classification = mongoClass(order);
    if (!classification || priorTargets.has(String(order._id))) {
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
      alreadyReconciled: priorEvents.length,
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

async function applyAll({ eligible, actorUserId, Order, AdminAuditEvent, User, mongoose, stripe, now }) {
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
        const prior = await AdminAuditEvent.findOne({
          actionCode: ACTION_CODE, targetType: 'Order', targetId: String(order._id), outcome: 'success',
        }).session(session).lean();
        if (prior) blocked('ALREADY_RECONCILED');
        const event = {
          actorUserId,
          actorRole: 'release_operator',
          actionCode: ACTION_CODE,
          targetType: 'Order',
          targetId: String(order._id),
          outcome: 'success',
          changeSummary: {
            priorPaymentId: order.paymentId,
            classification,
            priorPaymentStatus: order.paymentStatus,
            priorOrderStatus: order.status,
            stripeTerminalStatus: classification === 'A1' ? 'succeeded' : 'canceled',
            reason: REASON,
            reconciledAt: now().toISOString(),
          },
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

async function run({ argv, env, deps, now = () => new Date() }) {
  const { mode } = parseArgs(argv);
  const actorUserId = mode === 'apply' ? validateActor(env.RECONCILIATION_ACTOR_USER_ID) : null;
  const { eligible, summary } = await discover(deps);
  if (mode === 'dry-run') return { mode, ...summary, applied: 0 };
  if (summary.A1Eligible !== EXPECTED.A1 || summary.BEligible !== EXPECTED.B
      || summary.totalEligible !== EXPECTED.total) blocked('EXPECTED_COUNT_DRIFT');
  await applyAll({ eligible, actorUserId, ...deps, now });
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
  discover, conditionalFilter, applyAll, run,
};
