'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reset = require('../../scripts/release/reset-prelaunch-test-liabilities');
const prepareArchive = require('../../scripts/release/prepare-prelaunch-test-archive');

const ACTOR_ID = '507f1f77bcf86cd799439011';
const SOURCE_SHA = '832b6d87cfd6ac9e58011f87b042afea06261a7d';
const APPLY = ['--apply', '--confirm', reset.APPLY_CONFIRMATION];
const ARCHIVE_COLLECTION = 'prelaunchtestorderarchives';

function oid(prefix, n) {
  return `${prefix}${String(n).padStart(20 - prefix.length, '0')}`.slice(0, 24);
}

function order(classification, n, overrides = {}) {
  const paymentId = classification === 'G' ? null : `pi_${classification}_${n}`;
  return {
    _id: oid(classification.toLowerCase(), n),
    groupOrderId: `TEST-${classification}-${n}`,
    userId: oid('u', n),
    vendorId: oid('v', n),
    businessId: oid('b', n),
    paymentId,
    paymentStatus: classification === 'G' ? 'paid'
      : classification === 'A1' ? 'refunded' : 'failed',
    status: classification === 'A1' ? 'refunded'
      : classification === 'B' ? 'cancelled' : 'created',
    totalAmount: 10,
    subtotalAmount: 10,
    currency: 'usd',
    paidConfirmationEmailSentAt: classification === 'G' ? null : new Date('2026-01-01T00:00:00Z'),
    paidOrderEmailDelivery: classification === 'G' ? { customer: { status: 'sent' } } : undefined,
    inventoryReservedAt: null,
    inventoryDecrementedAt: null,
    inventoryRestoredAt: null,
    inventoryAdjustments: [],
    inventoryAdjustmentVersion: null,
    items: [{ variantId: oid('pv', n), size: 'M', quantity: 1, price: 10, color: 'black' }],
    shipping: { method: 'ground', amount: 123 },
    shippingAddress: { city: 'Testville', line1: '123 Test St', postalCode: '12345' },
    statusHistory: [{ status: 'created', at: new Date('2026-01-01T00:00:00Z'), by: 'fixture' }],
    trackingNumber: `TRACK-${classification}-${n}`,
    miscellaneousPersistedField: { nested: { value: `extra-${classification}-${n}` } },
    ...overrides,
  };
}

function fixtureOrders() {
  return [
    ...Array.from({ length: 5 }, (_, i) => order('A1', i + 1)),
    ...Array.from({ length: 3 }, (_, i) => order('B', i + 1)),
    ...Array.from({ length: 21 }, (_, i) => order('D', i + 1, i === 0 ? {
      inventoryReservedAt: new Date('2026-10-01T00:00:00Z'),
      inventoryAdjustments: [{ variantId: oid('pv', 1), size: 'M', quantity: 1 }],
      inventoryAdjustmentVersion: 1,
    } : {})),
    ...Array.from({ length: 34 }, (_, i) => order('G', i + 1)),
    order('X', 1, { paymentStatus: 'paid', paidConfirmationEmailSentAt: new Date('2026-01-02T00:00:00Z') }),
  ];
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
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((branch) => matches(record, branch));
    return matchesField(record[key], expected);
  });
}

function projectRecord(record, fields) {
  if (!record || !fields) return record;
  const projected = {};
  for (const field of fields.split(/\s+/).filter(Boolean)) {
    if (Object.prototype.hasOwnProperty.call(record, field)) projected[field] = record[field];
  }
  return projected;
}

function queryResult(rows, onSession = () => {}) {
  let selected = null;
  return {
    select(fields) { selected = fields; return this; },
    session(session) { onSession(session); return this; },
    async lean() {
      if (Array.isArray(rows)) return structuredClone(rows.map((record) => projectRecord(record, selected)));
      return structuredClone(projectRecord(rows, selected));
    },
  };
}

function requiredIndexes() {
  return [
    { name: '_id_', key: { _id: 1 }, unique: true },
    ...reset.REQUIRED_ARCHIVE_INDEXES.map((index) => ({
      name: index.name,
      key: { [index.field]: 1 },
      unique: true,
    })),
  ];
}

