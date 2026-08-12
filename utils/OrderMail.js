// mailer/orderPaid.js
const nodemailer = require("nodemailer");
const { buildFrontendUrl } = require("./frontendUrl");
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require("./smtpTransport");
const { renderInvoicePdfBufferForOrder } = require("../services/invoiceService");
const {
  resolvePlatformLogoAttachment,
  withOptionalLogoAttachment,
} = require("./emailLogoAttachment");

const transporter =
  global.__MAILER__ ||
  nodemailer.createTransport(buildSmtpTransportConfig());

const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function baseLayout({ heading, introHtml, ctaHref, ctaText, logoSrc = "cid:platformLogo" }) {
  return `
  <div style="margin:0;padding:0;background:#f6f8fa;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;">
      <tr><td align="center" style="padding:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td align="center" style="padding:24px 24px 8px;">
            <img src="${logoSrc}" alt="Mosaic Biz Hub" width="120" style="display:block;margin:0 auto 8px;" />
            <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;margin:12px 0 0;color:#111827;">${heading}</h1>
            ${introHtml || ""}
            ${ctaHref ? `<div style="height:8px;"></div><a href="${ctaHref}" style="display:inline-block;background:#0d6efd;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;padding:10px 16px;border-radius:8px;">${escapeHtml(ctaText || "Open Dashboard")}</a>` : ""}
          </td></tr>
          <tr><td align="center" style="padding:16px;background:#f9fafb;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;margin:0;">&copy; ${new Date().getFullYear()} Mosaic Biz Hub. All rights reserved.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

function customerIntro({ order, businessName }) {
  const orderNo = order.groupOrderId || order._id?.toString();
  return `
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#374151;margin:8px 0 0;">
    Hi ${escapeHtml(order.userId?.name || "there")},<br/>
    Your payment to <strong>${escapeHtml(businessName)}</strong> is confirmed. Order <strong>#${escapeHtml(orderNo)}</strong> is now placed.
  </p>
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6b7280;margin:10px 0 0;">
    We've attached your invoice (PDF). You can view your order any time from your account.
  </p>`;
}

function vendorIntro({ order, businessName }) {
  const orderNo = order.groupOrderId || order._id?.toString();
  const itemCount = (order.items || []).reduce((n, it) => n + Number(it.quantity || 1), 0);
  return `
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#374151;margin:8px 0 0;">
    Hi ${escapeHtml(businessName)},<br/>
    You received a <strong>paid order</strong> <strong>#${escapeHtml(orderNo)}</strong> with ${itemCount} item${itemCount === 1 ? "" : "s"}.
  </p>
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6b7280;margin:10px 0 0;">
    The customer invoice is attached. Manage this order in your Partners dashboard.
  </p>`;
}

/**
 * Send order-paid emails to customer + vendor with a PDF invoice.
 * Expects order populated with: userId{name,email}, vendorId{name,email}, businessId{businessName,slug,email,owner{email}}, items.productId{name|title}
 */
const normalizeRecipients = (recipients = []) => [
  ...new Set(
    recipients
      .map((recipient) => String(recipient || "").trim())
      .filter(Boolean)
  ),
];

const truncateDeliveryValue = (value, maxLength = 180) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

function normalizeProviderResult(info, recipientCount) {
  const hasAcceptedEvidence = Array.isArray(info?.accepted);
  const accepted = hasAcceptedEvidence ? info.accepted.length : null;
  const rejected = Array.isArray(info?.rejected) ? info.rejected.length : 0;
  const messageId = truncateDeliveryValue(info?.messageId);

  if (hasAcceptedEvidence && accepted === 0 && recipientCount > 0) {
    return {
      status: "failed",
      provider: "smtp",
      recipientCount,
      acceptedCount: 0,
      rejectedCount: rejected,
      messageId,
      error: rejected > 0
        ? "provider_rejected_all_recipients"
        : "provider_accepted_no_recipients",
    };
  }

  if (
    rejected > 0 &&
    recipientCount > 0 &&
    rejected >= recipientCount
  ) {
    return {
      status: "failed",
      provider: "smtp",
      recipientCount,
      acceptedCount: 0,
      rejectedCount: rejected,
      messageId,
      error: "provider_rejected_all_recipients",
    };
  }

  if (!hasAcceptedEvidence) {
    return {
      status: "partial",
      provider: "smtp",
      recipientCount,
      rejectedCount: rejected,
      messageId,
      reason: "provider_acceptance_unverified",
    };
  }

  if (accepted < recipientCount) {
    return {
      status: "partial",
      provider: "smtp",
      recipientCount,
      acceptedCount: accepted,
      rejectedCount: rejected,
      messageId,
      reason: rejected > 0
        ? "provider_partially_rejected_recipients"
        : "provider_partially_accepted_recipients",
    };
  }

  return {
    status: rejected > 0 ? "partial" : "sent",
    provider: "smtp",
    recipientCount,
    acceptedCount: accepted,
    rejectedCount: rejected,
    messageId,
    reason: rejected > 0 ? "provider_partially_rejected_recipients" : null,
  };
}

function classifyDeliveryError(error) {
  const code = String(error?.code || "").toUpperCase();
  if (code === "EAUTH" || code === "535") return "provider_authentication_failed";
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code)) {
    return "provider_connection_failed";
  }
  return "provider_send_failed";
}

function failedDelivery(error, recipientCount, safeError) {
  return {
    status: "failed",
    provider: "smtp",
    recipientCount,
    acceptedCount: 0,
    rejectedCount: 0,
    messageId: null,
    error: safeError || classifyDeliveryError(error),
  };
}

async function sendRoleEmail(message, recipientCount) {
  try {
    const info = await transporter.sendMail(message);
    return normalizeProviderResult(info, recipientCount);
  } catch (error) {
    return failedDelivery(error, recipientCount);
  }
}

exports.sendOrderPaidEmails = async ({
  order,
  currency,
  customerEmails = [],
  vendorEmails = [],
  roles = { customer: true, vendor: true },
}) => {
  const normalizedCustomerEmails = normalizeRecipients(customerEmails);
  const filteredVendorEmails = roles.vendor ? normalizeRecipients(vendorEmails) : [];
  const results = {
    customer: roles.customer
      ? normalizedCustomerEmails.length
        ? null
        : { status: "failed", reason: "missing_recipient", recipientCount: 0 }
      : null,
    vendor: roles.vendor
      ? filteredVendorEmails.length
        ? null
        : {
            status: "failed",
            reason: "missing_recipient",
            recipientCount: 0,
          }
      : null,
  };

  console.log("Preparing order-paid emails", {
    orderId: order?._id?.toString?.() || null,
    groupOrderId: order?.groupOrderId || null,
    currency,
    customerRecipientCount: normalizedCustomerEmails.length,
    vendorRecipientCount: filteredVendorEmails.length,
  });

  const businessName = order.businessId?.businessName || "Vendor";
  const businessSlug = order.businessId?.slug || "";
  const customerOrdersUrl = buildFrontendUrl("/customer/order");
  const partnerOrdersUrl = businessSlug
    ? buildFrontendUrl(`/partners/${encodeURIComponent(businessSlug)}/orders`)
    : buildFrontendUrl("/partners/dashboard");

  const needsCustomerSend = roles.customer && normalizedCustomerEmails.length > 0;
  const needsVendorSend = roles.vendor && filteredVendorEmails.length > 0;
  if (!needsCustomerSend && !needsVendorSend) return results;

  // Use the pure-Node PDFKit renderer. Hosted Chromium is not part of the
  // Elastic Beanstalk runtime contract and previously blocked every SMTP call.
  let pdf;
  try {
    pdf = await renderInvoicePdfBufferForOrder(order);
  } catch (error) {
    if (needsCustomerSend) {
      results.customer = failedDelivery(
        error,
        normalizedCustomerEmails.length,
        "invoice_generation_failed"
      );
    }
    if (needsVendorSend) {
      results.vendor = failedDelivery(
        error,
        filteredVendorEmails.length,
        "invoice_generation_failed"
      );
    }
    return results;
  }
  const invoiceFileName = `invoice-${order.groupOrderId || order._id}.pdf`;

  // Never attach logo via remote `path:` — nodemailer throws "Invalid status code 404"
  // when the frontend/_next image URL is unavailable (common in local QA).
  const { attachment: logoAttachment, logoSrcForHtml } =
    await resolvePlatformLogoAttachment();

  const attachments = withOptionalLogoAttachment(
    [
      {
        filename: invoiceFileName,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
    logoAttachment
  );

  // CUSTOMER EMAIL
  if (needsCustomerSend) {
    const customerHtml = baseLayout({
      heading: "🧾 Payment received — your order is confirmed",
      introHtml: customerIntro({ order, businessName }),
      ctaHref: customerOrdersUrl,
      ctaText: "View Your Order",
      logoSrc: logoSrcForHtml,
    });
    const orderNo = order.groupOrderId || order._id?.toString();
    const customerText = [
      `Hi ${order.userId?.name || "there"},`,
      ``,
      `Your payment to ${businessName} is confirmed.`,
      `Order #${orderNo} is placed.`,
      `View your order: ${customerOrdersUrl}`,
      ``,
      `Invoice attached (PDF).`,
      ``,
      `— Mosaic Biz Hub Team`,
    ].join("\n");

    results.customer = await sendRoleEmail({
      from: formatMosaicFromHeader(),
      to: normalizedCustomerEmails,
      subject: `✅ Order #${orderNo} confirmed`,
      text: customerText,
      html: customerHtml,
      attachments,
      headers: { "X-Entity-Ref-ID": `order-paid-customer-${order._id}` },
    }, normalizedCustomerEmails.length);
  }

  // VENDOR EMAIL
  if (needsVendorSend) {
    const vendorHtml = baseLayout({
      heading: "💸 You’ve received a paid order",
      introHtml: vendorIntro({ order, businessName }),
      ctaHref: partnerOrdersUrl,
      ctaText: "Open Partners Dashboard",
      logoSrc: logoSrcForHtml,
    });
    const orderNo = order.groupOrderId || order._id?.toString();
    const vendorText = [
      `Hi ${businessName},`,
      ``,
      `You received a paid order #${orderNo}.`,
      `Manage: ${partnerOrdersUrl}`,
      ``,
      `Customer invoice attached (PDF).`,
      ``,
      `— Mosaic Biz Hub Team`,
    ].join("\n");

    results.vendor = await sendRoleEmail({
      from: formatMosaicFromHeader(),
      to: filteredVendorEmails,
      subject: `🛍️ New paid order #${orderNo}`,
      text: vendorText,
      html: vendorHtml,
      attachments,
      headers: { "X-Entity-Ref-ID": `order-paid-vendor-${order._id}` },
    }, filteredVendorEmails.length);
  }

  return results;
};

exports.normalizeProviderResult = normalizeProviderResult;
