'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const reconciliation = require('../../scripts/release/reconcile-terminal-payment-liabilities');
const prepareLedger = require('../../scripts/release/prepare-reconciliation-ledger');

const ACTOR_ID = '507f1f77bcf86cd799439011';
const APPLY = ['--apply', '--confirm', reconciliation.CONFIRMATION];
const FIXED_NOW = new Date('2026-10-04T12:00:00.000Z');
const controllerPath = path.resolve(__dirname, '../../controllers/admin/adminAudit.controller.js');
const LEDGER_COLLECTION = 'releasereconciliationledgers';

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

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

function requiredIndexDocs() {
  return [
    { name: '_id_', key: { _id: 1 }, unique: true },
    ...reconciliation.REQUIRED_LEDGER_INDEXES.map((index) => ({
      name: index.name,
      key: { [index.field]: 1 },
      unique: true,
    })),
  ];
}

function harness(inputOrders = eightOrders(), options = {}) {
  const orders = new Map(inputOrders.map((record) => [String(record._id), structuredClone(record)]));
  const ledger = [];
  const events = [];
  const actions = [];
  const stripe = stripeFor(inputOrders);
  let ledgerCollectionExists = options.ledgerCollectionExists !== false;
  let ledgerIndexes = structuredClone(options.ledgerIndexes || requiredIndexDocs());
  let sessionStarted = 0;
  let sessionEnded = 0;
  const session = {
    async withTransaction(work, settings) {
      actions.push({ type: 'transaction', settings });
      const orderSnapshot = structuredClone([...orders.entries()]);
      const ledgerSnapshot = structuredClone(ledger);
      const eventSnapshot = structuredClone(events);
      try {
        if (options.onTransactionStart) options.onTransactionStart(orders, ledger);
        return await work();
      } catch (error) {
        orders.clear();
        for (const [id, record] of orderSnapshot) orders.set(id, record);
        ledger.length = 0;
        ledger.push(...ledgerSnapshot);
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
  const ReleaseReconciliationLedger = {
    collection: {
      name: LEDGER_COLLECTION,
      async indexes() {
        actions.push({ type: 'ledger-indexes' });
        return structuredClone(ledgerIndexes);
      },
      async createIndex(key, settings) {
        actions.push({ type: 'ledger-create-index', key, settings });
        ledgerIndexes.push({ name: settings.name, key, unique: settings.unique });
        return settings.name;
      },
    },
    find(filter) {
      actions.push({ type: 'ledger-find', filter });
      return queryResult(ledger.filter((entry) => matches(entry, filter)));
    },
    findOne(filter) {
      actions.push({ type: 'ledger-reread', filter });
      return queryResult(ledger.find((entry) => matches(entry, filter)) || null,
        (used) => assert.equal(used, session));
    },
    async create(docs, settings) {
      actions.push({ type: 'ledger-create', docs, settings });
      assert.equal(settings.session, session);
      if (options.failLedger) throw new Error('sensitive ledger error');
      ledger.push(...structuredClone(docs));
      return docs;
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
    ReleaseReconciliationLedger,
    AdminAuditEvent,
    User: { exists: async () => true },
    mongoose: {
      connection: {
        db: {
          listCollections(filter) {
            actions.push({ type: 'list-collections', filter });
            return {
              async toArray() {
                return ledgerCollectionExists && filter.name === LEDGER_COLLECTION
                  ? [{ name: LEDGER_COLLECTION }]
                  : [];
              },
            };
          },
          async createCollection(name) {
            actions.push({ type: 'create-collection', name });
            ledgerCollectionExists = true;
            ledgerIndexes = [{ name: '_id_', key: { _id: 1 }, unique: true }];
            return {};
          },
        },
      },
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
    ledger,
    events,
    orders,
    get ledgerIndexes() { return ledgerIndexes; },
    get ledgerCollectionExists() { return ledgerCollectionExists; },
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
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) =>
    ['create-collection', 'ledger-create-index', 'ledger-create', 'audit-create', 'update']
      .includes(action.type)), false);
  assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
});

test('dry-run treats an absent ledger collection as empty and creates nothing', async () => {
  const fixture = harness(eightOrders(), { ledgerCollectionExists: false });
  const result = await fixture.run(['--dry-run']);
  assert.deepEqual(result, {
    mode: 'dry-run', A1Eligible: 5, BEligible: 3,
    alreadyReconciled: 0, driftedIneligible: 0, totalEligible: 8, applied: 0,
  });
  assert.equal(fixture.ledgerCollectionExists, false);
  assert.equal(fixture.actions.some((action) => action.type === 'ledger-find'), false);
  assert.equal(fixture.actions.some((action) =>
    ['create-collection', 'ledger-create-index', 'ledger-create', 'audit-create', 'update']
      .includes(action.type)), false);
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
  assert.equal(fixture.ledger.length, 0);
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
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
});

test('apply blocks before Stripe or transaction when ledger storage is absent or unprepared', async () => {
  for (const options of [
    { ledgerCollectionExists: false },
    { ledgerIndexes: [{ name: '_id_', key: { _id: 1 }, unique: true }] },
    { ledgerIndexes: [
      { name: '_id_', key: { _id: 1 }, unique: true },
      { name: 'orderId_1', key: { orderId: 1 }, unique: false },
    ] },
  ]) {
    const fixture = harness(eightOrders(), options);
    await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
      /LEDGER_STORAGE_NOT_PREPARED/);
    assert.equal(fixture.sessionStarted, 0);
    assert.equal(fixture.stripe.calls.length, 0);
    assert.equal(fixture.ledger.length, 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.actions.some((action) =>
      ['create-collection', 'ledger-create-index', 'ledger-create', 'audit-create', 'update']
        .includes(action.type)), false);
  }
});

test('changed Mongo state at transaction reread blocks ledger, audit and order mutation', async () => {
  const fixture = harness(eightOrders(), {
    onTransactionStart(orders) {
      orders.get(eightOrders()[0]._id).status = 'ordered';
    },
  });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /ORDER_STATE_CHANGED/);
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) =>
    ['ledger-create', 'audit-create', 'update'].includes(action.type)), false);
});