function stripeFor(orders) {
  const calls = [];
  const intents = new Map();
  const charges = new Map();
  const refunds = new Map();
  const disputes = new Map();
  for (const record of orders) {
    if (!record.paymentId) continue;
    const classification = record.paymentId.split('_')[1];
    const chargeId = `ch_${record.paymentId}`;
    intents.set(record.paymentId, {
      id: record.paymentId,
      status: classification === 'A1' ? 'succeeded'
        : classification === 'B' ? 'canceled' : 'requires_payment_method',
      livemode: false,
      latest_charge: classification === 'A1' ? chargeId : null,
    });
    charges.set(chargeId, {
      id: chargeId,
      payment_intent: record.paymentId,
      livemode: false,
      paid: true,
      status: 'succeeded',
      refunded: true,
      disputed: false,
      amount: 1000,
      amount_refunded: 1000,
    });
    refunds.set(chargeId, {
      data: [{ id: `re_${record.paymentId}`, livemode: false, status: 'succeeded', amount: 1000, charge: chargeId }],
      has_more: false,
    });
    disputes.set(chargeId, { data: [], has_more: false });
  }
  return {
    calls,
    intents,
    client: {
      paymentIntents: {
        retrieve: async (id) => {
          calls.push(['paymentIntents.retrieve', id]);
          return structuredClone(intents.get(id));
        },
        cancel: async (id) => {
          calls.push(['paymentIntents.cancel', id]);
          const current = intents.get(id);
          if (!current) return null;
          const canceled = { ...current, status: 'canceled' };
          intents.set(id, canceled);
          return structuredClone(canceled);
        },
      },
      charges: {
        retrieve: async (id) => {
          calls.push(['charges.retrieve', id]);
          return structuredClone(charges.get(id));
        },
      },
      refunds: {
        list: async ({ charge }) => {
          calls.push(['refunds.list', charge]);
          return structuredClone(refunds.get(charge));
        },
      },
      disputes: {
        list: async ({ charge }) => {
          calls.push(['disputes.list', charge]);
          return structuredClone(disputes.get(charge));
        },
      },
    },
  };
}

