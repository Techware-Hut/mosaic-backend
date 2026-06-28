const Stripe = require('stripe');
const Business = require('../models/Business'); // adjust path if needed
const Subscription = require('../models/Subscription'); // adjust path if needed

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function idString(value) {
  if (!value) return '';
  if (value._id) return String(value._id);
  return String(value);
}

function getRequestUserId(req) {
  return idString(req.user?.id || req.user?._id);
}

function userOwnsBusiness(req, biz) {
  const userId = getRequestUserId(req);
  return Boolean(userId && biz?.owner && idString(biz.owner) === userId);
}

async function findLocalSubscriptionForBusiness(biz, stripeSubscriptionId) {
  if (!biz?._id) return null;

  if (biz.subscriptionId) {
    const byId = await Subscription.findById(biz.subscriptionId);
    if (byId) return byId;
  }

  const query = { businessId: biz._id };
  if (stripeSubscriptionId) {
    query.stripeSubscriptionId = stripeSubscriptionId;
  }

  const result = Subscription.findOne(query);
  if (result && typeof result.sort === 'function') {
    return result.sort({ createdAt: -1 });
  }

  return result;
}

async function backfillStripePointers(biz, stripeSub) {
  let changed = false;
  if (!biz.stripeCustomerId && stripeSub?.customer) {
    biz.stripeCustomerId = String(stripeSub.customer);
    changed = true;
  }
  if (!biz.stripeSubscriptionId && stripeSub?.id) {
    biz.stripeSubscriptionId = String(stripeSub.id);
    changed = true;
  }
  if (changed && typeof biz.save === 'function') {
    await biz.save();
  }
}

function subscriptionBelongsToBusiness(biz, localSub, stripeSub) {
  if (!stripeSub) return false;

  const knownSubscriptionIds = [
    biz?.stripeSubscriptionId,
    localSub?.stripeSubscriptionId,
  ].map(idString).filter(Boolean);

  if (knownSubscriptionIds.length > 0) {
    return Boolean(stripeSub.id && knownSubscriptionIds.includes(String(stripeSub.id)));
  }

  const stripeCustomerId = idString(stripeSub.customer);
  const knownCustomerIds = [
    biz?.stripeCustomerId,
    localSub?.stripeCustomerId,
  ].map(idString).filter(Boolean);

  return Boolean(stripeCustomerId && knownCustomerIds.includes(stripeCustomerId));
}

// helper: pick a "display" subscription from a list
function pickPreferredSubscription(list = []) {
  const preferredStatuses = ['active', 'trialing', 'past_due', 'incomplete'];
  return list.find(s => preferredStatuses.includes(s.status)) || list[0] || null;
}

// helper: map Stripe subscription -> your SubscriptionSummary dto
function mapSub(s) {
  if (!s) return null;
  const item = s.items?.data?.[0];
  const price = item?.price;
  return {
    id: s.id,
    planId: price?.id || '',
    planName: price?.nickname || price?.product?.name || 'Subscription',
    price: (price?.unit_amount ?? 0) / 100,
    currency: (price?.currency ?? 'usd').toUpperCase(),
    interval: price?.recurring?.interval || 'month',
    intervalCount: price?.recurring?.interval_count || 1,
    status: s.status,
    currentPeriodEnd: new Date((s.current_period_end ?? 0) * 1000).toISOString(),
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
  };
}

/**
 * GET /api/subscriptions/current?businessId=...
 * Returns { success, subscription: SubscriptionSummary | null }
 */
exports.getCurrentSubscriptionForBusiness = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });

    const biz = await Business.findById(businessId);
    if (!biz) return res.status(404).json({ success: false, message: 'Business not found' });
    if (!userOwnsBusiness(req, biz)) {
      return res.status(403).json({ success: false, message: 'Business does not belong to this user' });
    }

    const localSub = await findLocalSubscriptionForBusiness(biz);
    const stripeSubscriptionId = biz.stripeSubscriptionId || localSub?.stripeSubscriptionId;

    // try direct by stored subscription id first
    let sub = null;
    if (stripeSubscriptionId) {
      try {
        sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
          expand: ['items.data.price.product'],
        });
        await backfillStripePointers(biz, sub);
      } catch (_) { /* fall through */ }
    }

    // otherwise list by customer
    if (!sub && biz.stripeCustomerId) {
      const list = await stripe.subscriptions.list({
        customer: biz.stripeCustomerId,
        status: 'all',
        expand: ['data.items.data.price.product'],
        limit: 10,
      });
      sub = pickPreferredSubscription(list.data);
    }

    return res.status(200).json({ success: true, subscription: mapSub(sub) });
  } catch (err) {
    console.error('getCurrentSubscriptionForBusiness error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Stripe error' });
  }
};

/**
 * POST /api/subscriptions/:id/cancel
 * body: { atPeriodEnd: boolean, businessId: string }
 */
exports.cancelSubscriptionForBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { atPeriodEnd, businessId } = req.body;
    if (!id || !businessId) return res.status(400).json({ success: false, message: 'id and businessId are required' });

    const biz = await Business.findById(businessId);
    if (!biz) return res.status(404).json({ success: false, message: 'Business not found' });
    if (!userOwnsBusiness(req, biz)) {
      return res.status(403).json({ success: false, message: 'Business does not belong to this user' });
    }

    const localSub = await findLocalSubscriptionForBusiness(biz, id);
    const sub = await stripe.subscriptions.retrieve(id);
    if (!subscriptionBelongsToBusiness(biz, localSub, sub)) {
      return res.status(403).json({ success: false, message: 'Subscription does not belong to this business' });
    }
    await backfillStripePointers(biz, sub);

    let updated;
    if (atPeriodEnd) {
      updated = await stripe.subscriptions.update(id, { cancel_at_period_end: true });
    } else {
      updated = await stripe.subscriptions.cancel(id);
    }

    return res.status(200).json({ success: true, subscription: mapSub(updated) });
  } catch (err) {
    console.error('cancelSubscriptionForBusiness error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Stripe error' });
  }
};

/**
 * POST /api/subscriptions/:id/resume
 * body: { businessId: string }
 * Only works if cancel_at_period_end is true and subscription still active.
 */
exports.resumeSubscriptionForBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { businessId } = req.body;
    if (!id || !businessId) return res.status(400).json({ success: false, message: 'id and businessId are required' });

    const biz = await Business.findById(businessId);
    if (!biz) return res.status(404).json({ success: false, message: 'Business not found' });
    if (!userOwnsBusiness(req, biz)) {
      return res.status(403).json({ success: false, message: 'Business does not belong to this user' });
    }

    const localSub = await findLocalSubscriptionForBusiness(biz, id);
    const sub = await stripe.subscriptions.retrieve(id);
    if (!subscriptionBelongsToBusiness(biz, localSub, sub)) {
      return res.status(403).json({ success: false, message: 'Subscription does not belong to this business' });
    }
    await backfillStripePointers(biz, sub);

    if (!sub.cancel_at_period_end) {
      return res.status(400).json({ success: false, message: 'Subscription is not set to cancel at period end' });
    }

    const updated = await stripe.subscriptions.update(id, { cancel_at_period_end: false });
    return res.status(200).json({ success: true, subscription: mapSub(updated) });
  } catch (err) {
    console.error('resumeSubscriptionForBusiness error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Stripe error' });
  }
};
