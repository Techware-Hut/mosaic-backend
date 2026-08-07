const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getInventoryReservationExpiryConfig,
  getReservationCutoff,
  reconcileExpiredReservation,
  runInventoryReservationExpiryBatch,
} = require('../../jobs/inventoryReservationExpiry');

test('reservation expiry is disabled by default pending TTL approval', () => {
  const previous = process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY;
  delete process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY;
  try {
    const config = getInventoryReservationExpiryConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.ttlMinutes, 30);
  } finally {
    if (previous === undefined) {
      delete process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY;
    } else {
      process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY = previous;
    }
  }
});

function makeOrder(overrides = {}) {
  return {
    _id: overrides._id || 'order-1',
    paymentId: overrides.paymentId ?? 'pi_1',
    inventoryReservedAt: overrides.inventoryReservedAt || new Date(0),
    paymentStatus: 'pending',
    status: 'ordered',
    ...overrides,
  };
}

function makeOrderModel(orders) {
  const updates = [];
  return {
    updates,
    find(filter) {
      assert.ok(filter.inventoryReservedAt.$lte instanceof Date);
      return {
        sort() {
          return this;
        },
        limit(limit) {
          assert.ok(limit > 0);
          return this;
        },
        async exec() {
          return orders;
        },
      };
    },
    async findByIdAndUpdate(id, update) {
      updates.push({ id, update });
      return null;
    },
  };
}

test('reservation cutoff uses the configured TTL', () => {
  const now = Date.UTC(2026, 7, 6, 12, 0, 0);
  assert.equal(
    getReservationCutoff(30, now).toISOString(),
    '2026-08-06T11:30:00.000Z'
  );
});

test('expired retryable PaymentIntent is canceled before inventory is released', async () => {
  const order = makeOrder();
  const sequence = [];
  const OrderModel = makeOrderModel([order]);

  const result = await runInventoryReservationExpiryBatch({
    config: { enabled: true, ttlMinutes: 30, batchLimit: 50 },
    OrderModel,
    stripe: {
      paymentIntents: {
        async cancel() {
          sequence.push('cancel');
          return { id: order.paymentId, status: 'canceled' };
        },
      },
    },
    async releaseReservation() {
      sequence.push('release');
      return { restored: true };
    },
  });

  assert.deepEqual(sequence, ['cancel', 'release']);
  assert.equal(result.results[0].action, 'released_expired_reservation');
  assert.deepEqual(OrderModel.updates[0].update, {
    paymentStatus: 'failed',
    status: 'cancelled',
  });
});

test('already-succeeded PaymentIntent finalizes and never releases inventory', async () => {
  const order = makeOrder();
  const sequence = [];
  const OrderModel = makeOrderModel([order]);
  const cancelError = new Error('cannot cancel succeeded intent');

  const result = await reconcileExpiredReservation({
    order,
    OrderModel,
    stripe: {
      paymentIntents: {
        async cancel() {
          sequence.push('cancel');
          throw cancelError;
        },
        async retrieve() {
          sequence.push('retrieve');
          return { id: order.paymentId, status: 'succeeded' };
        },
      },
    },
    async releaseReservation() {
      sequence.push('release');
      return { restored: true };
    },
    async finalizeReservation() {
      sequence.push('finalize');
      return { decremented: true };
    },
  });

  assert.deepEqual(sequence, ['cancel', 'retrieve', 'finalize']);
  assert.equal(result.action, 'finalized_succeeded_payment');
  assert.deepEqual(OrderModel.updates[0].update, {
    paymentStatus: 'paid',
    status: 'ordered',
  });
});

test('uncancelled PaymentIntent keeps its reservation', async () => {
  const order = makeOrder();
  let releases = 0;
  const cancelError = new Error('Stripe is unavailable');

  await assert.rejects(
    reconcileExpiredReservation({
      order,
      OrderModel: makeOrderModel([order]),
      stripe: {
        paymentIntents: {
          async cancel() {
            throw cancelError;
          },
          async retrieve() {
            return { id: order.paymentId, status: 'requires_payment_method' };
          },
        },
      },
      async releaseReservation() {
        releases += 1;
        return { restored: true };
      },
      async finalizeReservation() {
        throw new Error('must not finalize');
      },
    }),
    cancelError
  );

  assert.equal(releases, 0);
});
