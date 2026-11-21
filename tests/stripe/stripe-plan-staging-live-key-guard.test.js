const test = require('node:test');
const assert = require('node:assert/strict');

// Synthetic placeholders only (assembled at runtime so they never look like keys).
const fakeKey = (prefix, mode) => [prefix, mode, 'placeholder', 'not', 'real'].join('_');
const LIVE_SECRET = fakeKey('sk', 'live');
const LIVE_RESTRICTED = fakeKey('rk', 'live');
const TEST_SECRET = fakeKey('sk', 'test');

// The helper builds its default client at load time; every test injects a stub,
// so the default client is never used to make a request.
if (!process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = TEST_SECRET;
const { ensurePlanPrice, isLiveStripeKey } = require('../../helpers/stripePlan');

function stubStripe() {
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push({ name, args });
    return result;
  };
  return {
    calls,
    client: {
      prices: {
        retrieve: record('prices.retrieve', { id: 'price_existing', product: 'prod_existing' }),
        create: record('prices.create', { id: 'price_new' }),
      },
      products: {
        retrieve: record('products.retrieve', { id: 'prod_existing' }),
        create: record('products.create', { id: 'prod_new' }),
      },
    },
  };
}

function stubPlan(fields = {}) {
  let saves = 0;
  return {
    _id: 'plan_synthetic_1',
    name: 'Synthetic Plan',
    price: 10,
    currency: 'usd',
    interval: 'year',
    ...fields,
    isModified: () => false,
    save: async () => {
      saves += 1;
    },
    get saves() {
      return saves;
    },
  };
}

test('isLiveStripeKey recognises live secret and restricted keys only', () => {
  assert.equal(isLiveStripeKey(LIVE_SECRET), true);
  assert.equal(isLiveStripeKey(` ${LIVE_RESTRICTED} `), true);
  assert.equal(isLiveStripeKey(TEST_SECRET), false);
  assert.equal(isLiveStripeKey(''), false);
  assert.equal(isLiveStripeKey(undefined), false);
});

test('hosted staging with a live key refuses before any Stripe call', async () => {
  for (const env of [
    { RELEASE_ENVIRONMENT: 'staging', STRIPE_SECRET_KEY: LIVE_SECRET },
    { RELEASE_ENVIRONMENT: ' Staging ', STRIPE_SECRET_KEY: LIVE_RESTRICTED },
    { SENTRY_ENVIRONMENT: 'staging', STRIPE_SECRET_KEY: LIVE_SECRET },
  ]) {
    for (const planFields of [{}, { stripePriceId: 'price_synthetic', stripeProductId: 'prod_synthetic' }]) {
      const stripe = stubStripe();
      const plan = stubPlan(planFields);
      await assert.rejects(
        () => ensurePlanPrice(plan, { stripe: stripe.client, env }),
        (err) => {
          assert.equal(err.code, 'STRIPE_LIVE_KEY_ON_STAGING');
          assert.ok(!err.message.includes(env.STRIPE_SECRET_KEY), 'key must not be echoed');
          return true;
        }
      );
      assert.deepEqual(stripe.calls, [], 'no Stripe call may be made');
      assert.equal(plan.saves, 0);
    }
  }
});

test('hosted staging with a test key still creates the missing product and price', async () => {
  const stripe = stubStripe();
  const plan = stubPlan();
  const result = await ensurePlanPrice(plan, {
    stripe: stripe.client,
    env: { RELEASE_ENVIRONMENT: 'staging', STRIPE_SECRET_KEY: TEST_SECRET },
  });
  assert.deepEqual(result, { productId: 'prod_new', priceId: 'price_new' });
  assert.deepEqual(
    stripe.calls.map((c) => c.name),
    ['products.create', 'prices.create']
  );
});

test('production behavior is unchanged: a live key still creates the missing product and price', async () => {
  const stripe = stubStripe();
  const plan = stubPlan();
  const result = await ensurePlanPrice(plan, {
    stripe: stripe.client,
    env: { RELEASE_ENVIRONMENT: 'production', NODE_ENV: 'production', STRIPE_SECRET_KEY: LIVE_SECRET },
  });
  assert.deepEqual(result, { productId: 'prod_new', priceId: 'price_new' });
  assert.equal(plan.saves, 1);
});

test('production reuses an existing stored price without creating anything', async () => {
  const stripe = stubStripe();
  const plan = stubPlan({ stripePriceId: 'price_existing', stripeProductId: 'prod_existing' });
  const result = await ensurePlanPrice(plan, {
    stripe: stripe.client,
    env: { STRIPE_SECRET_KEY: LIVE_SECRET },
  });
  assert.deepEqual(result, { productId: 'prod_existing', priceId: 'price_existing' });
  assert.deepEqual(stripe.calls.map((c) => c.name), ['prices.retrieve']);
});