test('prior duplicate ledger mapping fails closed before Stripe or any write', async () => {
  for (const duplicateField of ['orderId', 'priorPaymentId']) {
    const fixture = harness();
    const first = {
      ledgerEntryId: 'ledger-one',
      orderId: 'historical-order-one',
      priorPaymentId: 'pi_historical_one',
      classification: 'B',
      reason: 'release_cutover_terminal_reference_retirement',
      outcome: 'success',
    };
    const second = { ...first, ledgerEntryId: 'ledger-two',
      orderId: 'historical-order-two', priorPaymentId: 'pi_historical_two' };
    second[duplicateField] = first[duplicateField];
    fixture.ledger.push(first, second);
    await assert.rejects(fixture.run(), /DUPLICATE_PRIOR_LEDGER/);
    assert.equal(fixture.stripe.calls.length, 0);
    assert.equal(fixture.sessionStarted, 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
  }
});

test('ledger mapping appearing during transaction blocks audit and payment clear', async () => {
  const fixture = harness(eightOrders(), {
    onTransactionStart(_orders, ledger) {
      ledger.push({ orderId: eightOrders()[0]._id, ledgerEntryId: 'concurrent-opaque-ledger' });
    },
  });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /ALREADY_RECONCILED/);
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) => action.type === 'audit-create'), false);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
});

