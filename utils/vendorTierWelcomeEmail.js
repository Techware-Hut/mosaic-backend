/**
 * utils/vendorTierWelcomeEmail.js
 *
 * Tier-specific onboarding welcome emails sent to vendors upon
 * completing tier plan selection and payment.
 */

'use strict';

const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('./frontendUrl');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');
const { baseLayout, esc, SUPPORT_EMAIL } = require('./emailTemplates/baseLayout');
const { deliverVendorOnboardingEmail } = require('./vendorOnboardingEmailDelivery');

const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

/**
 * Resolve tier details, exact copy, subject, and features based on plan name.
 *
 * @param {string} planName
 * @param {string} vendorName
 */
function resolveTierDetails(planName = '', vendorName = 'there') {
  const n = String(planName || '').toLowerCase();

  if (n.includes('legacy') || n.includes('platinum') || n.includes('premium')) {
    return {
      tier: 'legacy',
      tierLabel: 'Legacy Plan (Platinum)',
      badgeColor: '#1E3A8A',
      subject: 'Welcome to Mosaic Biz Hub Platinum — Your Legacy Starts Here',
      preheader: 'Welcome to the Legacy Plan — our most powerful plan designed for brands ready to dominate their niche.',
      headline: 'Your Legacy Starts Here',
      intro: `Welcome to the Legacy Plan — our most powerful plan designed for brands ready to dominate their niche, automate growth, and maximize customer reach.`,
      featuresHeading: 'Your Legacy Plan features include:',
      features: [
        'Premium profile (up to 1,000 characters)',
        '20 products or 10 services listed',
        '7 images per product',
        'Video uploads + PDF uploads',
        'Up to 5 testimonial videos',
        'Full CRM with messaging + automated reminders',
        'AI chatbot integration',
        'Personalized onboarding (live + video)',
        'Full analytics suite (16 metrics + conversion tracking)',
        'Top-tier search placement',
        'Early access to new features',
        'Advanced retargeting (5 audiences)',
        'Unlimited workflows + omni-channel automation',
        'Affiliate network inclusion',
        'Loyalty program integration',
      ],
      nextSteps: [
        'You’ve unlocked the highest level of visibility, automation, and customer engagement. Your next step: schedule your personalized onboarding session and begin setting up your CRM + automation tools.',
        'We’re thrilled to partner with you as you scale, lead, and build legacy.',
      ],
    };
  }

  if (n.includes('growth') || n.includes('gold') || n.includes('standard')) {
    return {
      tier: 'growth',
      tierLabel: 'Growth Plan (Gold)',
      badgeColor: '#D4AF37',
      subject: 'Welcome to Mosaic Biz Hub Gold — Let’s Scale Your Visibility',
      preheader: 'Congratulations on choosing the Growth Plan — the perfect plan for vendors ready to expand their reach.',
      headline: 'Let’s Scale Your Visibility',
      intro: `Congratulations on choosing the Growth Plan — the perfect plan for vendors ready to expand their reach, increase engagement, and turn visibility into revenue.`,
      featuresHeading: 'Your Gold features include:',
      features: [
        'Enhanced profile (up to 600 characters)',
        '10 products or 5 services listed',
        '5 images per product',
        'Up to 3 promotions (sales, bundles, events)',
        'Product catalog upload (CSV)',
        'In-platform messaging (web + app)',
        'Push notifications to followers',
        'Video onboarding training',
        'Limited analytics dashboard (10 key metrics)',
        'Up to 10 automated actions per form',
        'Remove Mosaic Biz Hub branding on forms',
        'Standard ad management tools',
        'Basic retargeting (2 audiences)',
      ],
      nextSteps: [
        'You’re equipped with the tools to grow your audience and deepen customer engagement. Log in today to activate your promotions and upload your catalog.',
        'We’re honored to support your journey. Let’s scale your brand together.',
      ],
    };
  }

  // Default: Launch Plan
  return {
    tier: 'launch',
    tierLabel: 'Launch Plan',
    badgeColor: '#1E3A8A',
    subject: 'Welcome to Mosaic Biz Hub — Your Growth Starts Now',
    preheader: 'Welcome to Mosaic Biz Hub! You’ve selected the Launch Plan, perfect for building a strong foundation.',
    headline: 'Your Growth Starts Now',
    intro: `Welcome to Mosaic Biz Hub! We’re excited to have you join our community of bold, resilient entrepreneurs. You’ve selected the Launch Plan, perfect for building a strong foundation and establishing your presence in the marketplace.`,
    featuresHeading: 'Here’s what your plan includes:',
    features: [
      'Vendor profile with up to 300 characters',
      '5 products or 3 services listed',
      '3 images per product',
      'Verified customer reviews',
      'Standard listing placement',
      'Generic business contact form',
      '1 automated email per form',
      'Basic analytics snapshot (traffic + views)',
      'Trust Badge included',
    ],
    nextSteps: [
      'You’re officially ready to showcase your business and start attracting customers. Your next step is simple: Log in, complete your profile, and upload your first products or services.',
      'If you need support, our team is here to help you every step of the way.',
      'Let’s build something powerful together. Mosaic Biz Hub — Your Business. Your Stage. Your Growth.',
    ],
  };
}

