const Order = require("../models/Order");
const { sendOrderPaidEmails } = require("./OrderMail");
const {
  appendOrderLifecycleEmailLog,
  buildOrderLifecycleEmailFingerprint,
} = require("./orderLifecycleEmailDelivery");

const PAID_CONFIRMATION_POPULATE = [
  { path: "userId", select: "name email" },
  { path: "vendorId", select: "name email" },
  {
    path: "businessId",
    select: "businessName slug email owner",
    populate: { path: "owner", select: "name email" },
  },
  { path: "items.productId", select: "name title" },
];

async function loadOrderForPaidConfirmation(orderOrId) {
  const id = orderOrId?._id || orderOrId;
  if (!id) return null;

  return Order.findById(id).populate(PAID_CONFIRMATION_POPULATE);
}

/**
 * Idempotent post-payment confirmation mailer for customer + vendor.
 * Safe to call from every paid-reconcile path (webhooks + retrieveIntent).
 */
async function sendOrderPaidConfirmationIfNeeded(orderOrId, { currency } = {}) {
  const order = await loadOrderForPaidConfirmation(orderOrId);
  if (!order) {
    return { sent: false, skipped: true, reason: "order_not_found" };
  }

  if (order.paymentStatus !== "paid") {
    return { sent: false, skipped: true, reason: "not_paid" };
  }

  if (order.paidConfirmationEmailSentAt) {
    console.log(
      `Paid confirmation email already sent for order ${order._id}, skipping duplicate send`
    );
    return { sent: false, skipped: true, reason: "already_sent" };
  }

  const customerEmails = [
    ...new Set([order.userId?.email].filter(Boolean)),
  ];
  const vendorEmails = [
    ...new Set(
      [
        order.vendorId?.email,
        order.businessId?.email,
        order.businessId?.owner?.email,
      ].filter(Boolean)
    ),
  ];

  const fingerprint = buildOrderLifecycleEmailFingerprint(
    order,
    "order_paid_confirmation"
  );
  const resolvedCurrency = currency || order.currency || "usd";

  if (!customerEmails.length && !vendorEmails.length) {
    await appendOrderLifecycleEmailLog(order, {
      event: "order_paid_confirmation",
      fingerprint,
      deliveryStatus: "skipped",
      recipientRole: "customer",
      error: "no_recipients",
    });
    console.warn("Order paid confirmation skipped: no recipients", {
      orderId: String(order._id),
    });
    return { sent: false, skipped: true, reason: "no_recipients", order };
  }

  if (!customerEmails.length) {
    console.warn("Order paid confirmation missing customer email", {
      orderId: String(order._id),
      vendorRecipientCount: vendorEmails.length,
    });
  }

  try {
    await sendOrderPaidEmails({
      order,
      currency: resolvedCurrency,
      customerEmails,
      vendorEmails,
    });

    order.paidConfirmationEmailSentAt = new Date();
    await order.save();
    await appendOrderLifecycleEmailLog(order, {
      event: "order_paid_confirmation",
      fingerprint,
      deliveryStatus: "sent",
      recipientRole: "customer",
    });

    return { sent: true, skipped: false, order };
  } catch (mailErr) {
    await appendOrderLifecycleEmailLog(order, {
      event: "order_paid_confirmation",
      fingerprint,
      deliveryStatus: "failed",
      recipientRole: "customer",
      error: mailErr?.message || "Unknown email error",
    });
    console.error(
      "Failed to send order-paid emails:",
      mailErr?.message || mailErr
    );
    return {
      sent: false,
      skipped: false,
      failed: true,
      error: mailErr,
      order,
    };
  }
}

module.exports = {
  PAID_CONFIRMATION_POPULATE,
  loadOrderForPaidConfirmation,
  sendOrderPaidConfirmationIfNeeded,
};