test('apply inserts exact ledger mapping, then safe audit event, then clears only paymentId', async () => {
  const fixture = harness();
  const before = structuredClone([...fixture.orders.entries()]);
  const result = await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  assert.equal(result.applied, 8);
  assert.equal(fixture.sessionStarted, 1);
  assert.equal(fixture.sessionEnded, 1);
  assert.equal(fixture.ledger.length, 8);
  assert.equal(fixture.events.length, 8);
  const writes = fixture.actions.filter((action) =>
    ['ledger-create', 'audit-create', 'update'].includes(action.type));
  assert.equal(writes.length, 24);
  for (let i = 0; i < writes.length; i += 3) {
    assert.deepEqual(writes.slice(i, i + 3).map((action) => action.type),
      ['ledger-create', 'audit-create', 'update']);
    assert.deepEqual(writes[i + 2].update, { $unset: { paymentId: '' } });
    assert.equal(writes[i + 2].settings.timestamps, false);
  }
  for (const [id, original] of before) {
    const current = fixture.orders.get(id);
    const { paymentId: _beforePaymentId, ...expected } = original;
    assert.deepEqual(current, expected);
  }
  const ledgerIds = new Set();
  for (const entry of fixture.ledger) {
    const original = before.find(([id]) => id === String(entry.orderId))[1];
    assert.match(entry.ledgerEntryId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(ledgerIds.has(entry.ledgerEntryId), false);
    ledgerIds.add(entry.ledgerEntryId);
    assert.equal(entry.priorPaymentId, original.paymentId);
    assert.equal(entry.classification, original.paymentStatus === 'refunded' ? 'A1' : 'B');
    assert.equal(entry.priorPaymentStatus, original.paymentStatus);
    assert.equal(entry.priorOrderStatus, original.status);
    assert.equal(entry.stripeTerminalStatus,
      original.paymentStatus === 'refunded' ? 'succeeded' : 'canceled');
    assert.equal(entry.reason, 'release_cutover_terminal_reference_retirement');
    assert.equal(entry.actorUserId, ACTOR_ID);
    assert.equal(entry.outcome, 'success');
  }
  for (const event of fixture.events) {
    const entry = fixture.ledger.find((item) => item.ledgerEntryId === event.targetId);
    assert.ok(entry);
    assert.equal(event.actionCode, reconciliation.ACTION_CODE);
    assert.equal(event.actorUserId, ACTOR_ID);
    assert.equal(event.actorRole, 'release_operator');
    assert.equal(event.targetType, 'ReleaseReconciliationLedger');
    assert.equal(event.outcome, 'success');
    assert.deepEqual(event.changeSummary, {
      classification: entry.classification,
      priorPaymentStatus: entry.priorPaymentStatus,
      priorOrderStatus: entry.priorOrderStatus,
      stripeTerminalStatus: entry.stripeTerminalStatus,
      reason: 'release_cutover_terminal_reference_retirement',
    });
    assert.doesNotMatch(JSON.stringify(event), /order-sensitive|pi_sensitive|ch_pi_sensitive|private-item/);
  }
  assert.equal(fixture.stripe.calls.every((call) =>
    ['paymentIntents.retrieve', 'charges.retrieve', 'refunds.list', 'disputes.list'].includes(call)), true);
});

test('apply verifies prepared ledger storage before discovery and transaction writes', async () => {
  const fixture = harness();
  await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  const firstWrite = fixture.actions.findIndex((action) =>
    ['ledger-create', 'audit-create', 'update'].includes(action.type));
  assert.ok(firstWrite > 0);
  assert.deepEqual(fixture.actions.slice(0, 2).map((action) => action.type),
    ['list-collections', 'ledger-indexes']);
  assert.ok(fixture.actions.findIndex((action) => action.type === 'ledger-indexes')
    < fixture.actions.findIndex((action) => action.type === 'transaction'));
  assert.ok(fixture.actions.findIndex((action) => action.type === 'transaction') < firstWrite);
});

test('ledger insertion failure prevents audit and order mutation', async () => {
  const fixture = harness(eightOrders(), { failLedger: true });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /TRANSACTION_FAILED/);
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.actions.some((action) =>
    ['audit-create', 'update'].includes(action.type)), false);
  assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
  assert.equal(fixture.actions.some((action) => action.type === 'rollback'), true);
});

test('audit insertion failure rolls back ledger and prevents order mutation', async () => {
  const fixture = harness(eightOrders(), { failAudit: true });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /TRANSACTION_FAILED/);
  assert.equal(fixture.actions.some((action) => action.type === 'update'), false);
  assert.equal(fixture.actions.some((action) => action.type === 'ledger-create'), true);
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
  assert.equal(fixture.actions.some((action) => action.type === 'rollback'), true);
});