/**
 * Generate branded HTML body content for the tier welcome email.
 */
function buildTierEmailBodyHtml({ tierDetails, vendorName, partnersUrl }) {
  const safeVendorName = esc(vendorName);

  const featuresListHtml = tierDetails.features
    .map(
      (feat) => `
        <li style="margin:0 0 8px 0;line-height:1.5;">
          <span style="color:#10B981;font-weight:700;margin-right:8px;">✓</span>
          <span style="color:#374151;">${esc(feat)}</span>
        </li>`
    )
    .join('');

  const nextStepsHtml = tierDetails.nextSteps
    .map(
      (step) => `
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
          ${esc(step)}
        </p>`
    )
    .join('');

  return `
    <div style="margin-bottom:20px;">
      <span style="display:inline-block;background-color:#EFF6FF;color:${tierDetails.badgeColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:4px 12px;border-radius:9999px;">
        ${esc(tierDetails.tierLabel)}
      </span>
    </div>

    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.3;">
      ${esc(tierDetails.headline)}
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Hi ${safeVendorName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      ${esc(tierDetails.intro)}
    </p>

    <!-- Plan Features Box -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid ${tierDetails.badgeColor};border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#1E293B;margin:0 0 14px;">
            ${esc(tierDetails.featuresHeading)}
          </p>
          <ul style="list-style:none;padding:0;margin:0;font-family:Arial,sans-serif;font-size:14px;">
            ${featuresListHtml}
          </ul>
        </td>
      </tr>
    </table>

    ${nextStepsHtml}

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${partnersUrl}"
            style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.01em;line-height:1;">
            Open Partners Dashboard
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Questions or need support? Contact us anytime at <a href="mailto:${SUPPORT_EMAIL}" style="color:#2563EB;text-decoration:underline;">${SUPPORT_EMAIL}</a>.<br/>
      <strong>The Mosaic Biz Hub Team</strong>
    </p>
  `;
}

/**
 * Generate plain text version of the tier welcome email.
 */
function buildTierEmailText({ tierDetails, vendorName, partnersUrl }) {
  const lines = [
    tierDetails.headline,
    '',
    `Hi ${vendorName},`,
    '',
    tierDetails.intro,
    '',
    tierDetails.featuresHeading,
    ...tierDetails.features.map((f) => `• ${f}`),
    '',
    ...tierDetails.nextSteps,
    '',
    `Open Partners Dashboard: ${partnersUrl}`,
    '',
    `Need help? Contact ${SUPPORT_EMAIL}`,
    '',
    '— The Mosaic Biz Hub Team',
  ];

  return lines.join('\n');
}

/**
 * Send vendor tier welcome email.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email address
 * @param {string} [params.vendorName] - Vendor display name
 * @param {string} [params.planName] - Subscription plan name (Launch, Growth, Legacy)
 * @returns {Promise<{ sent: boolean, skipped?: boolean, error?: string }>}
 */
