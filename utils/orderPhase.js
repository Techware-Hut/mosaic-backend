// utils/orderMailer.js
const nodemailer = require("nodemailer");
const { buildFrontendUrl, getFrontendLogoUrl } = require("./frontendUrl");
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require("./smtpTransport");
const { baseLayout, esc } = require("./emailTemplates/baseLayout");

const APP_NAME = process.env.APP_NAME || "Mosaic Biz Hub";
const LOGO_URL = getFrontendLogoUrl();
const ORDERS_URL = buildFrontendUrl("/customer/order");

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// Configure transporter (swap service/config as needed)
const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

/**
 * HTML wrapper with logo header and CTA button
 */
function wrapHtml({ title, bodyHtml }) {
  return `
  <div style="background:#f6f7fb;padding:24px 0;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(16,24,40,.06);overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #eef2f7;">
                <img src="${LOGO_URL}" alt="${APP_NAME} Logo" height="36" style="display:block"/>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 8px 24px">
                <h2 style="margin:0 0 8px 0;font-size:20px;line-height:28px;color:#0f172a;">${title}</h2>
                <div style="font-size:14px;line-height:22px;color:#334155;">
                  ${bodyHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 28px 24px">
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px;background:#f9fafb;border-top:1px solid #eef2f7;font-size:12px;color:#6b7280;">
                © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
              </td>
            </tr>
          </table>
          <div style="font-size:11px;color:#94a3b8;margin-top:12px;">
            You’re receiving this because you have an order on ${APP_NAME}.
          </div>
        </td>
      </tr>
    </table>
  </div>`;
}

/**
 * Plain-text fallback
 */
function plainText({ title, lines = [] }) {
  return [
    `${title}`,
    "",
    ...lines,
    "",
    `View your orders: ${ORDERS_URL}`,
    "",
    `© ${new Date().getFullYear()} ${APP_NAME}`,
  ].join("\n");
}

/**
 * Send order status email to customer
 * @param {string} to - Customer email
 * @param {string|number} orderId - Order reference
 * @param {"accepted"|"rejected"} status - Status to notify
 */
// async function sendOrderStatusEmail(to, orderId, status) {
//   const isAccepted = status === "accepted";
//   const title = isAccepted
//     ? `Order #${orderId} Accepted`
//     : `Order #${orderId} Rejected`;

//   const bodyHtml = isAccepted
//     ? `
//       <p>Great news! Your order <strong>#${orderId}</strong> has been <strong>accepted by our partner</strong> and is now moving forward.</p>
//       <p>We’ll keep you updated as it progresses to shipping or pickup.</p>
//     `
//     : `
//       <p>We’re sorry—your order <strong>#${orderId}</strong> has been <strong>rejected</strong>.</p>
//       <p>We truly appreciate your interest and apologize for the inconvenience. If payment was captured, a refund will be processed shortly.</p>
//     `;

//   const html = wrapHtml({ title, bodyHtml });

//   const text = isAccepted
//     ? plainText({
//         title,
//         lines: [
//           `Your order #${orderId} has been accepted.`,
//           `We’ll notify you with shipping details soon.`,
//         ],
//       })
//     : plainText({
//         title,
//         lines: [
//           `Your order #${orderId} has been rejected.`,
//           `We appreciate your interest and apologize for the inconvenience.`,
//           `If payment was captured, a refund will be processed shortly.`,
//         ],
//       });

//   const mailOptions = {
//     from: `"${APP_NAME}" <${process.env.MAIL_USER}>`,
//     to,
//     subject: `${APP_NAME} • ${title}`,
//     html,
//     text,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log(`Order status email sent to ${to} for order ${orderId} (${status})`);
//   } catch (err) {
//     console.error("Error sending email:", err);
//     throw err;
//   }
// }

