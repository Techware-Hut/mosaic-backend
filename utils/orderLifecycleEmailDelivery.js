const crypto = require("crypto");

const truncate = (value, maxLength = 180) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

function buildOrderLifecycleEmailFingerprint(order, event, details = {}) {
  const payload = {
    orderId: order?._id ? String(order._id) : null,
    groupOrderId: order?.groupOrderId || null,
    event,
    status: order?.status || null,
    paymentStatus: order?.paymentStatus || null,
    trackingId: details.trackingId || order?.trackingInfo?.trackingId || null,
    trackingUrl: details.trackingUrl || order?.trackingInfo?.trackingUrl || null,
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function hasSentOrderLifecycleEmail(order, fingerprint) {
  return Array.isArray(order?.lifecycleEmailLog)
    && order.lifecycleEmailLog.some(
      (entry) => entry?.fingerprint === fingerprint && entry?.deliveryStatus === "sent"
    );
}

async function appendOrderLifecycleEmailLog(order, entry) {
  if (!order) {
    return { logged: false, error: "order_missing" };
  }

  if (!Array.isArray(order.lifecycleEmailLog)) {
    order.lifecycleEmailLog = [];
  }

  order.lifecycleEmailLog.push({
    event: entry.event,
    fingerprint: entry.fingerprint,
    orderStatus: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: entry.deliveryStatus,
    recipientRole: entry.recipientRole || "customer",
    attemptedAt: new Date(),
    error: entry.error ? truncate(entry.error) : undefined,
  });

  try {
    await order.save();
    return { logged: true };
  } catch (error) {
    console.error("Order lifecycle email log failed:", error.message);
    return { logged: false, error: error.message };
  }
}

async function sendCustomerOrderLifecycleEmail({
  order,
  event,
  send,
  fingerprintDetails = {},
}) {
  const fingerprint = buildOrderLifecycleEmailFingerprint(order, event, fingerprintDetails);

  if (hasSentOrderLifecycleEmail(order, fingerprint)) {
    return {
      emailSent: false,
      emailSkipped: true,
      emailFailed: false,
      emailDeduped: true,
      notificationLogged: false,
      fingerprint,
    };
  }

  const customerEmail = order?.userId?.email;
  if (!customerEmail) {
    const notificationLog = await appendOrderLifecycleEmailLog(order, {
      event,
      fingerprint,
      deliveryStatus: "skipped",
      recipientRole: "customer",
      error: "customer_email_missing",
    });

    console.warn("Order lifecycle email skipped: customer email missing", {
      orderId: order?._id ? String(order._id) : null,
      event,
    });

    return {
      emailSent: false,
      emailSkipped: true,
      emailFailed: false,
      emailDeduped: false,
      notificationLogged: notificationLog.logged,
      fingerprint,
    };
  }

  try {
    await send(customerEmail);
    const notificationLog = await appendOrderLifecycleEmailLog(order, {
      event,
      fingerprint,
      deliveryStatus: "sent",
      recipientRole: "customer",
    });

    return {
      emailSent: true,
      emailSkipped: false,
      emailFailed: false,
      emailDeduped: false,
      notificationLogged: notificationLog.logged,
      fingerprint,
    };
  } catch (error) {
    const message = error?.message || "Unknown email error";
    console.error(`Order lifecycle email failed (${event}):`, message);
    const notificationLog = await appendOrderLifecycleEmailLog(order, {
      event,
      fingerprint,
      deliveryStatus: "failed",
      recipientRole: "customer",
      error: message,
    });

    return {
      emailSent: false,
      emailSkipped: false,
      emailFailed: true,
      emailDeduped: false,
      notificationLogged: notificationLog.logged,
      fingerprint,
    };
  }
}

module.exports = {
  appendOrderLifecycleEmailLog,
  buildOrderLifecycleEmailFingerprint,
  hasSentOrderLifecycleEmail,
  sendCustomerOrderLifecycleEmail,
};
