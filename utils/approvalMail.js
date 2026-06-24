// mailer/businessStatusEmails.js
const nodemailer = require("nodemailer");
const { getFrontendBaseUrl } = require("./frontendUrl");

const APP_URL = getFrontendBaseUrl();
const SUPPORT_EMAIL ="support@mosaicbizhub.com";

// If you already have a transporter elsewhere, delete this block and import that one.
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
});

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

const escapeHtml = (s = "") =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function baseLayout({ preheader, heading, introHtml, bodyHtml, ctaHref, ctaText }) {
  return `
  <div style="margin:0;padding:0;background:#f6f8fa;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
      ${escapeHtml(preheader || "")}
    </span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:24px 24px 8px;">
                <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;margin:12px 0 0;color:#111827;">${heading}</h1>
                ${introHtml || ""}
                ${
                  ctaHref
                    ? `<div style="height:8px;"></div>
                       <a href="${ctaHref}"
                          style="display:inline-block;background:#0d6efd;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;padding:10px 16px;border-radius:8px;">
                          ${escapeHtml(ctaText || "Open Dashboard")}
                        </a>`
                    : ""
                }
              </td>
            </tr>
            ${
              bodyHtml
                ? `<tr>
                     <td style="padding:16px 24px 8px;">${bodyHtml}</td>
                   </tr>`
                : ""
            }
            <tr>
              <td align="center" style="padding:16px;background:#f9fafb;">
                <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;margin:0;">
                  &copy; ${new Date().getFullYear()} Mosaic Biz Hub. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

/** APPROVED (neutral: works for first-time or re-approval) */
async function sendApproved({ to, vendorName = "there", business }) {
  const partnersUrl = `${APP_URL}/partners/${encodeURIComponent(business.slug)}`;
  const typeTitle = titleForType(business.type);

  const introHtml = `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#6b7280;margin:8px 0 0;">
      Hi ${escapeHtml(vendorName)},<br/>
      <strong>${escapeHtml(business.name)}</strong> is approved and live on Mosaic Biz Hub for <strong>${escapeHtml(typeTitle)}</strong>.
    </p>`;

  const bodyHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
      <tr>
        <td style="padding:16px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#111827;margin:0 0 6px;"><strong>Next steps</strong></p>
          <ul style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#374151;margin:0;padding-left:18px;">
            <li>Review your profile details and images</li>
            <li>${escapeHtml(typeTitle)}: add/update your items with clear pricing</li>
            <li>Share your page to start getting customers</li>
          </ul>
          <div style="height:12px;"></div>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;margin:0;">
            Need help? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#0d6efd;text-decoration:none;">${SUPPORT_EMAIL}</a>.
          </p>
        </td>
      </tr>
    </table>`;

  const html = baseLayout({
    preheader: "Your business is approved and live on Mosaic Biz Hub.",
    heading: "🎉 Your business is approved!",
    introHtml,
    bodyHtml,
    ctaHref: partnersUrl,
    ctaText: "Open Partners Dashboard",
  });

  const text = [
    `Hi ${vendorName},`,
    ``,
    `${business.name} is approved and live on Mosaic Biz Hub (${typeTitle}).`,
    `Open your dashboard: ${partnersUrl}`,
    ``,
    `Need help? ${SUPPORT_EMAIL}`,
    ``,
    `— Mosaic Biz Hub Team`,
  ].join("\n");

  await transporter.sendMail({
    from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
    to, // string or string[]
    subject: `✅ ${business.name} is approved on Mosaic Biz Hub`,
    text,
    html,
    headers: {
      "X-Entity-Ref-ID": `biz-approved-${Date.now()}`,
      "List-Unsubscribe": `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    },
  });
}

/** BLOCKED (temporarily hidden) */
async function sendBlocked({ to, vendorName = "there", business, adminNote }) {
  const introHtml = `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#6b7280;margin:8px 0 0;">
      Hi ${escapeHtml(vendorName)},<br/>
      We’ve temporarily <strong>blocked</strong> <strong>${escapeHtml(business.name)}</strong> on Mosaic Biz Hub.
    </p>`;

  const reasonHtml = adminNote
    ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#374151;margin:8px 0 0;">
         <strong>Reason:</strong> ${escapeHtml(adminNote)}
       </p>`
    : "";

  const bodyHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;">
      <tr>
        <td style="padding:16px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#9a3412;margin:0 0 6px;"><strong>What this means</strong></p>
          <ul style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#7c2d12;margin:0;padding-left:18px;">
            <li>Your public listing is hidden while we review.</li>
            <li>You can reply to this email with clarifications or updates.</li>
            <li>We’ll notify you as soon as anything changes.</li>
          </ul>
          ${reasonHtml}
          <div style="height:12px;"></div>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;margin:0;">
            Questions? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#0d6efd;text-decoration:none;">${SUPPORT_EMAIL}</a>.
          </p>
        </td>
      </tr>
    </table>`;

  const html = baseLayout({
    preheader: "Your listing is temporarily blocked.",
    heading: "Your listing is temporarily blocked",
    introHtml,
    bodyHtml,
    ctaHref: null,
  });

  const text = [
    `Hi ${vendorName},`,
    ``,
    `${business.name} has been temporarily blocked on Mosaic Biz Hub.`,
    adminNote ? `Reason: ${adminNote}\n` : "",
    `Reply to this email with any questions.`,
    ``,
    `— Mosaic Biz Hub Team`,
  ].join("\n");

  await transporter.sendMail({
    from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
    to, // string or string[]
    subject: `⛔ ${business.name} has been temporarily blocked`,
    text,
    html,
    headers: {
      "X-Entity-Ref-ID": `biz-blocked-${Date.now()}`,
      "List-Unsubscribe": `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    },
  });
}

