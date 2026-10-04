'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reconciliation = require('../../scripts/release/reconcile-terminal-payment-liabilities');

const ACTOR_ID = '507f1f77bcf86cd799439011';
const APPLY = ['--apply', '--confirm', reconciliation.CONFIRMATION];
const FIXED_NOW = new Date('2026-10-04T12:00:00.000Z');

function order(classification, number, overrides = {}) {
  const isRefund = classification === 'A1';
  return {
    _id: `order-sensitive-${classification}-${number}`,
    paymentId: `pi_sensitive_${classification}_${number}`,
    paymentStatus: isRefund ? 'refunded' : 'failed',
    status: isRefund ? 'refunded' : 'cancelled',
    totalAmount: 10,
    currency: 'usd',
    inventoryReservedAt: null,
    inventoryDecrementedAt: null,
    inventoryRestoredAt: null,
    paidConfirmationEmailSentAt: new Date('2026-09-01T00:00:00.000Z'),
    items: [{ sku: 'private-item' }],
    ...overrides,
  };
}

function eightOrders() {
  return [
    ...Array.from({ length: 5 }, (_, i) => order('A1', i + 1)),
    ...Array.from({ length: 3 }, (_, i) => order('B', i + 1)),
  ];
}

function stripeFor(orders, overrides = {}) {
  const calls = [];
  const intents = new Map();
  const charges = new Map();
  const refunds = new Map();
  const disputes = new Map();
  for (const record of orders) {
    const chargeId = `ch_${record.paymentId}`;
    const isRefund = record.paymentStatus === 'refunded';
    intents.set(record.paymentId, {
      id: record.paymentId,
      status: isRefund ? 'succeeded' : 'canceled',
      latest_charge: isRefund ? chargeId : null,
      amount: 1000,
      amount_received: isRefund ? 1000 : 0,
      currency: 'usd',
      metadata: { orderId: String(record._id) },
    });
    charges.set(chargeId, {
      id: chargeId,
      payment_intent: record.paymentId,
      paid: true,
      status: 'succeeded',
      refunded: true,
      disputed: false,
      amount: 1000,
      amount_refunded: 1000,
      currency: 'usd',
    });
    refunds.set(chargeId, {
      data: [{ status: 'succeeded', amount: 1000, charge: chargeId }],
      has_more: false,
    });
    disputes.set(chargeId, { data: [], has_more: false });
  }
  const mutation = (name) => async () => {
    calls.push(name);
    throw new Error(`Stripe mutation forbidden: ${name}`);
  };
  return {
    calls,
    intents,
    charges,
    refunds,
    disputes,
    client: {
      paymentIntents: {
        retrieve: async (id) => {
          calls.push('paymentIntents.retrieve');
          return structuredClone(intents.get(id));
        },
        update: mutation('paymentIntents.update'),
        cancel: mutation('paymentIntents.cancel'),
      },
      charges: {
        retrieve: async (id) => {
          calls.push('charges.retrieve');
          return structuredClone(charges.get(id));
        },
        update: mutation('charges.update'),
      },
      refunds: {
        list: async ({ charge }) => {
          calls.push('refunds.list');
          return structuredClone(refunds.get(charge));
        },
        create: mutation('refunds.create'),
      },
      disputes: {
        list: async ({ charge }) => {
          calls.push('disputes.list');
          return structuredClone(disputes.get(charge));
        },
        update: mutation('disputes.update'),
      },
    },
    amendIntent(record, changes) {
      intents.set(record.paymentId, { ...intents.get(record.paymentId), ...changes });
    },
    amendCharge(record, changes) {
      const id = `ch_${record.paymentId}`;
      charges.set(id, { ...charges.get(id), ...changes });
    },
    amendRefunds(record, changes) {
      refunds.set(`ch_${record.paymentId}`, changes);
    },
    amendDisputes(record, changes) {
      disputes.set(`ch_${record.paymentId}`, changes);
    },
  };
}

function matchesField(actual, expected) {
  if (expected === null) return actual == null;
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$exists' in expected && (actual !== undefined) !== expected.$exists) return false;
    if ('$type' in expected && typeof actual !== expected.$type) return false;
    if ('$ne' in expected && actual === expected.$ne) return false;
    return true;
  }
  return String(actual) === String(expected);
}

function matches(record, filter) {
  return Object.entries(filter).every(([key, expected]) =>
    key === '$or'
      ? expected.some((branch) => matches(record, branch))
      : matchesField(record[key], expected)
  );
}

function queryResult(rows, onSession = () => {}) {
  return {
    select() { return this; },
    session(session) { onSession(session); return this; },
    async lean() { return structuredClone(rows); },
  };
}