test('order mutation failure rolls back ledger, audit and the payment reference', async () => {
  for (const failUpdate of ['throw', 'after-mutation', 'unmodified']) {
    const fixture = harness(eightOrders(), { failUpdate });
    await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
      failUpdate === 'unmodified' ? /PAYMENT_REFERENCE_CLEAR_FAILED/ : /TRANSACTION_FAILED/);
    assert.equal(fixture.ledger.length, 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.orders.get(eightOrders()[0]._id).paymentId, eightOrders()[0].paymentId);
    assert.equal(fixture.actions.some((action) => action.type === 'rollback'), true);
  }
});

test('rerun classifies completed ledger entries as already reconciled and never repeats writes', async () => {
  const fixture = harness();
  await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  const priorActions = fixture.actions.length;
  const priorLedger = fixture.ledger.length;
  const priorEvents = fixture.events.length;
  const result = await fixture.run();
  assert.deepEqual(result, {
    mode: 'dry-run', A1Eligible: 0, BEligible: 0,
    alreadyReconciled: 8, driftedIneligible: 0, totalEligible: 0, applied: 0,
  });
  await assert.rejects(fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID }),
    /EXPECTED_COUNT_DRIFT/);
  assert.equal(fixture.ledger.length, priorLedger);
  assert.equal(fixture.events.length, priorEvents);
  assert.equal(fixture.actions.slice(priorActions).some((action) =>
    ['transaction', 'ledger-create', 'audit-create', 'update'].includes(action.type)), false);
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

test('normal admin audit list and detail return only safe ledger event metadata', async () => {
  const fixture = harness();
  await fixture.run(APPLY, { RECONCILIATION_ACTOR_USER_ID: ACTOR_ID });
  const event = { ...fixture.events[0], eventId: 'opaque-event-id' };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/AdminAuditEvent')) {
      return {
        find: () => ({
          sort: () => ({
            skip: () => ({
              limit: () => ({
                select: () => ({ lean: async () => [event] }),
              }),
            }),
          }),
        }),
        countDocuments: async () => 1,
        findOne: () => ({ select: () => ({ lean: async () => event }) }),
      };
    }
    return originalLoad(request, parent, isMain);
  };
  let controller;
  try {
    delete require.cache[controllerPath];
    controller = require(controllerPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
  const listResponse = mockResponse();
  await controller.listAdminAuditEvents({ query: {} }, listResponse);
  const detailResponse = mockResponse();
  await controller.getAdminAuditEventByEventId({ params: { eventId: event.eventId } }, detailResponse);
  assert.equal(listResponse.statusCode, 200);
  assert.equal(detailResponse.statusCode, 200);
  assert.equal(listResponse.body.data[0].targetId, event.targetId);
  assert.equal(detailResponse.body.data.targetId, event.targetId);
  for (const response of [listResponse, detailResponse]) {
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /order-sensitive|pi_sensitive|ch_pi_sensitive|private-item/);
    assert.equal(serialized.includes(event.targetId), true);
  }
});

test('restricted ledger has unique mapping indexes, rejects mutation, and has no HTTP route or controller', async () => {
  const Ledger = require('../../models/ReleaseReconciliationLedger');
  const uniqueIndexFields = new Set(Ledger.schema.indexes()
    .filter(([, options]) => options.unique === true)
    .flatMap(([fields]) => Object.keys(fields)));
  for (const field of ['ledgerEntryId', 'orderId', 'priorPaymentId']) {
    assert.equal(uniqueIndexFields.has(field), true, `${field} must be unique`);
  }
  assert.equal(Ledger.schema.options.timestamps.createdAt, true);
  assert.equal(Ledger.schema.options.timestamps.updatedAt, false);
  assert.equal(Ledger.schema.options.autoCreate, false);
  assert.equal(Ledger.schema.options.autoIndex, false);
  for (const query of [
    Ledger.updateOne({}, { $set: { classification: 'B' } }),
    Ledger.updateMany({}, { $set: { classification: 'B' } }),
    Ledger.deleteOne({}),
    Ledger.deleteMany({}),
  ]) {
    await assert.rejects(query, /ReleaseReconciliationLedger records are immutable/);
  }
  const scan = (directory) => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return scan(full);
      return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });
  for (const directory of ['routes', 'controllers']) {
    for (const file of scan(path.resolve(__dirname, '../..', directory))) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /ReleaseReconciliationLedger/,
        `${directory} must not expose the restricted ledger`);
    }
  }
});

