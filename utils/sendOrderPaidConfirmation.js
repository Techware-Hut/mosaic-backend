const crypto = require("crypto");
const Order = require("../models/Order");
const { sendOrderPaidEmails } = require("./OrderMail");
const {
  resolveOrderPaidVendorEmailDelivery,
} = require("./notificationPreferenceGate");
const {
  buildOrderLifecycleEmailFingerprint,
} = require("./orderLifecycleEmailDelivery");
const {
  CLOSED_ORDER_STATUSES,
  isClosedOrderStatus,
} = require("./orderPaidEmailEligibility");

const PAID_CONFIRMATION_POPULATE = [
  { path: "userId", select: "name email" },
  { path: "vendorId", select: "name email notificationPreferences" },
  {
    path: "businessId",
    select: "businessName slug email owner",
    populate: { path: "owner", select: "name email notificationPreferences" },
  },
  { path: "items.productId", select: "name title" },
];

const AGGREGATE_CUSTOMER_STATUSES = ["sent", "partial"];
const AGGREGATE_VENDOR_STATUSES = ["sent", "partial", "skipped"];
const NON_CLAIMABLE_STATUSES = new Set(["processing", "sent", "partial", "skipped"]);

async function loadOrderForPaidConfirmation(orderOrId) {
  const id = orderOrId?._id || orderOrId;
  if (!id) return null;
  return Order.findById(id).populate(PAID_CONFIRMATION_POPULATE);
}

function truncate(value, maxLength = 180) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function rolePath(role, field) {
  return `paidOrderEmailDelivery.${role}.${field}`;
}

function deliveryFor(order, role) {
  return order?.paidOrderEmailDelivery?.[role] || {};
}

function legacyDeliveryResult(order) {
  const sentAt = order.paidConfirmationEmailSentAt;
  return {
    sent: false,
    skipped: true,
    failed: false,
    emailSent: true,
    emailSkipped: false,
    emailFailed: false,
    customer: { status: "sent", sentAt, reason: "legacy_aggregate_delivery" },
    vendor: { status: "sent", sentAt, reason: "legacy_aggregate_delivery" },
    reason: "already_sent_legacy",
    order,
  };
}

function summarize(order, operation = {}) {
  const customer = deliveryFor(order, "customer");
  const vendor = deliveryFor(order, "vendor");
  const roles = [customer, vendor];
  const emailSent = roles.some(
    (entry) => entry.status === "sent" || entry.status === "partial"
  );
  const emailFailed = roles.some((entry) => entry.status === "failed");
  const emailPartial = roles.some((entry) => entry.status === "partial");
  const emailProcessing = roles.some((entry) => entry.status === "processing");
  const intentionalPreferenceSkip =
    vendor.status === "skipped" && vendor.reason === "vendor_preference_disabled";
  const unexpectedSkip = roles.some(
    (entry) => entry.status === "skipped" &&
      !(entry === vendor && intentionalPreferenceSkip)
  );
  const warning = emailFailed || emailPartial || emailProcessing || unexpectedSkip
    ? "paid_order_email_delivery_incomplete"
    : undefined;

  return {
    sent: Boolean(operation.sent),
    skipped: Boolean(operation.skipped),
    failed: Boolean(operation.failed),
    emailSent,
    emailSkipped: unexpectedSkip,
    emailFailed,
    emailWarning: warning,
    customer,
    vendor,
  };
}

function publicPaidOrderEmailDelivery(result) {
  return {
    emailSent: Boolean(result?.emailSent),
    emailSkipped: Boolean(result?.emailSkipped),
    emailFailed: Boolean(result?.emailFailed),
    ...(result?.emailWarning ? { emailWarning: result.emailWarning } : {}),
  };
}

async function claimRole(orderId, role, token = crypto.randomUUID()) {
  const statusPath = rolePath(role, "status");
  const update = {
    $set: {
      "paidOrderEmailDelivery.version": 1,
      [statusPath]: "processing",
      [rolePath(role, "claimToken")]: token,
      [rolePath(role, "attemptedAt")]: new Date(),
    },
    $inc: { [rolePath(role, "attemptCount")]: 1 },
    $unset: {
      [rolePath(role, "completedAt")]: "",
      [rolePath(role, "sentAt")]: "",
      [rolePath(role, "provider")]: "",
      [rolePath(role, "messageId")]: "",
      [rolePath(role, "reason")]: "",
      [rolePath(role, "error")]: "",
      [rolePath(role, "recipientCount")]: "",
      [rolePath(role, "acceptedCount")]: "",
      [rolePath(role, "rejectedCount")]: "",
      [rolePath(role, "preferenceAllowed")]: "",
      [rolePath(role, "ownerSuppressed")]: "",
    },
  };

  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      paymentStatus: "paid",
      status: { $nin: [...CLOSED_ORDER_STATUSES] },
      $or: [
        { [statusPath]: { $exists: false } },
        { [statusPath]: null },
        { [statusPath]: "failed" },
      ],
    },
    update,
    { new: true }
  );

  return claimed ? token : null;
}

