const Stripe = require('stripe');
const { isStagingEnv } = require('../utils/frontendUrl');

const defaultStripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Same live-key classification as the staging isolation self-check.
const LIVE_STRIPE_KEY_RE = /^(sk|rk)_live_/;

function isLiveStripeKey(key) {
  return typeof key === 'string' && LIVE_STRIPE_KEY_RE.test(key.trim());
}

/**
 * Hosted staging must never create (or touch) Stripe products/prices with a
 * live key. Throws before any Stripe call; non-staging behavior is unchanged.
 */
function assertNotLiveKeyOnStaging(env = process.env) {
  if (isStagingEnv(env) && isLiveStripeKey(env.STRIPE_SECRET_KEY)) {
    const err = new Error(
      'Refusing to sync the plan with Stripe: hosted staging is configured with a live Stripe key. Use a Stripe test-mode key on staging.'
    );
    err.code = 'STRIPE_LIVE_KEY_ON_STAGING';
    err.statusCode = 503;
    throw err;
  }
}

/**
 * Ensures the plan has a Stripe product & recurring price.
 * Creates them on Stripe if missing, saves to Mongo, and returns { productId, priceId }.
 * `options.stripe` / `options.env` exist for tests; callers pass nothing.
 */
async function ensurePlanPrice(plan, { stripe = defaultStripe, env = process.env } = {}) {
  assertNotLiveKeyOnStaging(env);

  // Reuse a stored price only if it still exists in the current Stripe account.
  if (plan.stripePriceId) {
    try {
      const existingPrice = await stripe.prices.retrieve(plan.stripePriceId);
      if (!existingPrice.deleted) {
        plan.stripeProductId = existingPrice.product;
        if (plan.isModified('stripeProductId')) {
          await plan.save();
        }

        return { productId: plan.stripeProductId, priceId: plan.stripePriceId };
      }
    } catch (error) {
      if (error.code !== 'resource_missing') {
        throw error;
      }

      // The saved Stripe IDs are stale for this account; clear them and recreate below.
      plan.stripePriceId = undefined;
    }
  }

  // Create/reuse Product
  let productId = plan.stripeProductId;
  if (productId) {
    try {
      await stripe.products.retrieve(productId);
    } catch (error) {
      if (error.code !== 'resource_missing') {
        throw error;
      }

      productId = undefined;
      plan.stripeProductId = undefined;
    }
  }

  if (!productId) {
    const product = await stripe.products.create({
      name: plan.name,
      metadata: { planId: String(plan._id), planName: plan.name },
    });
    productId = product.id;
    plan.stripeProductId = productId;
  }

  // Create recurring Price
  const price = await stripe.prices.create({
    unit_amount: Math.round(plan.price * 100),      // cents
    currency: (plan.currency || 'usd').toLowerCase(),
    recurring: {
      interval: plan.interval || 'year',
      interval_count: plan.intervalCount || 1,
      ...(plan.trialPeriodDays > 0 ? { trial_period_days: plan.trialPeriodDays } : {}),
    },
    product: productId,
    nickname: plan.name,
    metadata: { planId: String(plan._id) },
  });

  plan.stripePriceId = price.id;
  await plan.save();

  return { productId, priceId: price.id };
}

module.exports = { ensurePlanPrice, assertNotLiveKeyOnStaging, isLiveStripeKey };
