const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCK_TTL_MS,
  claimOrderTransition,
  releaseOrderTransition,
  withOrderTransition,
} = require('../../lib/orders/orderTransitionLock');

function fakeModel(modifiedCount = 1) {
  const calls = [];
  return {
    calls,
    async updateOne(filter, update) {
      calls.push({ filter, update });
      return { modifiedCount };
    },
  };
}

test('claim is conditional on expected status and an absent or stale lock', async () => {
  const model = fakeModel();
  const now = new Date('2026-11-19T12:00:00Z');

  assert.equal(await claimOrderTransition(model, 'o1', ['ordered', 'accepted'], now), true);

  const { filter, update } = model.calls[0];
  assert.equal(filter._id, 'o1');
  assert.deepEqual(filter.status, { $in: ['ordered', 'accepted'] });
  assert.deepEqual(filter.$or[0], { transitionLockedAt: null });
  assert.deepEqual(filter.$or[2], { transitionLockedAt: { $lt: new Date(now.getTime() - LOCK_TTL_MS) } });
  assert.deepEqual(update, { $set: { transitionLockedAt: now } });
});

test('claim reports false when no document matched (status changed or lock held)', async () => {
  assert.equal(await claimOrderTransition(fakeModel(0), 'o1', 'ordered'), false);
});

test('release only clears the lock this request claimed', async () => {
  const model = fakeModel();
  const at = new Date('2026-11-19T12:00:00Z');
  await releaseOrderTransition(model, 'o1', at);
  assert.deepEqual(model.calls[0], {
    filter: { _id: 'o1', transitionLockedAt: at },
    update: { $set: { transitionLockedAt: null } },
  });
});

test('release never throws', async () => {
  const model = { async updateOne() { throw new Error('db down'); } };
  await releaseOrderTransition(model, 'o1', new Date());
});

test('withOrderTransition skips fn when unclaimed and releases after fn throws', async () => {
  let ran = false;
  const unclaimed = await withOrderTransition(fakeModel(0), 'o1', 'ordered', async () => { ran = true; });
  assert.deepEqual(unclaimed, { claimed: false });
  assert.equal(ran, false);

  const model = fakeModel();
  await assert.rejects(
    withOrderTransition(model, 'o1', 'ordered', async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.equal(model.calls.length, 2);
  assert.equal(model.calls[1].update.$set.transitionLockedAt, null);
});