function setIfPresent(update, path, value, maxLength) {
  if (value === undefined || value === null || value === "") return;
  update.$set[path] = maxLength ? truncate(value, maxLength) : value;
  delete update.$unset[path];
}

async function finalizeRole(orderId, role, token, result) {
  const now = new Date();
  const status = ["sent", "partial", "skipped", "failed"].includes(result?.status)
    ? result.status
    : "failed";
  const update = {
    $set: {
      [rolePath(role, "status")]: status,
      [rolePath(role, "completedAt")]: now,
      [rolePath(role, "recipientCount")]: Number(result?.recipientCount || 0),
    },
    $unset: {
      [rolePath(role, "claimToken")]: "",
      [rolePath(role, "sentAt")]: "",
      [rolePath(role, "provider")]: "",
      [rolePath(role, "messageId")]: "",
      [rolePath(role, "reason")]: "",
      [rolePath(role, "error")]: "",
      [rolePath(role, "acceptedCount")]: "",
      [rolePath(role, "rejectedCount")]: "",
      [rolePath(role, "preferenceAllowed")]: "",
      [rolePath(role, "ownerSuppressed")]: "",
    },
  };

  if (status === "sent" || status === "partial") {
    update.$set[rolePath(role, "sentAt")] = now;
    delete update.$unset[rolePath(role, "sentAt")];
  }
  setIfPresent(update, rolePath(role, "provider"), result?.provider, 40);
  setIfPresent(update, rolePath(role, "messageId"), result?.messageId, 180);
  setIfPresent(update, rolePath(role, "reason"), result?.reason, 180);
  setIfPresent(update, rolePath(role, "error"), result?.error, 180);
  setIfPresent(update, rolePath(role, "acceptedCount"), result?.acceptedCount);
  setIfPresent(update, rolePath(role, "rejectedCount"), result?.rejectedCount);
  setIfPresent(
    update,
    rolePath(role, "preferenceAllowed"),
    result?.preferenceAllowed
  );
  setIfPresent(
    update,
    rolePath(role, "ownerSuppressed"),
    result?.ownerSuppressed
  );

  return Order.findOneAndUpdate(
    {
      _id: orderId,
      [rolePath(role, "status")]: "processing",
      [rolePath(role, "claimToken")]: token,
    },
    update,
    { new: true }
  );
}

async function markAggregateCompleteIfReady(orderId) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      paidConfirmationEmailSentAt: null,
      [rolePath("customer", "status")]: { $in: AGGREGATE_CUSTOMER_STATUSES },
      [rolePath("vendor", "status")]: { $in: AGGREGATE_VENDOR_STATUSES },
    },
    { $set: { paidConfirmationEmailSentAt: new Date() } },
    { new: true }
  );
}

async function logRoleResult(order, role, result) {
  const fingerprint = buildOrderLifecycleEmailFingerprint(
    order,
    "order_paid_confirmation",
    { recipientRole: role }
  );
  const entry = {
    event: "order_paid_confirmation",
    fingerprint,
    orderStatus: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: result.status,
    recipientRole: role,
    attemptedAt: new Date(),
  };
  const addEntryValue = (key, value, maxLength) => {
    if (value === undefined || value === null || value === "") return;
    entry[key] = maxLength ? truncate(value, maxLength) : value;
  };
  addEntryValue("provider", result.provider, 40);
  addEntryValue("messageId", result.messageId, 180);
  addEntryValue("reason", result.reason, 180);
  addEntryValue("error", result.error, 180);

  try {
    await Order.updateOne(
      { _id: order._id },
      { $push: { lifecycleEmailLog: entry } }
    );
  } catch {
    console.error("Paid-order delivery audit log persistence failed", {
      orderId: String(order._id),
      recipientRole: role,
    });
  }
}

function safeFailure(reason, recipientCount = 0) {
  return {
    status: "failed",
    recipientCount,
    acceptedCount: 0,
    rejectedCount: 0,
    error: reason,
  };
}

/**
 * Idempotent post-payment confirmation mailer for customer + vendor.
 * Each role owns an atomic claim, provider result, and independent retry state.
 * A processing claim is deliberately not auto-reclaimed: SMTP cannot provide
 * exactly-once delivery after provider acceptance followed by process death.
 */