async function sendVendorTierWelcomeEmail({ to, vendorName = 'there', planName = 'Launch Plan' }) {
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    console.warn(`[Tier Welcome Email] Skipped: invalid recipient "${to}"`);
    return { sent: false, skipped: true, reason: 'invalid_recipient' };
  }

  const tierDetails = resolveTierDetails(planName, vendorName);
  const partnersUrl = buildFrontendUrl('/partners');

  const bodyHtml = buildTierEmailBodyHtml({
    tierDetails,
    vendorName,
    partnersUrl,
  });

  const html = baseLayout({
    preheader: tierDetails.preheader,
    bodyHtml,
    footerReason: 'You are receiving this email because you subscribed to a plan on Mosaic Biz Hub.',
  });

  const text = buildTierEmailText({
    tierDetails,
    vendorName,
    partnersUrl,
  });

  return deliverVendorOnboardingEmail({
    label: `vendor_tier_welcome_${tierDetails.tier}`,
    send: async () => {
      return transporter.sendMail({
        from: formatMosaicFromHeader(),
        to: to.trim(),
        subject: tierDetails.subject,
        text,
        html,
      });
    },
  });
}

/**
 * Trigger tier welcome email and Telnyx SMS idempotently for an active subscription.
 *
 * @param {object} subscription - Mongoose Subscription document or plain object
 */
async function triggerTierWelcomeNotifications(subscription) {
  if (!subscription || !subscription.userId) {
    return;
  }

  try {
    const Subscription = require('../models/Subscription');
    const User = require('../models/User');
    const SubscriptionPlan = require('../models/SubscriptionPlan');
    const { sendVendorTierWelcomeSMS } = require('./telnyxService');

    // Atomic check-and-set to guarantee idempotency across concurrent webhooks/callbacks
    const claim = await Subscription.findOneAndUpdate(
      {
        _id: subscription._id,
        welcomeEmailSent: { $ne: true },
      },
      {
        $set: { welcomeEmailSent: true },
      },
      { new: true }
    );

    if (!claim) {
      console.log(`[Tier Welcome] Notifications already sent for subscription ${subscription._id}, skipping.`);
      return;
    }

    const [user, plan] = await Promise.all([
      User.findById(subscription.userId).select('email mobile name').lean(),
      subscription.subscriptionPlanId
        ? SubscriptionPlan.findById(subscription.subscriptionPlanId).select('name').lean()
        : null,
    ]);

    const planName = plan?.name || 'Launch Plan';
    const vendorName = user?.name || 'Vendor';

    // 1. Send Tier Welcome Email
    if (user?.email) {
      sendVendorTierWelcomeEmail({
        to: user.email,
        vendorName,
        planName,
      })
        .then((res) => {
          if (res.sent) {
            console.log(`[Tier Welcome Email] Successfully sent to ${user.email} (${planName})`);
          } else if (res.skipped) {
            console.log(`[Tier Welcome Email] Delivery skipped (${res.reason}) for ${user.email}`);
          }
        })
        .catch((err) => {
          console.error('[Tier Welcome Email] Error sending email:', err.message);
        });
    }

    // 2. Send Tier Welcome SMS
    if (user?.mobile) {
      const planNameLower = planName.toLowerCase();
      const tier = planNameLower.includes('growth')
        ? 'growth'
        : (planNameLower.includes('legacy') || planNameLower.includes('platinum') || planNameLower.includes('premium'))
        ? 'premium'
        : 'launch';

      sendVendorTierWelcomeSMS({
        to: user.mobile,
        vendorName: vendorName ? vendorName.split(' ')[0] : undefined,
        tier,
      }).catch((smsErr) => {
        console.error('[Telnyx SMS] Tier welcome SMS failed:', smsErr.message);
      });
    }
  } catch (err) {
    console.error('[Tier Welcome] Notification trigger failed:', err.message);
  }
}

module.exports = {
  resolveTierDetails,
  sendVendorTierWelcomeEmail,
  triggerTierWelcomeNotifications,
};
