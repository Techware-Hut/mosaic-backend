// controllers/connectController.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const Business = require('../models/Business');
const { getReturnAndRefreshUrls } = require('../lib/connect/connectUrls');
const { buildFrontendUrl } = require('../utils/frontendUrl');

function normalizeCapabilityStatus(status) {
  return typeof status === 'string' ? status.toLowerCase() : 'inactive';
}

function getTransferCapabilityStatus(account) {
  const capabilities = account?.capabilities || {};
  return (
    normalizeCapabilityStatus(capabilities.transfers) ||
    normalizeCapabilityStatus(capabilities?.stripe_balance?.stripe_transfers) ||
    'inactive'
  );
}

/**
 * POST /api/connect/:businessId/account-link
 * Create/reuse a Connect Express account and return an onboarding link URL.
 */
exports.createAccountLink = async (req, res) => {
  try {
    const { businessId } = req.params;
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ success: false, message: 'Business not found' });

    // Security: only owner can initiate onboarding
    if (business.owner.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    // Create or reuse Connect account
    let accountId = business.stripeConnectAccountId;
    if (!accountId) {
      const country = ('US').toUpperCase();
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email: business.email,
        business_type: 'company',
        metadata: {
          businessId: business._id.toString(),
          ownerId: business.owner.toString(),
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      business.stripeConnectAccountId = accountId;
      business.onboardingStatus = 'in_progress';
      await business.save();
    }

    // Create Account Link
    const { returnUrl, refreshUrl } = getReturnAndRefreshUrls(businessId);

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return res.status(200).json({ success: true, url: accountLink.url });
  } catch (err) {
    console.error('Connect account-link error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create account link' });
  }
};

/**
 * GET /api/connect/:businessId/status
 * Refresh and persist onboarding flags on the Business.
 */
exports.getStatus = async (req, res) => {
  try {
    const { businessId } = req.params;
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ success: false, message: 'Business not found' });

    if (!business.stripeConnectAccountId) {
      return res.status(200).json({
        success: true,
        connected: false,
        onboardingStatus: 'not_started',
      });
    }

    const account = await stripe.accounts.retrieve(business.stripeConnectAccountId);

    const transferCapability = getTransferCapabilityStatus(account);
    business.chargesEnabled = !!account.charges_enabled;
    business.payoutsEnabled = !!account.payouts_enabled;
    business.capabilities = {
      card_payments: normalizeCapabilityStatus(account?.capabilities?.card_payments),
      transfers: transferCapability,
    };

    const completed =
      account.charges_enabled &&
      account.payouts_enabled &&
      transferCapability === 'active';
    business.onboardingStatus = completed ? 'completed' : 'requirements_due';
    if (completed && !business.onboardedAt) business.onboardedAt = new Date();

    await business.save();

    return res.status(200).json({
      success: true,
      connected: completed,
      onboardingStatus: business.onboardingStatus,
      chargesEnabled: business.chargesEnabled,
      payoutsEnabled: business.payoutsEnabled,
      capabilities: business.capabilities,
    });
  } catch (err) {
    console.error('Connect status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch Connect status' });
  }
};

/**
 * (Optional) GET /api/connect/return and /api/connect/refresh
 * If you prefer Stripe to hit your backend first and then redirect to frontend.
 * Typically you can point Stripe directly to the frontend instead and skip these.
 */
exports.handleReturn = async (req, res) => {
  try {
    // send the user to the vendor dashboard connect return page
    return res.redirect(
      buildFrontendUrl(
        `/partners/connect/return${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
      )
    );
  } catch {
    return res.redirect(buildFrontendUrl('/'));
  }
};

exports.handleRefresh = async (req, res) => {
  try {
    return res.redirect(
      buildFrontendUrl(
        `/partners/connect/refresh${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
      )
    );
  } catch {
    return res.redirect(buildFrontendUrl('/'));
  }
};