function harness(inputOrders = eightOrders(), options = {}) {
  const orders = new Map(inputOrders.map((record) => [String(record._id), structuredClone(record)]));
  const events = [];
  const actions = [];
  const stripe = stripeFor(inputOrders);
  let sessionStarted = 0;
  let sessionEnded = 0;
  const session = {
    async withTransaction(work, settings) {
      actions.push({ type: 'transaction', settings });
      const orderSnapshot = structuredClone([...orders.entries()]);
      const eventSnapshot = structuredClone(events);
      try {
        if (options.onTransactionStart) options.onTransactionStart(orders);
        return await work();
      } catch (error) {
        orders.clear();
        for (const [id, record] of orderSnapshot) orders.set(id, record);
        events.length = 0;
        events.push(...eventSnapshot);
        actions.push({ type: 'rollback' });
        throw error;
      }
    },
    async endSession() { sessionEnded += 1; },
  };
  const Order = {
    find(filter) {
      actions.push({ type: 'discover', filter });
      return queryResult([...orders.values()].filter((record) => matches(record, filter)));
    },
    findOne(filter) {
      actions.push({ type: 'reread', filter });
      const record = [...orders.values()].find((item) => matches(item, filter));
      return queryResult(record || null, (used) => assert.equal(used, session));
    },
    async updateOne(filter, update, settings) {
      actions.push({ type: 'update', filter, update, settings });
      assert.equal(settings.session, session);
      const record = [...orders.values()].find((item) => matches(item, filter));
      if (!record) return { matchedCount: 0, modifiedCount: 0 };
      if (options.failUpdate) {
        if (options.failUpdate === 'throw') throw new Error('sensitive Mongo error');
        if (options.failUpdate === 'after-mutation') {
          delete record.paymentId;
          throw new Error('sensitive post-update error');
        }
        return { matchedCount: 1, modifiedCount: 0 };
      }
      for (const key of Object.keys(update.$unset || {})) delete record[key];
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const AdminAuditEvent = {
    find(filter) {
      actions.push({ type: 'audit-find', filter });
      return queryResult(events.filter((event) => matches(event, filter)));
    },
    findOne(filter) {
      actions.push({ type: 'audit-reread', filter });
      return queryResult(events.find((event) => matches(event, filter)) || null,
        (used) => assert.equal(used, session));
    },
    async create(docs, settings) {
      actions.push({ type: 'audit-create', docs, settings });
      assert.equal(settings.session, session);
      if (options.failAudit) throw new Error('sensitive audit error');
      events.push(...structuredClone(docs));
      return docs;
    },
  };
  const deps = {
    Order,
    AdminAuditEvent,
    User: { exists: async () => true },
    mongoose: {
      async startSession() {
        sessionStarted += 1;
        return session;
      },
    },
    stripe: stripe.client,
  };
  return {
    deps,
    stripe,
    actions,
    events,
    orders,
    get sessionStarted() { return sessionStarted; },
    get sessionEnded() { return sessionEnded; },
    run: (argv = ['--dry-run'], env = {}) => reconciliation.run({
      argv, env, deps, now: () => FIXED_NOW,
    }),
  };
}

test('default and explicit dry-run discover exact 5 A1 / 3 B without writes', async () => {
  const fixture = harness();
  for (const argv of [[], ['--dry-run']]) {
    const result = await fixture.run(argv);
    assert.deepEqual(result, {
      mode: 'dry-run', A1Eligible: 5, BEligible: 3,
      alreadyReconciled: 0, driftedIneligible: 0, totalEligible: 8, applied: 0,
    });
  }
  assert.equal(fixture.sessionStarted, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
  assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
});

test('apply requires exact token and actor before any discovery or write', async () => {
  const fixture = harness();
  await assert.rejects(fixture.run(['--apply'], { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /APPLY_CONFIRMATION_REQUIRED/);
  await assert.rejects(fixture.run(['--apply', '--confirm', 'wrong'],
    { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }), /APPLY_CONFIRMATION_REQUIRED/);
  await assert.rejects(fixture.run(APPLY), /VALID_ACTOR_USER_ID_REQUIRED/);
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: 'not-an-id' }),
    /VALID_ACTOR_USER_ID_REQUIRED/);
  assert.deepEqual(fixture.actions, []);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.stripe.calls.length, 0);
});

test('CLI argument parser rejects supplied order IDs and conflicting modes', () => {
  assert.throws(() => reconciliation.parseArgs(['--order-id', 'order-sensitive']), /UNKNOWN_ARGUMENT/);
  assert.throws(() => reconciliation.parseArgs(['--apply', '--dry-run']), /DUPLICATE_OR_CONFLICTING_MODE/);
  assert.throws(() => reconciliation.parseArgs(['--dry-run', '--confirm', reconciliation.CONFIRMATION]),
    /CONFIRMATION_WITHOUT_APPLY/);
});

test('A1 eligibility requires succeeded intent and a single successful full refund without dispute', async () => {
  const record = order('A1', 1);
  const stripe = stripeFor([record]);
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), true);
  stripe.amendCharge(record, { amount_refunded: 500 });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
  stripe.amendCharge(record, { amount_refunded: 1000, disputed: true });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
  stripe.amendCharge(record, { disputed: false });
  stripe.amendDisputes(record, { data: [{ id: 'dp_sensitive', status: 'needs_response' }], has_more: false });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
  stripe.amendDisputes(record, { data: [], has_more: false });
  stripe.amendRefunds(record, { data: [{ status: 'pending', amount: 1000,
    charge: `ch_${record.paymentId}` }], has_more: false });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
  stripe.amendRefunds(record, { data: [{ status: 'succeeded', amount: 500,
    charge: `ch_${record.paymentId}` }], has_more: false });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
});