/** DEACTIVATED (admin-managed) */
async function sendDeactivated({ to, vendorName = "there", business, adminNote }) {
  const introHtml = `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#6b7280;margin:8px 0 0;">
      Hi ${escapeHtml(vendorName)},<br/>
      Your business <strong>${escapeHtml(business.name)}</strong> has been deactivated on Mosaic Biz Hub.
    </p>`;

  const reasonHtml = adminNote
    ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#374151;margin:8px 0 0;">
         <strong>Admin remark:</strong> ${escapeHtml(adminNote)}
       </p>`
    : "";

  const bodyHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;">
      <tr>
        <td style="padding:16px;">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#9a3412;margin:0 0 6px;"><strong>What this means</strong></p>
          <ul style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#7c2d12;margin:0;padding-left:18px;">
            <li>Your public listing is hidden for now.</li>
            <li>You can reply to this email if you need clarification.</li>
            <li>Your business can be reactivated after review.</li>
          </ul>
          ${reasonHtml}
          <div style="height:12px;"></div>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;margin:0;">
            Questions? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#0d6efd;text-decoration:none;">${SUPPORT_EMAIL}</a>.
          </p>
        </td>
      </tr>
    </table>`;

  const html = baseLayout({
    preheader: "Your business has been deactivated.",
    heading: "Your business has been deactivated",
    introHtml,
    bodyHtml,
    ctaHref: null,
  });

  const text = [
    `Hi ${vendorName},`,
    ``,
    `${business.name} has been deactivated on Mosaic Biz Hub.`,
    adminNote ? `Admin remark: ${adminNote}\n` : "",
    `Please reply to this email if you need any clarification.`,
    ``,
    `- Mosaic Biz Hub Team`,
  ].join("\n");

  await transporter.sendMail({
    from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
    to,
    subject: `${business.name} has been deactivated on Mosaic Biz Hub`,
    text,
    html,
    headers: {
      "X-Entity-Ref-ID": `biz-deactivated-${Date.now()}`,
      "List-Unsubscribe": `<mailto:${SUPPORT_EMAIL}?subject=unsubscribe>`,
    },
  });
}

/** Public API */
exports.sendBusinessStatusEmail = async ({ to, vendorName, business, action, adminNote }) => {
  if (action === "approved") return sendApproved({ to, vendorName, business });
  if (action === "blocked") return sendBlocked({ to, vendorName, business, adminNote });
  if (action === "deactivated") return sendDeactivated({ to, vendorName, business, adminNote });
  throw new Error(`Unknown action: ${action}`);
};