function harness(options = {}) {
  const orders = new Map((options.orders || fixtureOrders())
    .map((record) => [String(record._id), structuredClone(record)]));
  const archives = [];
  const audits = [];
  const actions = [];
  const stripe = stripeFor([...orders.values()]);
  let collectionExists = options.collectionExists !== false;
  let archiveIndexes = structuredClone(options.archiveIndexes || requiredIndexes());
  let sessionStarted = 0;
  let sessionEnded = 0;
  const session = {
    async withTransaction(work, settings) {
      actions.push({ type: 'transaction', settings });
      const orderSnapshot = structuredClone([...orders.entries()]);
      const archiveSnapshot = structuredClone(archives);
      const auditSnapshot = structuredClone(audits);
      try {
        if (options.onTransactionStart) options.onTransactionStart(orders);
        return await work();
      } catch (error) {
        orders.clear();
        for (const [id, record] of orderSnapshot) orders.set(id, record);
        archives.length = 0;
        archives.push(...archiveSnapshot);
        audits.length = 0;
        audits.push(...auditSnapshot);
        actions.push({ type: 'rollback' });
        throw error;
      }
    },
    async endSession() { sessionEnded += 1; },
  };
  const Order = {
    find(filter) {
      actions.push({ type: 'order-find', filter });
      return queryResult([...orders.values()].filter((record) => matches(record, filter)));
    },
    findOne(filter) {
      actions.push({ type: 'order-reread', filter });
      return queryResult([...orders.values()].find((record) => matches(record, filter)) || null,
        (used) => assert.equal(used, session));
    },
    async deleteOne(filter, settings) {
      actions.push({ type: 'order-delete', filter, settings });
      assert.equal(settings.session, session);
      if (typeof options.failDelete === 'function' ? options.failDelete() : options.failDelete) throw new Error('sensitive delete error');
      const found = [...orders.values()].find((record) => matches(record, filter));
      if (!found) return { deletedCount: 0 };
      orders.delete(String(found._id));
      return { deletedCount: 1 };
    },
  };
  const PrelaunchTestOrderArchive = {
    find(filter) {
      actions.push({ type: 'archive-find', filter });
      return { async lean() { return structuredClone(archives); } };
    },
    collection: {
      name: ARCHIVE_COLLECTION,
      async indexes() {
        actions.push({ type: 'archive-indexes' });
        return structuredClone(archiveIndexes);
      },
      async createIndex(key, settings) {
        actions.push({ type: 'archive-create-index', key, settings });
        archiveIndexes.push({ name: settings.name, key, unique: settings.unique });
        return settings.name;
      },
    },
    async create(docs, settings) {
      actions.push({ type: 'archive-create', docs, settings });
      assert.equal(settings.session, session);
      if (options.failArchive) throw new Error('sensitive archive error');
      archives.push(...structuredClone(docs));
      return docs;
    },
  };
  const AdminAuditEvent = {
    async create(docs, settings) {
      actions.push({ type: 'audit-create', docs, settings });
      assert.equal(settings.session, session);
      if (options.failAudit) throw new Error('sensitive audit error');
      audits.push(...structuredClone(docs));
      return docs;
    },
  };
  const deps = {
    Order,
    PrelaunchTestOrderArchive,
    AdminAuditEvent,
    User: { exists: async () => true },
    mongoose: {
      connection: {
        db: {
          listCollections(filter) {
            actions.push({ type: 'list-collections', filter });
            return { async toArray() { return collectionExists ? [{ name: filter.name }] : []; } };
          },
          async createCollection(name) {
            actions.push({ type: 'create-collection', name });
            collectionExists = true;
            archiveIndexes = [{ name: '_id_', key: { _id: 1 }, unique: true }];
          },
        },
      },
      async startSession() {
        sessionStarted += 1;
        return session;
      },
    },
    stripe: stripe.client,
    releaseInventoryReservation: async (record) => {
      actions.push({ type: 'release-inventory', orderId: record._id });
      if (options.failInventoryRelease) return { restored: false, reason: 'blocked' };
      const current = orders.get(String(record._id));
      if (current) {
        current.inventoryRestoredAt = new Date('2026-10-04T00:00:00Z');
        current.inventoryReservedAt = null;
        current.inventoryAdjustments = [];
        current.inventoryAdjustmentVersion = null;
      }
      return { restored: true, lines: [{ quantity: 1 }] };
    },
    countReleaseBlockers: async () => options.blockerCounts || {
      activeReservationCount: 0,
      incompletePaidOrderCount: 0,
      unresolvedPaymentIntentCount: 0,
    },
  };
  return {
    deps,
    actions,
    archives,
    audits,
    orders,
    stripe,
    get sessionStarted() { return sessionStarted; },
    get sessionEnded() { return sessionEnded; },
    get collectionExists() { return collectionExists; },
    run: (argv = [], env = {}) => reset.run({
      argv,
      env,
      deps,
      now: () => new Date('2026-10-04T12:00:00Z'),
    }),
    prepare: (confirmed) => prepareArchive.prepareStorage({
      mongoose: deps.mongoose,
      PrelaunchTestOrderArchive,
      reset,
      confirmed,
    }),
  };
}

function applyEnv() {
  return {
    RESET_ACTOR_USER_ID: ACTOR_ID,
    RESET_EXPECTED_SOURCE_SHA: SOURCE_SHA,
    RESET_SOURCE_BACKEND_SHA: SOURCE_SHA,
    CHECKOUT_INITIATION_GATED: 'true',
  };
}

test('default dry-run classifies exact 63 prelaunch liabilities with zero writes', async () => {
  const fixture = harness({ collectionExists: false });
  const result = await fixture.run();
  assert.deepEqual(result, {
    mode: 'dry-run', A1: 5, B: 3, D: 21, G: 34, H: 1, total: 63, applied: 0,
  });
  assert.equal(fixture.collectionExists, false);
  assert.equal(fixture.sessionStarted, 0);
  assert.equal(fixture.actions.some((action) =>
    ['create-collection', 'archive-create-index', 'archive-create', 'audit-create',
      'order-delete', 'release-inventory'].includes(action.type)), false);
  assert.equal(fixture.stripe.calls.some(([name]) => name === 'paymentIntents.cancel'), false);
});