test('A1 refuses a nonterminal Mongo state and mismatched Stripe order/amount/currency', async () => {
  const record = order('A1', 1);
  assert.equal(reconciliation.mongoClass({ ...record, status: 'ordered' }), null);
  const stripe = stripeFor([record]);
  stripe.amendIntent(record, { metadata: { orderId: 'other-order' } });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
  stripe.amendIntent(record, { metadata: { orderId: record._id }, amount: 999 });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
  stripe.amendIntent(record, { amount: 1000, currency: 'eur' });
  assert.equal(await reconciliation.stripeEligibility(record, 'A1', stripe.client), false);
});

test('A1 permits a finalized inventory marker but rejects an unresolved active reservation', async () => {
  const finalizedAt = new Date('2026-09-01T00:00:00.000Z');
  const finalized = order('A1', 1, { inventoryDecrementedAt: finalizedAt });
  assert.equal(reconciliation.mongoClass(finalized), 'A1');
  assert.equal(reconciliation.mongoClass(order('A1', 2, {
    inventoryReservedAt: finalizedAt,
    inventoryDecrementedAt: null,
    inventoryRestoredAt: null,
  })), null);
  const fixture = harness([finalized, ...eightOrders().slice(1)]);
  const result = await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  assert.equal(result.applied, 8);
  assert.equal(fixture.orders.get(finalized._id).inventoryDecrementedAt.getTime(),
    finalizedAt.getTime());
  const update = fixture.actions.find((action) =>
    action.type === 'update' && action.filter._id === finalized._id);
  assert.equal(update.filter.inventoryDecrementedAt.getTime(), finalizedAt.getTime());
});

test('B requires cancelled Mongo state, no active reservation, and canceled Stripe intent', async () => {
  const record = order('B', 1);
  const stripe = stripeFor([record]);
  assert.equal(reconciliation.mongoClass(record), 'B');
  assert.equal(await reconciliation.stripeEligibility(record, 'B', stripe.client), true);
  stripe.amendIntent(record, { status: 'requires_payment_method' });
  assert.equal(await reconciliation.stripeEligibility(record, 'B', stripe.client), false);
  assert.equal(reconciliation.mongoClass({ ...record, inventoryReservedAt: new Date() }), null);
  assert.equal(reconciliation.mongoClass({ ...record, inventoryDecrementedAt: new Date() }), null);
  assert.equal(reconciliation.mongoClass({ ...record, status: 'created' }), null);
});

test('D/H/G records are not selected or sent to Stripe', async () => {
  const outOfScope = [
    order('B', 'D', { paymentStatus: 'failed', status: 'created' }),
    order('B', 'H', { inventoryReservedAt: new Date('2026-10-04T00:00:00.000Z') }),
    order('A1', 'G', { paymentStatus: 'paid', status: 'ordered' }),
    order('A1', 'nonterminal', { status: 'ordered' }),
  ];
  const fixture = harness([...eightOrders(), ...outOfScope]);
  const result = await fixture.run();
  assert.equal(result.A1Eligible, 5);
  assert.equal(result.BEligible, 3);
  assert.equal(result.driftedIneligible, 1);
  const retrieved = fixture.stripe.calls.filter((call) => call === 'paymentIntents.retrieve');
  assert.equal(retrieved.length, 8);
  const filter = reconciliation.discoveryQuery();
  assert.equal(outOfScope.slice(0, 3).every((record) => !matches(record, filter)), true);
});

