const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { ensurePlanPrice } = require('../helpers/stripePlan'); // ← ADD THIS
const { triggerTierWelcomeNotifications } = require('../utils/vendorTierWelcomeEmail');

exports.createSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    let { planId, applicationId } = req.body;

    // Check query params if not in body (handles ?appId=... from frontend)
    if (!applicationId) {
      applicationId = req.query.applicationId || req.query.appId;
    }

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: 'planId is required'
      });
    }

    // if (!applicationId) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'applicationId is required'
    //   });
    // }

    // Get plan
    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Ensure the Stripe price exists in the active Stripe account.
    const { priceId } = await ensurePlanPrice(plan);

    if (!priceId) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create Stripe price for plan'
      });
    }

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: req.user.email,
      name: req.user.name,
      metadata: { userId: userId.toString() }
    });

    // Create subscription with incomplete status
    const stripeSubscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        userId: userId.toString(),
        planId: planId.toString()
      }
    });

    // Get client secret - if missing, create payment intent manually
    let clientSecret = stripeSubscription.latest_invoice?.payment_intent?.client_secret;

    if (!clientSecret && plan.price > 0) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(plan.price * 100),
        currency: plan.currency || 'usd',
        customer: customer.id,
        metadata: {
          subscriptionId: stripeSubscription.id,
          userId: userId.toString()
        }
      });
      clientSecret = paymentIntent.client_secret;
    }

    const requiresPayment = plan.price > 0;

    // Create local subscription
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + plan.durationInDays);

    const subscription = new Subscription({
      userId,
      subscriptionPlanId: planId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: customer.id,
      applicationId,
      paymentStatus: requiresPayment ? 'PENDING' : 'COMPLETED',
      payerEmail: req.user.email,
      startDate,
      endDate,
      status: requiresPayment ? 'pending' : 'active'
    });

    await subscription.save();

    if (!requiresPayment) {
      triggerTierWelcomeNotifications(subscription);
    }

    return res.status(201).json({
      success: true,
      message: clientSecret ? 'Subscription created, payment required' : 'Subscription activated',
      data: {
        subscriptionId: subscription._id,
        stripeSubscriptionId: stripeSubscription.id,
        clientSecret,
        amount: plan.price * 100,
        currency: plan.currency
      }
    });

  } catch (error) {
    console.error('Subscription creation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create subscription',
      error: error.message
    });
  }
};


// Get user's subscriptions and populate subscription plan
exports.getUserSubscriptions = async (req, res) => {
    try {
        const subscriptions = await Subscription.find({
            userId: req.user._id,
            businessId: null
        })
            .populate('subscriptionPlanId')
            .exec();

        if (!subscriptions || subscriptions.length === 0) {
            return res.status(404).json({ 
                success: false,
                message: 'No subscriptions found for the user.' 
            });
        }

        res.status(200).json({ 
            success: true,
            data: subscriptions 
        });
    } catch (error) {
        console.error('Error fetching subscriptions:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error fetching subscriptions, please try again later.' 
        });
    }
};
