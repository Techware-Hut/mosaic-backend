const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
});
const { assertConnectAccountOwnedByUser } = require('../utils/stripeConnectOwnership');
const { sanitizeFrontendRedirectUrl } = require('../utils/frontendUrl');

/**
 * Create a Stripe Account Session for embedded Connect components
 */
exports.createAccountSession = async (req, res) => {
    try {
        const { account, components } = req.body;

        const ownership = await assertConnectAccountOwnedByUser(account, req.user.id);
        if (!ownership.ok) {
            return res.status(ownership.status).json({ error: ownership.message });
        }

        const enablePayments = Array.isArray(components) && components.includes('payments');
        const enablePayouts = Array.isArray(components) && components.includes('payouts');

        const session = await stripe.accountSessions.create({
            account,
            components: {
                ...(enablePayments && {
                    payments: {
                        enabled: true,
                        features: {
                            refund_management: true,
                            dispute_management: true,
                            capture_payments: true,
                        },
                    },
                }),
                ...(enablePayouts && {
                    payouts: {
                        enabled: true,
                        // add features here if you want instant payouts, etc.
                    },
                }),
            },
        });

        return res.status(200).json({ client_secret: session.client_secret });
    } catch (err) {
        console.error('Stripe AccountSession error:', err);
        return res.status(500).json({ error: err.message || 'Stripe error' });
    }
};


exports.createExpressLoginLink = async (req, res) => {
    try {
        const { account, redirect_url } = req.body;

        const ownership = await assertConnectAccountOwnedByUser(account, req.user.id);
        if (!ownership.ok) {
            return res.status(ownership.status).json({ error: ownership.message });
        }

        const businessRouteId =
            ownership.business?.slug ||
            ownership.business?._id?.toString?.() ||
            ownership.business?._id;
        const fallbackPath = businessRouteId
            ? `/partners/${businessRouteId}/finance`
            : '/partners/dashboard';

        const link = await stripe.accounts.createLoginLink(account, {
            redirect_url: sanitizeFrontendRedirectUrl(
                redirect_url || fallbackPath,
                process.env,
                fallbackPath
            ),
        });

        return res.status(200).json({ url: link.url });
    } catch (err) {
        console.error('Stripe createLoginLink error:', err);
        return res.status(500).json({ error: err.message || 'Stripe error' });
    }
};



exports.getAccountBalance = async (req, res) => {
    try {
        const { account } = req.query;

        const ownership = await assertConnectAccountOwnedByUser(account, req.user.id);
        if (!ownership.ok) {
            return res.status(ownership.status).json({ error: ownership.message });
        }
        const balance = await stripe.balance.retrieve({ stripeAccount: account });

        // choose a single currency (Stripe returns arrays per currency)
        const firstAvail = balance.available?.[0] || null;
        const firstPend = balance.pending?.[0] || null;

        return res.status(200).json({
            available: firstAvail ? { amount: firstAvail.amount, currency: firstAvail.currency } : null,
            pending: firstPend ? { amount: firstPend.amount, currency: firstPend.currency } : null,
        });
    } catch (err) {
        console.error('getAccountBalance error:', err);
        return res.status(500).json({ error: err.message || 'Stripe error' });
    }
};

exports.getLastPayout = async (req, res) => {
    try {
        const { account } = req.query;

        const ownership = await assertConnectAccountOwnedByUser(account, req.user.id);
        if (!ownership.ok) {
            return res.status(ownership.status).json({ error: ownership.message });
        }

        // Latest payout (could be pending or paid); adjust as you like
        const payouts = await stripe.payouts.list(
            { limit: 1 },
            { stripeAccount: account }
        );

        const payout = payouts.data?.[0] || null;
        if (!payout) return res.status(200).json({ payout: null });

        return res.status(200).json({
            payout: {
                id: payout.id,
                amount: payout.amount,
                currency: payout.currency,
                status: payout.status,
                arrival_date: payout.arrival_date, // unix (seconds)
            }
        });
    } catch (err) {
        console.error('getLastPayout error:', err);
        return res.status(500).json({ error: err.message || 'Stripe error' });
    }
};


const Business = require('../models/Business');

// helper: try to get customer from subscription id
async function customerFromSubscriptionId(subId) {
  if (!subId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    return sub?.customer ? String(sub.customer) : null;
  } catch {
    return null;
  }
}

// helper: try to find an existing customer by email (and optional metadata)
async function findCustomerByEmail(email, biz) {
  if (!email) return null;
  try {
    if (stripe.customers.search) {
      const query = [
        `email:"${email}"`,
        biz?._id ? `metadata["businessId"]:"${String(biz._id)}"` : null,
      ].filter(Boolean).join(' AND ');
      const res = await stripe.customers.search({ query, limit: 1 });
      if (res?.data?.[0]?.id) return res.data[0].id;
    }
    const list = await stripe.customers.list({ email, limit: 3 });
    return list?.data?.[0]?.id || null;
  } catch {
    return null;
  }
}

// helper: create a fresh customer
async function createCustomerForBusiness(biz) {
  const payload = {
    email: biz.email || undefined,
    name: biz.businessName || undefined,
    metadata: {
      businessId: String(biz._id || ''),
      businessSlug: biz.slug || '',
    },
    address: biz.address ? {
      line1: biz.address.street || undefined,
      city: biz.address.city || undefined,
      state: biz.address.state || undefined,
      postal_code: biz.address.zipCode || undefined,
      country: biz.address.country || undefined,
    } : undefined,
  };
  const c = await stripe.customers.create(payload);
  return c.id;
}

/**
 * POST /stripe/backfill-customers
 * body: { limit?: number }
 * Finds businesses missing stripeCustomerId and fills it by:
 * 1) reading customer from their stripeSubscriptionId
 * 2) searching customers by email/metadata
 * 3) creating a new customer
 */
exports.backfillMissingStripeCustomers = async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit || 100), 500);

    // find targets missing customer id
    const targets = await Business.find({
      $or: [{ stripeCustomerId: { $exists: false } }, { stripeCustomerId: null }, { stripeCustomerId: '' }]
    }).limit(limit);

    const results = [];

    for (const biz of targets) {
      try {
        // 1) via subscription
        let customerId = await customerFromSubscriptionId(biz.stripeSubscriptionId);

        // 2) via email search
        if (!customerId) {
          customerId = await findCustomerByEmail(biz.email, biz);
        }

        // 3) create if still missing
        if (!customerId) {
          customerId = await createCustomerForBusiness(biz);
        }

        biz.stripeCustomerId = customerId;
        await biz.save();

        results.push({ businessId: String(biz._id), stripeCustomerId: customerId, ok: true });
      } catch (e) {
        results.push({ businessId: String(biz._id), ok: false, error: e.message });
      }
    }

    return res.status(200).json({ count: results.length, results });
  } catch (err) {
    console.error('backfillMissingStripeCustomers error:', err);
    return res.status(500).json({ error: err.message || 'Stripe error' });
  }
};