async function sendCustomerOrderPlacedEmail(to, order) {
  const orderUrl = buildFrontendUrl("/customer/order");

  const html = wrapHtml({
    title: "Order Placed Successfully",
    bodyHtml: `
      <p>Your order has been <strong>placed successfully</strong> 🎉</p>
      <p>Total Amount: <strong>$${order.totalAmount}</strong></p>
      <p>We’ll notify you once the vendor accepts your order.</p>

      <div style="text-align:center; margin:30px 0;">
        <a href="${orderUrl}" target="_blank"
          style="
            background:#C7A040;
            color:#fff;
            padding:12px 24px;
            text-decoration:none;
            border-radius:6px;
            display:inline-block;
          ">
          View Your Order
        </a>
      </div>
    `
  });

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: `${APP_NAME} • Order Placed`,
    html,
  });
}


async function sendVendorNewOrderEmail(to, order) {
  const orderUrl = buildFrontendUrl("/partners/dashboard");

  const html = wrapHtml({
    title: "New Order Received",
    bodyHtml: `
      <p>You have received a <strong>new order</strong> 🛒</p>
      <p>Total Amount: <strong>$${order.totalAmount}</strong></p>

      <div style="text-align:center; margin:30px 0;">
        <a href="${orderUrl}" target="_blank"
          style="
            background:#333;
            color:#fff;
            padding:12px 24px;
            text-decoration:none;
            border-radius:6px;
            display:inline-block;
          ">
          View Order
        </a>
      </div>
    `
  });

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: `${APP_NAME} • New Order Received`,
    html,
  });
}

async function sendOrderStatusEmail(to, orderOrId, status, extra = {}) {
  const isAccepted = status === "accepted";
  const isObject = typeof orderOrId === 'object' && orderOrId !== null;
  const orderNo = isObject
    ? (orderOrId.groupOrderId || orderOrId._id?.toString() || 'N/A')
    : String(orderOrId || 'N/A');

  const rawCustomerName = (isObject ? orderOrId.userId?.name : null) || extra.customerName || extra.firstName || '';
  const safeFirstName = esc(rawCustomerName ? rawCustomerName.split(' ')[0] : 'there');
  const safeOrderNo = esc(orderNo);
  const orderUrl = buildFrontendUrl("/customer/order");

  if (isAccepted) {
    const preheader = `Great news! Your order #${safeOrderNo} has been accepted and is now being prepared.`;
    const footerReason = 'You are receiving this email because you placed an order on Mosaic Biz Hub.';

    const bodyHtml = `
      <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
        Your Order Has Been Accepted
      </h1>

      <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
        Hi ${safeFirstName},
      </p>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Great news &mdash; your order <strong>#${safeOrderNo}</strong> has been accepted by the vendor and is now being prepared.
      </p>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
        We’ll notify you when it ships.
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
                <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeOrderNo}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Status:</td>
                <td style="padding:4px 0;font-weight:600;color:#15803D;">Accepted &bull; Preparing</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA Button -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
        <tr>
          <td>
            <a href="${orderUrl}"
               style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
              View Order Status &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Thank you for being part of the Mosaic Biz Hub community. Shop in confidence!
      </p>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
        Mosaic Biz Hub
      </p>
    `;

    const html = baseLayout({
      preheader,
      bodyHtml,
      footerReason,
    });

    const text = [
      `Hi ${safeFirstName},`,
      ``,
      `Great news — your order #${safeOrderNo} has been accepted by the vendor and is now being prepared.`,
      `We’ll notify you when it ships.`,
      ``,
      `View Order Status: ${orderUrl}`,
      ``,
      `Thank you for being part of the Mosaic Biz Hub community. Shop in confidence!`,
      `Mosaic Biz Hub`,
    ].join("\n");

    const mailOptions = {
      from: formatMosaicFromHeader(),
      to,
      subject: `Your Order Has Been Accepted - #${safeOrderNo}`,
      html,
      text,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log("Order accepted email sent", { to, orderNo, messageId: info?.messageId });
      return info;
    } catch (err) {
      console.error("Error sending order accepted email:", err);
      throw err;
    }
  }

  // REJECTED
  const browseVendorsUrl = buildFrontendUrl("/");
  const preheader = `We’re sorry — your order #${safeOrderNo} could not be fulfilled by the vendor.`;
  const footerReason = 'You are receiving this email because you placed an order on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Your Order Could Not Be Fulfilled
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
      We’re sorry &mdash; the vendor was unable to accept your order. If you need help finding alternatives, we’re here to support you.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      If payment was processed, a full refund has been initiated to your original payment method.
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
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeOrderNo}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Status:</td>
              <td style="padding:4px 0;font-weight:600;color:#DC2626;">Unfulfilled &bull; Refund Initiated</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${browseVendorsUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Browse Vendors &rarr;
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

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `We’re sorry — the vendor was unable to accept your order. If you need help finding alternatives, we’re here to support you.`,
    `If payment was processed, a full refund has been initiated to your original payment method.`,
    ``,
    `Browse Vendors: ${browseVendorsUrl}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].join("\n");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: `Your Order Could Not Be Fulfilled - #${safeOrderNo}`,
    html,
    text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Order rejected email sent", { to, orderNo, messageId: info?.messageId });
    return info;
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
}

