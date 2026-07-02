// utils/orderMailer.js
const nodemailer = require("nodemailer");
const { buildFrontendUrl, getFrontendLogoUrl } = require("./frontendUrl");
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require("./smtpTransport");

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

async function sendOrderStatusEmail(to, orderId, status) {
  const isAccepted = status === "accepted";

  const title = isAccepted
    ? `Order Accepted`
    : `Order Rejected`;

  const orderUrl = buildFrontendUrl("/customer/order");

  const bodyHtml = isAccepted
    ? `
      <p>Great news! Your order has been <strong>accepted by our partner</strong> and is now moving forward.</p>
      <p>We’ll keep you updated as it progresses to shipping or pickup.</p>

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
    `
    : `
      <p>We’re sorry—your order has been <strong>rejected</strong>.</p>
      <p>We truly appreciate your interest and apologize for the inconvenience.</p>
      <p>If payment was captured, a refund will be processed shortly.</p>

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

  const html = wrapHtml({ title, bodyHtml });

  const text = isAccepted
    ? plainText({
        title,
        lines: [
          `Your order has been accepted.`,
          `We’ll notify you with updates soon.`,
          `View your orders: ${orderUrl}`,
        ],
      })
    : plainText({
        title,
        lines: [
          `Your order has been rejected.`,
          `We apologize for the inconvenience.`,
          `If payment was captured, a refund will be processed shortly.`,
          `View your orders: ${orderUrl}`,
        ],
      });

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: `${APP_NAME} • ${title}`,
    html,
    text,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Order status email sent", { status });
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
}

async function sendOrderUpdateEmail(to, status, trackingUrl = null, details = {}) {
  const orderUrl = buildFrontendUrl("/customer/order");

  let title = "";
  let message = "";
  let extraButton = "";

  if (status === "shipped") {
    title = "Your Order Has Been Shipped";

    message = `
      <p>Good news! Your order has been <strong>shipped</strong> and is on its way.</p>
      <p>You can track your shipment using the link below.</p>
      ${details.trackingId ? `<p><strong>Tracking ID:</strong> ${escapeHtml(details.trackingId)}</p>` : ""}
    `;

    // ✅ Add tracking button if URL exists
    if (trackingUrl) {
      extraButton = `
        <div style="text-align:center; margin:20px 0;">
          <a href="${escapeHtml(trackingUrl)}" target="_blank"
            style="
              background:#333;
              color:#ffffff;
              padding:12px 24px;
              text-decoration:none;
              border-radius:6px;
              font-weight:600;
              display:inline-block;
            ">
            Track Your Shipment
          </a>
        </div>
      `;
    }
  }

  if (status === "delivered") {
    title = "Your Order Has Been Delivered";

    message = `
      <p>Your order has been <strong>successfully delivered</strong>.</p>
      <p>We hope you enjoy your purchase. Thank you for choosing us!</p>
    `;
  }

  const bodyHtml = `
    ${message}
    ${extraButton}

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

  const html = wrapHtml({ title, bodyHtml });

  const textLines = [
    status === "shipped"
      ? "Your order has been shipped."
      : "Your order has been delivered.",
  ];

  if (trackingUrl && status === "shipped") {
    textLines.push(`Track your shipment: ${trackingUrl}`);
  }

  textLines.push(`View your orders: ${orderUrl}`);

  const text = plainText({
    title,
    lines: textLines,
  });

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: `${APP_NAME} • ${title}`,
    html,
    text,
  });
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
