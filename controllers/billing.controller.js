const Stripe = require('stripe');
const Business = require('../models/Business'); // adjust path if needed
const { buildFrontendUrl, normalizeFrontendUrl } = require('../utils/frontendUrl');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

/**
 * POST /api/billing-portal/session
 * body: { businessId: string, return_url?: string }
 */
exports.createBillingPortalSessionForBusiness = async (req, res) => {
  try {
    const { businessId, return_url } = req.body;
    if (!businessId) return res.status(400).json({ error: 'businessId is required' });

    const biz = await Business.findById(businessId);
    if (!biz) return res.status(404).json({ error: 'Business not found' });
    if (!biz.stripeCustomerId) return res.status(400).json({ error: 'Business missing stripeCustomerId' });

    const session = await stripe.billingPortal.sessions.create({
      customer: biz.stripeCustomerId,
      return_url: normalizeFrontendUrl(
        return_url ||
          process.env.BILLING_PORTAL_RETURN_URL ||
          buildFrontendUrl(`/partner/${businessId}/my-account`)
      ),

    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('createBillingPortalSessionForBusiness error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
};