async function sendOrderUpdateEmail(to, status, trackingUrl = null, details = {}) {
  const orderUrl = buildFrontendUrl("/customer/order");
  const order = details.order;
  const orderNo = order?.groupOrderId || order?._id?.toString() || details.orderId || details.orderNo || '';
  const rawCustomerName = order?.userId?.name || details.customerName || details.firstName || '';
  const safeFirstName = esc(rawCustomerName ? rawCustomerName.split(' ')[0] : 'there');
  const safeOrderNo = esc(orderNo);
  const safeTrackingId = esc(details.trackingId || 'N/A');
  const safeTrackingUrl = trackingUrl || orderUrl;

  if (status === "shipped") {
    const preheader = `Your order is on the way! Tracking Number: ${safeTrackingId}`;
    const footerReason = 'You are receiving this email because you placed an order on Mosaic Biz Hub.';

    const bodyHtml = `
      <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
        Your Order Is On the Way!
      </h1>

      <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
        Hi ${safeFirstName},
      </p>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Your order has shipped.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
        <tr>
          <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
            <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
              Shipping &amp; Tracking Details:
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
              ${safeOrderNo ? `
              <tr>
                <td style="padding:4px 0;width:140px;color:#6B7280;">Order Number:</td>
                <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeOrderNo}</td>
              </tr>` : ''}
              <tr>
                <td style="padding:4px 0;width:140px;color:#6B7280;">Tracking Number:</td>
                <td style="padding:4px 0;font-weight:700;color:#2563EB;">${safeTrackingId}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Status:</td>
                <td style="padding:4px 0;font-weight:600;color:#15803D;">Shipped &bull; In Transit</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
        You can follow your package using the link below.
      </p>

      <!-- CTA Button -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
        <tr>
          <td>
            <a href="${safeTrackingUrl}"
               style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
              Track My Order &rarr;
            </a>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Thank you for supporting diverse businesses on Mosaic Biz Hub.
      </p>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
        Mosaic Biz Hub
      </p>
    `;

    const html = baseLayout({
      preheader,
      bodyHtml,
      footerReason,
    });

    const text = [
      `Hi ${safeFirstName},`,
      ``,
      `Your order has shipped.`,
      `Tracking Number: ${details.trackingId || 'N/A'}`,
      `You can follow your package using the link below.`,
      ``,
      `Track My Order: ${safeTrackingUrl}`,
      ``,
      `Thank you for supporting diverse businesses on Mosaic Biz Hub.`,
      `Mosaic Biz Hub`,
    ].join("\n");

    return transporter.sendMail({
      from: formatMosaicFromHeader(),
      to,
      subject: `Your Order Is On the Way!${safeOrderNo ? ` - #${safeOrderNo}` : ''}`,
      html,
      text,
    });
  }

  // DELIVERED
  if (status === "delivered") {
    const preheader = `Your order ${safeOrderNo ? `#${safeOrderNo} ` : ''}has been delivered! Thank you for supporting our vendor community.`;
    const footerReason = 'You are receiving this email because you placed an order on Mosaic Biz Hub.';

    const bodyHtml = `
      <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
        Your Order Has Been Delivered
      </h1>

      <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
        Hi ${safeFirstName},
      </p>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
        Your order ${safeOrderNo ? `<strong>#${safeOrderNo}</strong> ` : ''}has been delivered. We hope you enjoy your purchase &mdash; thank you for supporting our vendor community.
      </p>

      ${safeOrderNo ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
        <tr>
          <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
            <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
              Delivery Details:
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
              <tr>
                <td style="padding:4px 0;width:140px;color:#6B7280;">Order Number:</td>
                <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeOrderNo}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#6B7280;">Status:</td>
                <td style="padding:4px 0;font-weight:600;color:#15803D;">Delivered</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>` : ''}

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Thank you for being part of the Mosaic Biz Hub community.
      </p>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
        Mosaic Biz Hub
      </p>
    `;

    const html = baseLayout({
      preheader,
      bodyHtml,
      footerReason,
    });

    const text = [
      `Hi ${safeFirstName},`,
      ``,
      `Your order ${safeOrderNo ? `#${safeOrderNo} ` : ''}has been delivered. We hope you enjoy your purchase — thank you for supporting our vendor community.`,
      ``,
      `Thank you for being part of the Mosaic Biz Hub community.`,
      `Mosaic Biz Hub`,
    ].join("\n");

    return transporter.sendMail({
      from: formatMosaicFromHeader(),
      to,
      subject: `Your Order Has Been Delivered${safeOrderNo ? ` - #${safeOrderNo}` : ''}`,
      html,
      text,
    });
  }
}

