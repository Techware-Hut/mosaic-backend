// mailer/businessStatusEmails.js
const nodemailer = require("nodemailer");
const { buildFrontendUrl } = require("./frontendUrl");
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require("./smtpTransport");
const { baseLayout, esc, SUPPORT_EMAIL } = require("./emailTemplates/baseLayout");

const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

const TYPE_TITLES = {
  service: "Services",
  product: "Products",
  food: "Food & Restaurants",
};

function titleForType(t) {
  const key = String(t || "").toLowerCase();
  if (key.startsWith("serv")) return TYPE_TITLES.service;
  if (key.startsWith("prod")) return TYPE_TITLES.product;
  if (key.startsWith("food")) return TYPE_TITLES.food;
  return "Business";
}

/** APPROVED (neutral: works for first-time or re-approval) */
async function sendApproved({ to, vendorName = "there", business }) {
  const safeVendorName = esc(vendorName);
  const safeBizName = esc(business?.name || "Your Business");
  const typeTitle = titleForType(business?.type);
  const partnersUrl = business?.slug
    ? buildFrontendUrl(`/partners/${encodeURIComponent(business.slug)}`)
    : buildFrontendUrl('/partners/dashboard');
  const ctaText = "Open Partners Dashboard";
  const preheader = `🎉 Your business ${safeBizName} is approved and live on Mosaic Biz Hub!`;
  const footerReason = "You are receiving this email because your business was approved on Mosaic Biz Hub.";

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      &#127881; Your Business is Approved!
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeVendorName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Great news! <strong>${safeBizName}</strong> has been approved and is now officially live on Mosaic Biz Hub for <strong>${esc(typeTitle)}</strong>.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F0FDF4;border-left:4px solid #22C55E;border-radius:0 8px 8px 0;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#15803D;margin:0 0 10px;">Recommended next steps:</p>
          <ul style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding-left:18px;line-height:1.8;">
            <li>Review your profile details, cover banner, and logo.</li>
            <li>Add or update your items and services with clear pricing.</li>
            <li>Share your public storefront to start getting customers.</li>
          </ul>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${partnersUrl}"
            style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.01em;line-height:1;">
            ${esc(ctaText)}
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.<br/>
      <strong>The Mosaic Biz Hub Team</strong>
    </p>
  `;

  const text = [
    'Your Business is Approved!',
    '',
    `Hi ${vendorName},`,
    '',
    `Great news! ${business?.name || 'Your Business'} is approved and live on Mosaic Biz Hub (${typeTitle}).`,
    '',
    'Next steps:',
    '• Review your profile details and images',
    `• ${typeTitle}: add/update your items with clear pricing`,
    '• Share your page to start getting customers',
    '',
    `Open Partners Dashboard: ${partnersUrl}`,
    '',
    `Need help? Contact ${SUPPORT_EMAIL}`,
    '',
    '— The Mosaic Biz Hub Team',
  ].join("\n");

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: `✅ ${business.name} is approved on Mosaic Biz Hub`,
    text,
    html: baseLayout({ preheader, bodyHtml, footerReason }),
    headers: {
      "X-Entity-Ref-ID": `biz-approved-${Date.now()}`,
      "List-Unsubscribe": `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    },
  });
}

/** BLOCKED or DEACTIVATED (admin action) */
async function sendBlockedOrDeactivated({ to, vendorName = "there", business, adminNote, isBlocked = false }) {
  const safeVendorName = esc(vendorName);
  const safeBizName = esc(business?.name || "Your Business");
  const ctaUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Appeal Account Status - ${business?.name || ''}`)}`;
  const ctaText = 'Contact Support';
  const preheader = `Important: Your vendor account for ${safeBizName} has been ${isBlocked ? 'blocked' : 'deactivated'}.`;
  const footerReason = "You are receiving this email regarding your vendor account status on Mosaic Biz Hub.";

  const reasonHtml = adminNote
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#FFF7ED;border-left:4px solid #F97316;border-radius:0 8px 8px 0;padding:16px 20px;">
          <p style="font-family:Arial,sans-serif;font-size:14px;color:#9A3412;margin:0;line-height:1.6;">
            <strong>Note from Admin:</strong> ${esc(adminNote)}
          </p>
        </td>
      </tr>
    </table>`
    : "";

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Important: Your Vendor Account Status
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeVendorName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      After reviewing, your vendor account for <strong>${safeBizName}</strong> has been ${isBlocked ? 'blocked' : 'deactivated'}. This may be due to missing information or a compliance issue.
    </p>

    ${reasonHtml}

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 28px;line-height:1.6;">
      If you believe this was an error or would like to appeal, please reply to this email.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${ctaUrl}"
            style="display:inline-block;background:linear-gradient(135deg,#DC2626 0%,#B91C1C 100%);color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.01em;line-height:1;">
            ${esc(ctaText)}
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.<br/>
      <strong>The Mosaic Biz Hub Team</strong>
    </p>
  `;

  const text = [
    'Important: Your Vendor Account Status',
    '',
    `Hi ${vendorName},`,
    '',
    `After reviewing, your vendor account for ${business?.name || 'your business'} has been ${isBlocked ? 'blocked' : 'deactivated'}. This may be due to missing information or a compliance issue.`,
    adminNote ? `\nNote from Admin: ${adminNote}\n` : '',
    'If you believe this was an error or would like to appeal, please reply to this email.',
    '',
    `Contact Support: ${SUPPORT_EMAIL}`,
    '',
    'Thank you for being part of the Mosaic Biz Hub community.',
    '— The Mosaic Biz Hub Team',
  ].filter(Boolean).join('\n');

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: `Important: Your Vendor Account Status – ${business?.name || 'Mosaic Biz Hub'}`,
    text,
    html: baseLayout({ preheader, bodyHtml, footerReason }),
    headers: {
      "X-Entity-Ref-ID": `biz-${isBlocked ? 'blocked' : 'deactivated'}-${Date.now()}`,
      "List-Unsubscribe": `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    },
  });
}

/** Public API */
exports.sendBusinessStatusEmail = async ({ to, vendorName, business, action, adminNote }) => {
  if (action === "approved") return sendApproved({ to, vendorName, business });
  if (action === "blocked") return sendBlockedOrDeactivated({ to, vendorName, business, adminNote, isBlocked: true });
  if (action === "deactivated") return sendBlockedOrDeactivated({ to, vendorName, business, adminNote, isBlocked: false });
  throw new Error(`Unknown action: ${action}`);
};