async function sendOrderPaidConfirmationIfNeeded(orderOrId, { currency } = {}) {
  let order = await loadOrderForPaidConfirmation(orderOrId);
  if (!order) return { sent: false, skipped: true, reason: "order_not_found" };
  if (order.paymentStatus !== "paid") {
    return { sent: false, skipped: true, reason: "not_paid", order };
  }
  if (isClosedOrderStatus(order.status)) {
    return {
      sent: false,
      skipped: true,
      failed: false,
      emailSent: false,
      emailSkipped: false,
      emailFailed: false,
      reason: "order_terminal",
      order,
    };
  }

  if (order.paidConfirmationEmailSentAt && !order.paidOrderEmailDelivery?.version) {
    return legacyDeliveryResult(order);
  }

  const customerEmails = [...new Set([order.userId?.email].filter(Boolean))];
  let vendorResolution;
  try {
    vendorResolution = await resolveOrderPaidVendorEmailDelivery(order);
  } catch {
    vendorResolution = {
      recipients: [],
      error: "vendor_preference_lookup_failed",
    };
  }

  const claims = {};
  const claimAttempts = {};
  let claimFailed = false;
  for (const role of ["customer", "vendor"]) {
    if (!NON_CLAIMABLE_STATUSES.has(deliveryFor(order, role).status)) {
      const token = crypto.randomUUID();
      claimAttempts[role] = token;
      try {
        claims[role] = await claimRole(order._id, role, token);
      } catch {
        claimFailed = true;
        break;
      }
    }
  }

  if (claimFailed) {
    const result = safeFailure("email_delivery_claim_failed");
    let failureOrder = order;
    for (const [role, token] of Object.entries(claimAttempts)) {
      try {
        const finalized = await finalizeRole(order._id, role, token, result);
        if (finalized) {
          failureOrder = finalized;
          await logRoleResult(finalized, role, result);
        }
      } catch {
        console.error("Paid-order email claim cleanup failed", {
          orderId: String(order._id),
          recipientRole: role,
        });
      }
    }

    try {
      order = await loadOrderForPaidConfirmation(order._id);
    } catch {
      order = failureOrder;
    }
    const summary = {
      ...summarize(order, { failed: true }),
      emailFailed: true,
      emailWarning: "paid_order_email_delivery_incomplete",
    };
    console.error("Paid-order email delivery claim failed", {
      orderId: String(order._id),
      customerStatus: summary.customer?.status,
      vendorStatus: summary.vendor?.status,
    });
    return { ...summary, order };
  }

  if (!claims.customer && !claims.vendor) {
    await markAggregateCompleteIfReady(order._id);
    order = await loadOrderForPaidConfirmation(order._id);
    return {
      ...summarize(order, { skipped: true }),
      reason: "no_claimable_delivery",
      order,
    };
  }

  const rolesToSend = {
    customer: Boolean(claims.customer),
    vendor: Boolean(
      claims.vendor && !vendorResolution.error && vendorResolution.recipients.length
    ),
  };
  let providerResults = {};
  try {
    providerResults = await sendOrderPaidEmails({
      order,
      currency: currency || order.currency || "usd",
      customerEmails,
      vendorEmails: vendorResolution.recipients || [],
      roles: rolesToSend,
    });
  } catch {
    providerResults = {};
    for (const role of ["customer", "vendor"]) {
      if (claims[role]) providerResults[role] = safeFailure("email_orchestration_failed");
    }
  }

  if (claims.vendor && vendorResolution.error) {
    providerResults.vendor = safeFailure(vendorResolution.error);
  } else if (claims.vendor && !vendorResolution.recipients.length) {
    providerResults.vendor = vendorResolution.reason === "vendor_preference_disabled"
      ? {
          status: "skipped",
          reason: vendorResolution.reason,
          recipientCount: 0,
          preferenceAllowed: false,
          ownerSuppressed: Boolean(vendorResolution.ownerSuppressed),
        }
      : safeFailure(vendorResolution.reason || "missing_recipient");
  } else if (claims.vendor && providerResults.vendor) {
    providerResults.vendor = {
      ...providerResults.vendor,
      ...(vendorResolution.reason ? { reason: vendorResolution.reason } : {}),
      preferenceAllowed: vendorResolution.preferenceAllowed,
      ownerSuppressed: Boolean(vendorResolution.ownerSuppressed),
    };
  }

  for (const role of ["customer", "vendor"]) {
    if (!claims[role]) continue;
    const result = providerResults?.[role] || safeFailure("email_provider_result_missing");
    const finalized = await finalizeRole(order._id, role, claims[role], result);
    if (finalized) await logRoleResult(finalized, role, result);
  }

  await markAggregateCompleteIfReady(order._id);
  order = await loadOrderForPaidConfirmation(order._id);
  const summary = summarize(order, {
    sent: Object.values(providerResults).some(
      (result) => result?.status === "sent" || result?.status === "partial"
    ),
    skipped: Object.values(providerResults).some((result) => result?.status === "skipped"),
    failed: Object.values(providerResults).some((result) => result?.status === "failed"),
  });

  if (summary.emailWarning) {
    console.error("Paid-order email delivery incomplete", {
      orderId: String(order._id),
      customerStatus: summary.customer?.status,
      vendorStatus: summary.vendor?.status,
    });
  }

  return { ...summary, order };
}

module.exports = {
  PAID_CONFIRMATION_POPULATE,
  loadOrderForPaidConfirmation,
  publicPaidOrderEmailDelivery,
  sendOrderPaidConfirmationIfNeeded,
  summarizePaidOrderEmailDelivery: summarize,
};