test('preparation utility is explicit, idempotent, and only creates archive storage', async () => {
  assert.deepEqual(prepareArchive.parseArgs([]), { confirmed: false });
  assert.deepEqual(prepareArchive.parseArgs(['--confirm', prepareArchive.CONFIRMATION]),
    { confirmed: true });
  assert.throws(() => prepareArchive.parseArgs(['--confirm', 'wrong']),
    /PREPARE_CONFIRMATION_REQUIRED/);
  const dryRun = harness({ collectionExists: false });
  assert.deepEqual(await dryRun.prepare(false), {
    mode: 'dry-run', collection: ARCHIVE_COLLECTION, exists: false, ready: false,
  });
  assert.equal(dryRun.collectionExists, false);
  const created = harness({ collectionExists: false });
  assert.deepEqual(await created.prepare(true), {
    mode: 'apply', collection: ARCHIVE_COLLECTION, exists: true, ready: true,
  });
  assert.deepEqual(created.actions.filter((action) => action.type === 'archive-create-index')
    .map((action) => action.settings.name), ['archiveEntryId_1', 'sourceOrderId_1']);
  const ready = harness();
  await ready.prepare(true);
  assert.equal(ready.actions.some((action) =>
    ['create-collection', 'archive-create-index', 'archive-create', 'audit-create',
      'order-delete'].includes(action.type)), false);
});

test('incompatible archive indexes block preparation and apply', async () => {
  const archiveIndexes = [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'unsafe_extra_1', key: { unsafe_extra: 1 }, unique: false },
  ];
  const fixture = harness({ archiveIndexes });
  await assert.rejects(fixture.prepare(true), /ARCHIVE_STORAGE_NOT_PREPARED/);
  await assert.rejects(fixture.run(APPLY, applyEnv()), /ARCHIVE_STORAGE_NOT_PREPARED/);
  assert.equal(fixture.sessionStarted, 0);
});

test('livemode true and changed Stripe state block the reset before writes', async () => {
  const live = harness();
  live.stripe.intents.get('pi_D_1').livemode = true;
  await assert.rejects(live.run(), /LIVE_STRIPE_OBJECT/);
  assert.equal(live.actions.some((action) => action.type === 'order-delete'), false);

  const changed = harness();
  changed.stripe.intents.get('pi_D_2').status = 'succeeded';
  await assert.rejects(changed.run(), /STRIPE_STATE_CHANGED/);
  assert.equal(changed.actions.some((action) => action.type === 'paymentIntents.cancel'), false);
});

test('apply requires actor, checkout gate, source SHA, storage, and exact counts', async () => {
  const fixture = harness();
  await assert.rejects(fixture.run(APPLY, { ...applyEnv(), RESET_ACTOR_USER_ID: undefined }),
    /VALID_ACTOR_USER_ID_REQUIRED/);
  await assert.rejects(fixture.run(APPLY, { ...applyEnv(), CHECKOUT_INITIATION_GATED: 'false' }),
    /CHECKOUT_GATE_REQUIRED/);
  await assert.rejects(fixture.run(APPLY, { ...applyEnv(), RESET_SOURCE_BACKEND_SHA: SOURCE_SHA.replace(/.$/, '0') }),
    /SOURCE_SHA_MISMATCH/);
  const drift = harness({ orders: fixtureOrders().slice(1) });
  await assert.rejects(drift.run(APPLY, applyEnv()), /EXPECTED_COUNT_DRIFT/);
  assert.equal(drift.sessionStarted, 0);
});

