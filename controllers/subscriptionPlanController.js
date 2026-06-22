const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { ensurePlanPrice } = require('../helpers/stripePlan');
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require('../utils/audit/actionRegistry');
const {
  recordAdminAuditSuccess,
  buildFieldChangeSummary,
} = require('../services/adminAuditService');

exports.createSubscriptionPlan = async (req, res) => {
  try {
    const {
      name,
      price,
      durationInDays,
      limits,
      features,
      currency = 'usd',
      interval = 'year',
      intervalCount = 1,
      trialPeriodDays = 0,
    } = req.body;

    if (!name || typeof name !== 'string') return res.status(400).json({ message: 'Invalid or missing name' });
    if (typeof price !== 'number' || price < 0) return res.status(400).json({ message: 'Invalid price' });
    if (durationInDays && (typeof durationInDays !== 'number' || durationInDays <= 0))
      return res.status(400).json({ message: 'Invalid durationInDays' });
    if (limits && typeof limits !== 'object') return res.status(400).json({ message: 'limits must be an object' });
    if (features && typeof features !== 'object') return res.status(400).json({ message: 'features must be an object' });

    const exists = await SubscriptionPlan.findOne({ name });
    if (exists) return res.status(409).json({ message: 'Subscription plan with this name already exists.' });

    // Create the plan locally
    const plan = new SubscriptionPlan({
      name,
      price,
      durationInDays,
      limits,
      features,
      currency: currency.toLowerCase(),
      interval,
      intervalCount,
      trialPeriodDays,
    });

    await plan.save();

    // Create Stripe Product+Price (and save IDs back)
    await ensurePlanPrice(plan);

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CREATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.SUBSCRIPTION_PLAN,
      targetId: plan._id,
      changeSummary: buildFieldChangeSummary(
        {},
        { name: plan.name, price: plan.price, durationInDays: plan.durationInDays },
        ['name', 'price', 'durationInDays']
      ),
    });

    return res.status(201).json({
      message: 'Subscription plan created successfully',
      plan,
    });
  } catch (err) {
    console.error('Error creating subscription plan:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Update plan. If price/currency/interval changed, create a NEW Stripe Price and switch.
 * (Stripe prices are immutable—never edit the existing one.)
 */
exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      price,
      durationInDays,
      limits,
      features,
      currency,
      interval,
      intervalCount,
      trialPeriodDays,
    } = req.body;

    const plan = await SubscriptionPlan.findById(id);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    const beforeSummary = {
      name: plan.name,
      price: plan.price,
      durationInDays: plan.durationInDays,
    };

    // Apply simple fields
    if (name) plan.name = name;
    if (typeof durationInDays === 'number') plan.durationInDays = durationInDays;
    if (limits) plan.limits = limits;
    if (features) plan.features = features;

    // Detect billing changes that require a NEW Stripe price
    const willChangeBilling =
      (typeof price === 'number' && price !== plan.price) ||
      (currency && currency.toLowerCase() !== (plan.currency || 'usd')) ||
      (interval && interval !== plan.interval) ||
      (typeof intervalCount === 'number' && intervalCount !== plan.intervalCount) ||
      (typeof trialPeriodDays === 'number' && trialPeriodDays !== plan.trialPeriodDays);

    if (willChangeBilling) {
      // Update local billing fields first
      if (typeof price === 'number') plan.price = price;
      if (currency) plan.currency = currency.toLowerCase();
      if (interval) plan.interval = interval;
      if (typeof intervalCount === 'number') plan.intervalCount = intervalCount;
      if (typeof trialPeriodDays === 'number') plan.trialPeriodDays = trialPeriodDays;

      // Ensure product exists, then create a NEW price and replace stripePriceId
      if (!plan.stripeProductId) {
        const product = await stripe.products.create({
          name: plan.name,
          metadata: { planId: String(plan._id) },
        });
        plan.stripeProductId = product.id;
      }

      const newPrice = await stripe.prices.create({
        unit_amount: Math.round(plan.price * 100),
        currency: plan.currency,
        recurring: {
          interval: plan.interval,
          interval_count: plan.intervalCount,
          ...(plan.trialPeriodDays > 0 ? { trial_period_days: plan.trialPeriodDays } : {}),
        },
        product: plan.stripeProductId,
        nickname: plan.name,
        metadata: { planId: String(plan._id) },
      });

      // Switch the plan to use the new price (existing subscribers remain on old price)
      plan.stripePriceId = newPrice.id;
    }

    await plan.save();

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.SUBSCRIPTION_PLAN_UPDATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.SUBSCRIPTION_PLAN,
      targetId: plan._id,
      changeSummary: buildFieldChangeSummary(
        beforeSummary,
        {
          name: plan.name,
          price: plan.price,
          durationInDays: plan.durationInDays,
        },
        ['name', 'price', 'durationInDays']
      ),
    });

    return res.status(200).json({
      message: 'Subscription plan updated successfully',
      plan,
    });
  } catch (err) {
    console.error('Error updating subscription plan:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// exports.listSubscriptionPlans = async (req, res) => {
//   try {
//     const plans = await SubscriptionPlan.find().sort({ createdAt: -1 });
//     return res.status(200).json({ success: true, data: plans });
//   } catch (err) {
//     console.error('Error listing plans:', err);
//     return res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// };

exports.listSubscriptionPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find();

    // Custom order
    const order = ['Silver', 'Gold', 'Platinum'];
    const sortedPlans = plans.sort(
      (a, b) => order.indexOf(a.name) - order.indexOf(b.name)
    );

    return res.status(200).json({ success: true, data: sortedPlans });
  } catch (err) {
    console.error('Error listing plans:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


exports.getSubscriptionPlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    return res.status(200).json({ success: true, plan });
  } catch (err) {
    console.error('Error fetching plan:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