test('preparation utility requires exact confirmation and creates only ledger storage', async () => {
  assert.deepEqual(prepareLedger.parseArgs([]), { confirmed: false });
  assert.deepEqual(prepareLedger.parseArgs(['--confirm', prepareLedger.CONFIRMATION]),
    { confirmed: true });
  assert.throws(() => prepareLedger.parseArgs(['--confirm', 'wrong']),
    /PREPARE_CONFIRMATION_REQUIRED/);

  const dryRun = harness(eightOrders(), { ledgerCollectionExists: false });
  assert.deepEqual(await prepareLedger.prepareStorage({
    mongoose: dryRun.deps.mongoose,
    ReleaseReconciliationLedger: dryRun.deps.ReleaseReconciliationLedger,
    reconciliation,
    confirmed: false,
  }), {
    mode: 'dry-run',
    collection: LEDGER_COLLECTION,
    exists: false,
    ready: false,
  });
  assert.equal(dryRun.ledgerCollectionExists, false);
  assert.equal(dryRun.actions.some((action) =>
    ['create-collection', 'ledger-create-index', 'discover', 'ledger-find',
      'ledger-create', 'audit-create', 'update'].includes(action.type)), false);

  const fixture = harness(eightOrders(), { ledgerCollectionExists: false });
  assert.deepEqual(await prepareLedger.prepareStorage({
    mongoose: fixture.deps.mongoose,
    ReleaseReconciliationLedger: fixture.deps.ReleaseReconciliationLedger,
    reconciliation,
    confirmed: true,
  }), {
    mode: 'apply',
    collection: LEDGER_COLLECTION,
    exists: true,
    ready: true,
  });
  assert.deepEqual(fixture.actions.filter((action) => action.type === 'create-collection')
    .map((action) => action.name), [LEDGER_COLLECTION]);
  assert.deepEqual(fixture.actions.filter((action) => action.type === 'ledger-create-index')
    .map((action) => action.settings.name), ['ledgerEntryId_1', 'orderId_1', 'priorPaymentId_1']);
  assert.equal(fixture.actions.some((action) =>
    ['discover', 'ledger-find', 'ledger-create', 'audit-create', 'update'].includes(action.type)), false);
});

test('preparation is idempotent and blocks incompatible ledger indexes', async () => {
  const ready = harness();
  assert.deepEqual(await prepareLedger.prepareStorage({
    mongoose: ready.deps.mongoose,
    ReleaseReconciliationLedger: ready.deps.ReleaseReconciliationLedger,
    reconciliation,
    confirmed: true,
  }), {
    mode: 'apply',
    collection: LEDGER_COLLECTION,
    exists: true,
    ready: true,
  });
  assert.equal(ready.actions.some((action) =>
    ['create-collection', 'ledger-create-index'].includes(action.type)), false);

  const incompatible = harness(eightOrders(), { ledgerIndexes: [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'unsafe_extra_1', key: { unsafe_extra: 1 }, unique: false },
  ] });
  await assert.rejects(prepareLedger.prepareStorage({
    mongoose: incompatible.deps.mongoose,
    ReleaseReconciliationLedger: incompatible.deps.ReleaseReconciliationLedger,
    reconciliation,
    confirmed: true,
  }), /LEDGER_STORAGE_NOT_PREPARED/);
  assert.equal(incompatible.actions.some((action) =>
    ['create-collection', 'ledger-create-index', 'ledger-create', 'audit-create', 'update']
      .includes(action.type)), false);
});