test('apply cancels only D intents, restores H once, archives, audits, then deletes active orders', async () => {
  const fixture = harness();
  const result = await fixture.run(APPLY, applyEnv());
  assert.deepEqual(result, {
    mode: 'apply', A1: 5, B: 3, D: 21, G: 34, H: 1, total: 63, applied: 63,
  });
  assert.equal(fixture.sessionStarted, 2);
  assert.equal(fixture.sessionEnded, 2);
  assert.equal(fixture.stripe.calls.filter(([name]) => name === 'paymentIntents.cancel').length, 21);
  assert.equal(fixture.stripe.calls.some(([name, id]) => name === 'paymentIntents.cancel' && !id.startsWith('pi_D_')), false);
  assert.equal(fixture.actions.filter((action) => action.type === 'release-inventory').length, 1);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.audits.length, 126);
  assert.equal(fixture.orders.size, 1);
  const firstCancel = fixture.actions.findIndex((action) => action.type === 'release-inventory');
  const firstCheckpoint = fixture.actions.findIndex((action) => action.type === 'archive-create');
  assert.equal(firstCheckpoint >= 0 && firstCheckpoint < firstCancel, true);
  assert.equal(fixture.actions.filter((action) => action.type === 'archive-create').length, 63);
  assert.equal(fixture.actions.filter((action) => action.type === 'order-delete').length, 63);
});


test('checkpoint archives preserve the complete original order document beyond classification projection', async () => {
  const fixture = harness();
  await fixture.run(APPLY, applyEnv());
  const archive = fixture.archives.find((entry) => entry.classification === 'A1');
  assert.ok(archive);
  assert.match(archive.sourceOrder.groupOrderId, /^TEST-A1-/);
  assert.equal(String(archive.sourceOrder.userId), oid('u', 1));
  assert.equal(String(archive.sourceOrder.vendorId), oid('v', 1));
  assert.equal(String(archive.sourceOrder.businessId), oid('b', 1));
  assert.deepEqual(archive.sourceOrder.shipping, { method: 'ground', amount: 123 });
  assert.deepEqual(archive.sourceOrder.shippingAddress, {
    city: 'Testville', line1: '123 Test St', postalCode: '12345',
  });
  assert.deepEqual(archive.sourceOrder.statusHistory, [
    { status: 'created', at: new Date('2026-01-01T00:00:00Z'), by: 'fixture' },
  ]);
  assert.equal(archive.sourceOrder.trackingNumber.startsWith('TRACK-A1-'), true);
  assert.deepEqual(archive.sourceOrder.miscellaneousPersistedField.nested,
    { value: 'extra-A1-1' });
});

test('critical-state drift during full checkpoint reread blocks before Stripe cancellation', async () => {
  let drifted = false;
  const fixture = harness({
    onTransactionStart(orders) {
      if (!drifted) {
        const first = orders.get(oid('d', 1));
        first.paymentStatus = 'paid';
        drifted = true;
      }
    },
  });
  await assert.rejects(fixture.run(APPLY, applyEnv()), /ORDER_STATE_CHANGED/);
  assert.equal(fixture.archives.length, 0);
  assert.equal(fixture.audits.length, 0);
  assert.equal(fixture.stripe.calls.some(([name]) => name === 'paymentIntents.cancel'), false);
});
test('G is truthful archive-only and never fabricates email evidence', async () => {
  const fixture = harness();
  await fixture.run(APPLY, applyEnv());
  const gArchives = fixture.archives.filter((entry) => entry.classification === 'G');
  assert.equal(gArchives.length, 34);
  for (const archive of gArchives) {
    assert.equal(archive.sourceOrder.paidConfirmationEmailSentAt, null);
    assert.notEqual(archive.sourceOrder.paidOrderEmailDelivery?.customer?.status, 'fabricated');
  }
  assert.equal(JSON.stringify(fixture.actions).includes('sendMail'), false);
});

test('final transaction rollback preserves checkpoint archives and active orders', async () => {
  const fixture = harness({ failDelete: true });
  await assert.rejects(fixture.run(APPLY, applyEnv()), /TRANSACTION_FAILED/);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.audits.length, 63);
  assert.equal(fixture.orders.size, 64);
  assert.equal(fixture.actions.some((action) => action.type === 'rollback'), true);
});

