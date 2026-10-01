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

const { baseLayout, esc } = require("./emailTemplates/baseLayout");

const transporter =
  global.__MAILER__ ||
  nodemailer.createTransport(buildSmtpTransportConfig());

function buildCustomerOrderHtml({ order, businessName, invoiceAttached, customerOrdersUrl }) {
  const orderNo = order.groupOrderId || order._id?.toString();
  const safeName = esc(order.userId?.name || 'there');
  const safeBizName = esc(businessName);
  const itemCount = (order.items || []).reduce((n, it) => n + Number(it.quantity || 1), 0);
  const totalAmount = order.totalAmount !== undefined && order.totalAmount !== null
    ? `$${Number(order.totalAmount).toFixed(2)}`
    : null;

  return `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Payment Received — Order Confirmed
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Your payment to <strong>${safeBizName}</strong> is confirmed. Order <strong>#${esc(orderNo)}</strong> has been placed.
    </p>

    ${invoiceAttached ? `
    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 20px;line-height:1.6;">
      We've attached your invoice (PDF). You can view your order any time from your account.
    </p>` : ''}

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Order Summary:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            <tr>
              <td style="padding:4px 0;width:140px;color:#6B7280;">Order Number:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${esc(orderNo)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Merchant:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeBizName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Total Items:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${itemCount} item${itemCount === 1 ? '' : 's'}</td>
            </tr>
            ${totalAmount ? `
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Total Amount:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${totalAmount}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${customerOrdersUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            View Your Order &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for shopping with Mosaic Biz Hub!
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;
}

function buildVendorOrderHtml({ order, businessName, invoiceAttached, partnerOrdersUrl }) {
  const orderNo = order.groupOrderId || order._id?.toString();
  const ownerName = order.businessId?.owner?.name;
  const rawName = ownerName || order.vendorId?.name || businessName;
  const safeFirstName = esc(rawName ? rawName.split(' ')[0] : 'there');
  const itemCount = (order.items || []).reduce((n, it) => n + Number(it.quantity || 1), 0);
  const totalAmount = order.totalAmount !== undefined && order.totalAmount !== null
    ? `$${Number(order.totalAmount).toFixed(2)}`
    : null;

  return `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      New Order Received
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
      You’ve received a new order.${invoiceAttached ? ' The invoice is attached for your records.' : ''}
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Please review the order details and begin fulfillment.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Order Summary:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            <tr>
              <td style="padding:4px 0;width:140px;color:#6B7280;">Order Number:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${esc(orderNo)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Total Items:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${itemCount} item${itemCount === 1 ? '' : 's'}</td>
            </tr>
            ${totalAmount ? `
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Total Amount:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${totalAmount}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${partnerOrdersUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            View Order &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;
}

/**
 * Send order-paid emails to customer + vendor with an optional PDF invoice.
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

async function resolveInvoiceAttachment(order) {
  try {
    const pdf = await renderInvoicePdfBufferForOrder(order);
    return {
      status: "attached",
      pdf,
      fileName: `invoice-${order.groupOrderId || order._id}.pdf`,
    };
  } catch {
    console.error("Paid-order invoice attachment unavailable", {
      orderId: order?._id?.toString?.() || null,
      error: "invoice_generation_failed",
    });
    return {
      status: "failed",
      error: "invoice_generation_failed",
      pdf: null,
      fileName: null,
    };
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
    invoiceAttachment: null,
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

  const invoiceAttachment = await resolveInvoiceAttachment(order);
  results.invoiceAttachment = {
    status: invoiceAttachment.status,
    ...(invoiceAttachment.error ? { error: invoiceAttachment.error } : {}),
  };
  const invoiceAttached = invoiceAttachment.status === "attached";

  // Never attach logo via remote `path:` — nodemailer throws "Invalid status code 404"
  // when the frontend/_next image URL is unavailable (common in local QA).
  const { attachment: logoAttachment, logoSrcForHtml } =
    await resolvePlatformLogoAttachment();

  const attachments = withOptionalLogoAttachment(
    invoiceAttached
      ? [
          {
            filename: invoiceAttachment.fileName,
            content: invoiceAttachment.pdf,
            contentType: "application/pdf",
          },
        ]
      : [],
    logoAttachment
  );

  // CUSTOMER EMAIL
  if (needsCustomerSend) {
    const orderNo = order.groupOrderId || order._id?.toString();
    const customerBodyHtml = buildCustomerOrderHtml({
      order,
      businessName,
      invoiceAttached,
      customerOrdersUrl,
    });
    const customerHtml = baseLayout({
      preheader: `Your payment to ${businessName} is confirmed. Order #${orderNo} is placed.`,
      bodyHtml: customerBodyHtml,
      footerReason: 'You are receiving this email because you placed an order on Mosaic Biz Hub.',
      logoUrl: logoSrcForHtml,
    });
    const customerText = [
      `Hi ${order.userId?.name || "there"},`,
      ``,
      `Your payment to ${businessName} is confirmed.`,
      `Order #${orderNo} is placed.`,
      `View your order: ${customerOrdersUrl}`,
      ``,
      ...(invoiceAttached ? [`Invoice attached (PDF).`, ``] : []),
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
    const orderNo = order.groupOrderId || order._id?.toString();
    const vendorBodyHtml = buildVendorOrderHtml({
      order,
      businessName,
      invoiceAttached,
      partnerOrdersUrl,
    });
    const vendorHtml = baseLayout({
      preheader: `You’ve received a new order #${orderNo} on Mosaic Biz Hub.`,
      bodyHtml: vendorBodyHtml,
      footerReason: 'You are receiving this email because you are a registered vendor on Mosaic Biz Hub.',
      logoUrl: logoSrcForHtml,
    });
    const ownerName = order.businessId?.owner?.name;
    const rawName = ownerName || order.vendorId?.name || businessName;
    const safeFirstName = rawName ? rawName.split(' ')[0] : 'there';
    const vendorText = [
      `Hi ${safeFirstName},`,
      ``,
      `You’ve received a new order.`,
      `Please review the order details and begin fulfillment.`,
      ``,
      `View Order: ${partnerOrdersUrl}`,
      ``,
      ...(invoiceAttached ? [`The invoice is attached for your records.`, ``] : []),
      `Thank you for being part of the Mosaic Biz Hub community.`,
      `Mosaic Biz Hub`,
    ].join("\n");

    results.vendor = await sendRoleEmail({
      from: formatMosaicFromHeader(),
      to: filteredVendorEmails,
      subject: `New Order Received - #${orderNo}`,
      text: vendorText,
      html: vendorHtml,
      attachments,
      headers: { "X-Entity-Ref-ID": `order-paid-vendor-${order._id}` },
    }, filteredVendorEmails.length);
  }

  return results;
};

exports.normalizeProviderResult = normalizeProviderResult;