test('count drift blocks every write and does not start a transaction', async () => {
  const fixture = harness(eightOrders().slice(1));
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /EXPECTED_COUNT_DRIFT/);
  assert.equal(fixture.sessionStarted, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
});

test('changed Mongo state at transaction reread blocks audit and order mutation', async () => {
  const fixture = harness(eightOrders(), {
    onTransactionStart(orders) {
      orders.get(eightOrders()[0]._id).status = 'ordered';
    },
  });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /ORDER_STATE_CHANGED/);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
});

test('apply inserts each immutable audit event before clearing only paymentId', async () => {
  const fixture = harness();
  const before = structuredClone([...fixture.orders.entries()]);
  const result = await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  assert.equal(result.applied, 8);
  assert.equal(fixture.sessionStarted, 1);
  assert.equal(fixture.sessionEnded, 1);
  assert.equal(fixture.events.length, 8);
  const writes = fixture.actions.filter((action) => ['audit-create', 'update'].includes(action.type));
  assert.equal(writes.length, 16);
  for (let i = 0; i < writes.length; i += 2) {
    assert.equal(writes[i].type, 'audit-create');
    assert.equal(writes[i + 1].type, 'update');
    assert.deepEqual(writes[i + 1].update, { $unset: { paymentId: '' } });
    assert.equal(writes[i + 1].settings.timestamps, false);
  }
  for (const [id, original] of before) {
    const current = fixture.orders.get(id);
    const { paymentId: _beforePaymentId, ...expected } = original;
    assert.deepEqual(current, expected);
  }
  for (const event of fixture.events) {
    const original = before.find(([id]) => id === event.targetId)[1];
    assert.equal(event.actionCode, reconciliation.ACTION_CODE);
    assert.equal(event.actorUserId, ACTOR_ID);
    assert.equal(event.actorRole, 'release_operator');
    assert.equal(event.targetType, 'Order');
    assert.equal(event.outcome, 'success');
    assert.deepEqual(event.changeSummary, {
      priorPaymentId: original.paymentId,
      classification: original.paymentStatus === 'refunded' ? 'A1' : 'B',
      priorPaymentStatus: original.paymentStatus,
      priorOrderStatus: original.status,
      stripeTerminalStatus: original.paymentStatus === 'refunded' ? 'succeeded' : 'canceled',
      reason: 'release_cutover_terminal_reference_retirement',
      reconciledAt: FIXED_NOW.toISOString(),
    });
  }
  assert.equal(fixture.stripe.calls.every((call) =>
    ['paymentIntents.retrieve', 'charges.retrieve', 'refunds.list', 'disputes.list'].includes(call)), true);
});

test('audit insertion failure prevents order mutation', async () => {
  const fixture = harness(eightOrders(), { failAudit: true });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /TRANSACTION_FAILED/);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
  assert.equal(fixture.actions.some((action) => action.type === 'rollback'), true);
});

test('order mutation failure rolls back audit and the payment reference', async () => {
  for (const failUpdate of ['throw', 'after-mutation', 'unmodified']) {
    const fixture = harness(eightOrders(), { failUpdate });
    await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
      failUpdate === 'unmodified' ? /PAYMENT_REFERENCE_CLEAR_FAILED/ : /TRANSACTION_FAILED/);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
    assert.equal(fixture.actions.some((action) => action.type === 'rollback'), true);
  }
});

test('rerun classifies completed events as already reconciled and never repeats writes', async () => {
  const fixture = harness();
  await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  const priorActions = fixture.actions.length;
  const priorEvents = fixture.events.length;
  const result = await fixture.run();
  assert.deepEqual(result, {
    mode: 'dry-run', A1Eligible: 0, BEligible: 0,
    alreadyReconciled: 8, driftedIneligible: 0, totalEligible: 0, applied: 0,
  });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /EXPECTED_COUNT_DRIFT/);
  assert.equal(fixture.events.length, priorEvents);
  assert.equal(fixture.actions.slice(priorActions).some((action) =>
    ['transaction', 'audit-create', 'update'].includes(action.type)), false);
});

test('returned dry-run and apply summaries and blocked errors never leak IDs or Stripe data', async () => {
  const fixture = harness();
  const dryRun = await fixture.run();
  const applied = await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  const output = JSON.stringify([dryRun, applied]);
  assert.doesNotMatch(output, /order-sensitive|pi_sensitive|ch_pi_sensitive|private-item/);
  assert.doesNotMatch(output, /507f1f77bcf86cd799439011/);
  const drift = harness(eightOrders().slice(1));
  await assert.rejects(drift.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    (error) => error.safeCode === 'EXPECTED_COUNT_DRIFT'
      && !/order-sensitive|pi_sensitive|ch_pi_sensitive/.test(error.message));
});