test('inventory failure blocks active deletion after durable checkpoint', async () => {
  const fixture = harness({ failInventoryRelease: true });
  await assert.rejects(fixture.run(APPLY, applyEnv()), /INVENTORY_RESTORE_FAILED/);
  assert.equal(fixture.sessionStarted, 1);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.actions.some((action) => action.type === 'order-delete'), false);
});



test('checkpoint transaction failure prevents any Stripe cancellation', async () => {
  const fixture = harness({ failArchive: true });
  await assert.rejects(fixture.run(APPLY, applyEnv()), /CHECKPOINT_TRANSACTION_FAILED/);
  assert.equal(fixture.archives.length, 0);
  assert.equal(fixture.audits.length, 0);
  assert.equal(fixture.orders.size, 64);
  assert.equal(fixture.stripe.calls.some(([name]) => name === 'paymentIntents.cancel'), false);
});

test('interrupted run after one D cancellation resumes from checkpoint', async () => {
  const fixture = harness();
  const originalCancel = fixture.deps.stripe.paymentIntents.cancel;
  let cancelCount = 0;
  fixture.deps.stripe.paymentIntents.cancel = async (id) => {
    cancelCount += 1;
    const result = await originalCancel(id);
    if (cancelCount === 1) throw new Error('interrupted after first cancel');
    return result;
  };
  await assert.rejects(fixture.run(APPLY, applyEnv()), /STRIPE_READ_FAILED/);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.stripe.calls.filter(([name]) => name === 'paymentIntents.cancel').length, 1);
  fixture.deps.stripe.paymentIntents.cancel = originalCancel;
  assert.equal((await fixture.run(APPLY, applyEnv())).applied, 63);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.orders.size, 1);
});
test('interrupted run after D cancellations resumes from checkpoint without duplicate archives', async () => {
  const fixture = harness();
  const originalCancel = fixture.deps.stripe.paymentIntents.cancel;
  let cancelCount = 0;
  fixture.deps.stripe.paymentIntents.cancel = async (id) => {
    cancelCount += 1;
    const result = await originalCancel(id);
    if (cancelCount === 10) throw new Error('interrupted after cancel');
    return result;
  };
  await assert.rejects(fixture.run(APPLY, applyEnv()), /STRIPE_READ_FAILED/);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.stripe.calls.filter(([name]) => name === 'paymentIntents.cancel').length, 10);
  fixture.deps.stripe.paymentIntents.cancel = originalCancel;

  const result = await fixture.run(APPLY, applyEnv());
  assert.equal(result.applied, 63);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.audits.filter((event) => event.actionCode === reset.CHECKPOINT_ACTION_CODE).length, 63);
  assert.equal(fixture.audits.filter((event) => event.actionCode === reset.FINAL_ACTION_CODE).length, 63);
  assert.equal(fixture.orders.size, 1);
});

test('checkpoint-backed canceled D intents are accepted but canceled D without checkpoint blocks', async () => {
  const checkpointed = harness();
  let failDelete = true;
  checkpointed.actions.push({ type: 'note', case: 'force final failure' });
  checkpointed.deps.Order.deleteOne = async (filter, settings) => {
    checkpointed.actions.push({ type: 'order-delete', filter, settings });
    assert.ok(settings.session);
    if (failDelete) throw new Error('final failed');
    const found = [...checkpointed.orders.values()].find((record) => matches(record, filter));
    if (!found) return { deletedCount: 0 };
    checkpointed.orders.delete(String(found._id));
    return { deletedCount: 1 };
  };
  await assert.rejects(checkpointed.run(APPLY, applyEnv()), /FINAL_TRANSACTION_FAILED/);
  assert.equal(checkpointed.archives.length, 63);
  assert.equal(checkpointed.stripe.intents.get('pi_D_1').status, 'canceled');
  failDelete = false;
  assert.equal((await checkpointed.run(APPLY, applyEnv())).applied, 63);

  const uncheckpointed = harness();
  uncheckpointed.stripe.intents.get('pi_D_1').status = 'canceled';
  await assert.rejects(uncheckpointed.run(APPLY, applyEnv()), /STRIPE_STATE_CHANGED/);
  assert.equal(uncheckpointed.archives.length, 0);
});