async function sendOrderLifecycleEmail(to, order, event) {
  const orderReference = order?.groupOrderId || order?._id?.toString?.() || "your order";
  const orderUrl = buildFrontendUrl("/customer/order");

  const copyByEvent = {
    order_cancelled: {
      title: "Order Cancelled",
      body: `
        <p>Your order <strong>#${escapeHtml(orderReference)}</strong> has been <strong>cancelled</strong>.</p>
        ${
          order?.paymentStatus === "refunded"
            ? "<p>If payment was captured, the refund has been initiated and will settle according to your payment provider timeline.</p>"
            : "<p>No paid confirmation email is sent for unpaid or abandoned orders.</p>"
        }
      `,
      textLines: [
        `Your order #${orderReference} has been cancelled.`,
        order?.paymentStatus === "refunded"
          ? "If payment was captured, the refund has been initiated."
          : "No paid confirmation email is sent for unpaid or abandoned orders.",
      ],
    },
    return_initiated: {
      title: "Return Request Received",
      body: `
        <p>Your return request for order <strong>#${escapeHtml(orderReference)}</strong> has been received.</p>
        <p>The vendor will review the request and we will send another update when the return is accepted or resolved.</p>
      `,
      textLines: [
        `Your return request for order #${orderReference} has been received.`,
        "The vendor will review the request and we will send another update when it is resolved.",
      ],
    },
    order_refunded: {
      title: "Refund Processed",
      body: `
        <p>Your refund for order <strong>#${escapeHtml(orderReference)}</strong> has been processed.</p>
        <p>Refund timing depends on your bank or card provider.</p>
      `,
      textLines: [
        `Your refund for order #${orderReference} has been processed.`,
        "Refund timing depends on your bank or card provider.",
      ],
    },
  };

  const copy = copyByEvent[event] || {
    title: "Order Update",
    body: `<p>There is an update for order <strong>#${escapeHtml(orderReference)}</strong>.</p>`,
    textLines: [`There is an update for order #${orderReference}.`],
  };

  const bodyHtml = `
    ${copy.body}

    <div style="text-align:center; margin:30px 0;">
      <a href="${orderUrl}" target="_blank"
        style="
          background:#C7A040;
          color:#ffffff;
          padding:14px 28px;
          text-decoration:none;
          border-radius:6px;
          font-weight:600;
          display:inline-block;
        ">
        View Your Orders
      </a>
    </div>
  `;

  const html = wrapHtml({ title: copy.title, bodyHtml });
  const text = plainText({
    title: copy.title,
    lines: [...copy.textLines, `View your orders: ${orderUrl}`],
  });

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: `${APP_NAME} - ${copy.title}`,
    html,
    text,
  });
}

module.exports = {
  sendOrderStatusEmail,
  sendOrderUpdateEmail,
  sendOrderLifecycleEmail,
  sendVendorNewOrderEmail,
  sendCustomerOrderPlacedEmail,
};