test('H restoration interruption resumes without restoring twice and rejects restored H without checkpoint', async () => {
  let failDelete = true;
  const fixture = harness({ failDelete: () => failDelete });
  await assert.rejects(fixture.run(APPLY, applyEnv()), /FINAL_TRANSACTION_FAILED/);
  assert.equal(fixture.actions.filter((action) => action.type === 'release-inventory').length, 1);
  failDelete = false;
  assert.equal((await fixture.run(APPLY, applyEnv())).applied, 63);
  assert.equal(fixture.actions.filter((action) => action.type === 'release-inventory').length, 1);

  const restoredOrders = fixtureOrders();
  const h = restoredOrders.find((record) => record.paymentId === 'pi_D_1');
  h.inventoryReservedAt = null;
  h.inventoryRestoredAt = new Date('2026-10-04T00:00:00Z');
  h.inventoryDecrementedAt = null;
  const noCheckpoint = harness({ orders: restoredOrders });
  await assert.rejects(noCheckpoint.run(APPLY, applyEnv()), /H_OVERLAY_MISMATCH|EXPECTED_COUNT_DRIFT/);
  assert.equal(noCheckpoint.archives.length, 0);
});

test('completed rerun reports already complete without Stripe, inventory, archive, or audit writes', async () => {
  const fixture = harness();
  await fixture.run(APPLY, applyEnv());
  const actionCount = fixture.actions.length;
  const stripeCallCount = fixture.stripe.calls.length;
  const auditCount = fixture.audits.length;
  const result = await fixture.run(APPLY, applyEnv());
  assert.equal(result.status, 'ALREADY_COMPLETE');
  assert.equal(result.applied, 0);
  assert.equal(fixture.archives.length, 63);
  assert.equal(fixture.audits.length, auditCount);
  assert.equal(fixture.stripe.calls.length, stripeCallCount);
  assert.equal(fixture.actions.slice(actionCount).some((action) =>
    ['release-inventory', 'archive-create', 'audit-create', 'order-delete'].includes(action.type)), false);
});
test('verification mode returns only release blocker counts', async () => {
  const fixture = harness({ blockerCounts: {
    activeReservationCount: 0,
    incompletePaidOrderCount: 0,
    unresolvedPaymentIntentCount: 0,
  } });
  assert.deepEqual(await fixture.run(['--verify-reset']), {
    mode: 'verify-reset',
    activeReservationCount: 0,
    incompletePaidOrderCount: 0,
    unresolvedPaymentIntentCount: 0,
  });
});

test('stdout-safe summaries and normal admin audit metadata do not expose sensitive IDs', async () => {
  const fixture = harness();
  const dryRun = await fixture.run();
  const applied = await fixture.run(APPLY, applyEnv());
  assert.doesNotMatch(JSON.stringify([dryRun, applied]), /pi_|ch_|TEST-|private|507f/);
  for (const event of fixture.audits) {
    assert.equal(event.targetType, 'PrelaunchTestOrderArchive');
    assert.match(event.targetId, /^[0-9a-f-]{36}$/i);
    assert.doesNotMatch(JSON.stringify(event), /pi_|TEST-|ch_pi_/);
  }
});

test('restricted archive has no route/controller exposure and disables auto storage creation', async () => {
  const Archive = require('../../models/PrelaunchTestOrderArchive');
  assert.equal(Archive.schema.options.autoCreate, false);
  assert.equal(Archive.schema.options.autoIndex, false);
  const uniqueIndexFields = new Set(Archive.schema.indexes()
    .filter(([, options]) => options.unique === true)
    .flatMap(([fields]) => Object.keys(fields)));
  assert.equal(uniqueIndexFields.has('archiveEntryId'), true);
  assert.equal(uniqueIndexFields.has('sourceOrderId'), true);
  const scan = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return scan(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
  for (const directory of ['routes', 'controllers']) {
    for (const file of scan(path.resolve(__dirname, '../..', directory))) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /PrelaunchTestOrderArchive/);
    }
  }
});
