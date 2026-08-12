const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const helperPath = path.resolve(
  __dirname,
  "../../utils/sendOrderPaidConfirmation.js"
);

function getPath(target, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], target);
}

function setPath(target, dottedPath, value) {
  const keys = dottedPath.split(".");
  const last = keys.pop();
  let cursor = target;
  for (const key of keys) {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[last] = value;
}

function unsetPath(target, dottedPath) {
  const keys = dottedPath.split(".");
  const last = keys.pop();
  const parent = keys.reduce((value, key) => value?.[key], target);
  if (parent) delete parent[last];
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return String(left) === String(right);
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    if (Object.hasOwn(expected, "$exists")) {
      return expected.$exists ? actual !== undefined : actual === undefined;
    }
    if (Array.isArray(expected.$in)) {
      return expected.$in.some((candidate) => (
        candidate === null ? actual == null : sameValue(actual, candidate)
      ));
    }
    if (Array.isArray(expected.$nin)) {
      return !expected.$nin.some((candidate) => sameValue(actual, candidate));
    }
  }
  return expected === null ? actual == null : sameValue(actual, expected);
}

function matchesQuery(document, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "$or") {
      return expected.some((branch) => matchesQuery(document, branch));
    }
    return matchesValue(getPath(document, key), expected);
  });
}

function applyUpdate(document, update) {
  for (const [key, value] of Object.entries(update.$set || {})) {
    setPath(document, key, value);
  }
  for (const key of Object.keys(update.$unset || {})) {
    unsetPath(document, key);
  }
  for (const [key, value] of Object.entries(update.$inc || {})) {
    setPath(document, key, Number(getPath(document, key) || 0) + Number(value));
  }
}

function sentResult(role, overrides = {}) {
  return {
    status: "sent",
    provider: "smtp",
    messageId: `<${role}-message@mosaic.test>`,
    recipientCount: 1,
    acceptedCount: 1,
    rejectedCount: 0,
    ...overrides,
  };
}

function defaultMailResult(payload) {
  return {
    ...(payload.roles.customer
      ? {
          customer: payload.customerEmails.length
            ? sentResult("customer")
            : {
                status: "failed",
                reason: "missing_recipient",
                error: "missing_recipient",
                recipientCount: 0,
              },
        }
      : {}),
    ...(payload.roles.vendor
      ? {
          vendor: payload.vendorEmails.length
            ? sentResult("vendor", {
                recipientCount: payload.vendorEmails.length,
                acceptedCount: payload.vendorEmails.length,
              })
            : {
                status: "failed",
                reason: "missing_recipient",
                error: "missing_recipient",
                recipientCount: 0,
              },
        }
      : {}),
  };
}

function loadHelper({
  order: orderOverrides = {},
  mailPlan = [],
  preferencePlan = [],
  staleFinalizeRole = null,
  closeBeforeFirstClaim = false,
  orderExists = true,
} = {}) {
  const mailCalls = [];
  const updateCalls = [];
  const lifecycleEntries = [];
  let staleInjected = false;
  let closeInjected = false;

  const order = {
    _id: "507f1f77bcf86cd799439099",
    paymentStatus: "paid",
    status: "ordered",
    paidConfirmationEmailSentAt: null,
    paidOrderEmailDelivery: {},
    currency: "usd",
    lifecycleEmailLog: [],
    userId: { name: "Casey", email: "customer@example.com" },
    vendorId: {
      _id: "507f1f77bcf86cd799439098",
      email: "vendor@example.com",
    },
    businessId: {
      businessName: "Shop Co",
      slug: "shop-co",
      email: "biz@example.com",
      owner: { email: "owner@example.com" },
    },
    items: [{ productId: { title: "Candle" }, quantity: 1 }],
    save: async function save() {
      return this;
    },
    ...orderOverrides,
  };

  const orderModel = {
    findById() {
      return {
        populate: async () => (orderExists ? order : null),
      };
    },
    async findOneAndUpdate(query, update) {
      updateCalls.push({ query, update });

      if (
        closeBeforeFirstClaim &&
        !closeInjected &&
        Object.keys(query).some((key) => key === 'status' || key.endsWith('.status')) &&
        query.status?.$nin
      ) {
        order.status = 'refunded';
        closeInjected = true;
      }

      if (staleFinalizeRole && !staleInjected) {
        const tokenPath = `paidOrderEmailDelivery.${staleFinalizeRole}.claimToken`;
        if (Object.hasOwn(query, tokenPath)) {
          setPath(order, tokenPath, "newer-worker-token");
          staleInjected = true;
        }
      }

      if (!matchesQuery(order, query)) return null;
      applyUpdate(order, update);
      return order;
    },
    async updateOne(query, update) {
      if (!matchesQuery(order, query)) return { matchedCount: 0, modifiedCount: 0 };
      const entry = update?.$push?.lifecycleEmailLog;
      if (entry) {
        order.lifecycleEmailLog.push(entry);
        lifecycleEntries.push(entry);
      }
      return { matchedCount: 1, modifiedCount: entry ? 1 : 0 };
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const normalized = String(request).replace(/\\/g, "/");
    if (
      normalized.endsWith("/models/Order") ||
      normalized.endsWith("/models/Order.js") ||
      request === "../models/Order"
    ) {
      return orderModel;
    }
    if (
      normalized.endsWith("/utils/OrderMail") ||
      normalized.endsWith("/utils/OrderMail.js") ||
      request === "./OrderMail"
    ) {
      return {
        sendOrderPaidEmails: async (payload) => {
          mailCalls.push(payload);
          const planned = mailPlan.length ? mailPlan.shift() : defaultMailResult;
          if (planned instanceof Error) throw planned;
          if (typeof planned === "function") return planned(payload);
          return planned;
        },
      };
    }
    if (
      normalized.endsWith("/utils/notificationPreferenceGate") ||
      request === "./notificationPreferenceGate"
    ) {
      return {
        resolveOrderPaidVendorEmailDelivery: async () => {
          const planned = preferencePlan.length
            ? preferencePlan.shift()
            : {
                recipients: ["vendor@example.com", "biz@example.com"],
                preferenceAllowed: true,
                ownerSuppressed: false,
                reason: null,
              };
          if (planned instanceof Error) throw planned;
          return typeof planned === "function" ? planned(order) : planned;
        },
      };
    }
    if (
      normalized.endsWith("/utils/orderLifecycleEmailDelivery") ||
      request === "./orderLifecycleEmailDelivery"
    ) {
      return {
        buildOrderLifecycleEmailFingerprint: (document, event, details) =>
          `${document._id}:${event}:${details.recipientRole}`,
        appendOrderLifecycleEmailLog: async (document, entry) => {
          const persisted = { ...entry, attemptedAt: new Date() };
          document.lifecycleEmailLog.push(persisted);
          lifecycleEntries.push(persisted);
          await document.save();
          return { logged: true };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[helperPath];
  const helper = require(helperPath);
  Module._load = originalLoad;

  return {
    helper,
    order,
    mailCalls,
    updateCalls,
    lifecycleEntries,
  };
}

test("persists independent provider evidence and the aggregate completion time", async () => {
  const harness = loadHelper({
    mailPlan: [() => ({
      customer: sentResult("customer", { messageId: "customer-provider-id" }),
      vendor: sentResult("vendor", {
        messageId: "vendor-provider-id",
        recipientCount: 2,
        acceptedCount: 2,
      }),
    })],
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(result.sent, true);
  assert.equal(result.emailFailed, false);
  assert.equal(harness.mailCalls.length, 1);
  assert.deepEqual(harness.mailCalls[0].roles, { customer: true, vendor: true });
  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "sent");
  assert.equal(harness.order.paidOrderEmailDelivery.customer.messageId, "customer-provider-id");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.messageId, "vendor-provider-id");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.recipientCount, 2);
  assert.equal(harness.order.paidOrderEmailDelivery.customer.claimToken, undefined);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.claimToken, undefined);
  assert.ok(harness.order.paidConfirmationEmailSentAt instanceof Date);
  assert.deepEqual(
    harness.lifecycleEntries.map((entry) => [entry.recipientRole, entry.deliveryStatus, entry.messageId]),
    [
      ["customer", "sent", "customer-provider-id"],
      ["vendor", "sent", "vendor-provider-id"],
    ]
  );
});

test("honors the legacy aggregate marker without sending again", async () => {
  const sentAt = new Date("2026-08-01T00:00:00.000Z");
  const harness = loadHelper({
    order: {
      paidConfirmationEmailSentAt: sentAt,
      paidOrderEmailDelivery: {},
    },
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(result.reason, "already_sent_legacy");
  assert.equal(result.skipped, true);
  assert.equal(result.emailSent, true);
  assert.equal(harness.mailCalls.length, 0);
  assert.equal(harness.updateCalls.length, 0);
});

test("does not claim or send for an unpaid order", async () => {
  const harness = loadHelper({ order: { paymentStatus: "pending" } });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(result.reason, "not_paid");
  assert.equal(result.skipped, true);
  assert.equal(harness.mailCalls.length, 0);
  assert.equal(harness.updateCalls.length, 0);
});

test("does not claim or send for an already-paid terminal order", async () => {
  const harness = loadHelper({
    order: { paymentStatus: "paid", status: "refunded" },
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(
    harness.order._id
  );

  assert.equal(result.reason, "order_terminal");
  assert.equal(result.skipped, true);
  assert.equal(result.emailFailed, false);
  assert.equal(harness.mailCalls.length, 0);
  assert.equal(harness.updateCalls.length, 0);
});

test("role claims lose to a concurrent terminal transition", async () => {
  const harness = loadHelper({ closeBeforeFirstClaim: true });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(
    harness.order._id
  );

  assert.equal(result.reason, "no_claimable_delivery");
  assert.equal(harness.order.status, "refunded");
  assert.equal(harness.mailCalls.length, 0);
  assert.equal(harness.order.paidOrderEmailDelivery.customer, undefined);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor, undefined);
  const claimQueries = harness.updateCalls.filter((call) => call.query.status?.$nin);
  assert.equal(claimQueries.length, 2);
});

test("a replay observes terminal role state and does not duplicate either email", async () => {
  const harness = loadHelper();

  await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);
  const replay = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(harness.mailCalls.length, 1);
  assert.equal(replay.reason, "no_claimable_delivery");
  assert.equal(replay.skipped, true);
  assert.equal(replay.emailSent, true);
  assert.equal(harness.order.paidOrderEmailDelivery.customer.attemptCount, 1);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.attemptCount, 1);
});

test("a replay repairs a missing aggregate marker after both roles finalized", async () => {
  const completedAt = new Date("2026-08-12T12:00:00.000Z");
  const harness = loadHelper({
    order: {
      paidConfirmationEmailSentAt: null,
      paidOrderEmailDelivery: {
        version: 1,
        customer: { status: "sent", completedAt, sentAt: completedAt },
        vendor: { status: "sent", completedAt, sentAt: completedAt },
      },
    },
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(result.reason, "no_claimable_delivery");
  assert.equal(harness.mailCalls.length, 0);
  assert.ok(harness.order.paidConfirmationEmailSentAt instanceof Date);
});

test("retries only customer after customer failure and vendor success", async () => {
  const harness = loadHelper({
    mailPlan: [
      {
        customer: {
          status: "failed",
          provider: "smtp",
          error: "provider_connection_failed",
          recipientCount: 1,
        },
        vendor: sentResult("vendor"),
      },
      (payload) => ({ customer: sentResult("customer-retry") }),
    ],
  });

  const first = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);
  assert.equal(first.emailFailed, true);
  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "failed");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.status, "sent");
  assert.equal(harness.order.paidConfirmationEmailSentAt, null);

  const retry = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(retry.emailFailed, false);
  assert.deepEqual(harness.mailCalls[1].roles, { customer: true, vendor: false });
  assert.equal(harness.order.paidOrderEmailDelivery.customer.attemptCount, 2);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.attemptCount, 1);
  assert.equal(harness.order.paidOrderEmailDelivery.customer.messageId, "<customer-retry-message@mosaic.test>");
  assert.ok(harness.order.paidConfirmationEmailSentAt instanceof Date);
});

test("retries only vendor after vendor failure and customer success", async () => {
  const harness = loadHelper({
    mailPlan: [
      {
        customer: sentResult("customer"),
        vendor: {
          status: "failed",
          provider: "smtp",
          error: "provider_send_failed",
          recipientCount: 2,
        },
      },
      () => ({ vendor: sentResult("vendor-retry", { recipientCount: 2 }) }),
    ],
  });

  await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);
  const retry = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.deepEqual(harness.mailCalls[1].roles, { customer: false, vendor: true });
  assert.equal(harness.order.paidOrderEmailDelivery.customer.attemptCount, 1);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.attemptCount, 2);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.messageId, "<vendor-retry-message@mosaic.test>");
  assert.equal(retry.emailFailed, false);
  assert.ok(harness.order.paidConfirmationEmailSentAt instanceof Date);
});

test("records preference-disabled vendor delivery as an intentional terminal skip", async () => {
  const harness = loadHelper({
    preferencePlan: [{
      recipients: [],
      reason: "vendor_preference_disabled",
      preferenceAllowed: false,
      ownerSuppressed: true,
    }],
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.deepEqual(harness.mailCalls[0].roles, { customer: true, vendor: false });
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.status, "skipped");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.reason, "vendor_preference_disabled");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.preferenceAllowed, false);
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.ownerSuppressed, true);
  assert.equal(result.emailSkipped, false);
  assert.equal(result.emailWarning, undefined);
  assert.ok(harness.order.paidConfirmationEmailSentAt instanceof Date);
});

test("records a missing customer recipient as a retryable failure", async () => {
  const harness = loadHelper({
    order: { userId: { name: "Guest without email" } },
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "failed");
  assert.equal(harness.order.paidOrderEmailDelivery.customer.reason, "missing_recipient");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.status, "sent");
  assert.equal(result.emailFailed, true);
  assert.equal(result.emailWarning, "paid_order_email_delivery_incomplete");
  assert.equal(harness.order.paidConfirmationEmailSentAt, null);
});

test("an unexpected mailer exception finalizes both owned claims as failed", async () => {
  const harness = loadHelper({
    mailPlan: [new Error("raw SMTP secret must not persist")],
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(result.failed, true);
  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "failed");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.status, "failed");
  assert.equal(harness.order.paidOrderEmailDelivery.customer.error, "email_orchestration_failed");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.error, "email_orchestration_failed");
  assert.doesNotMatch(JSON.stringify(harness.order), /raw SMTP secret/);
});

test("a preference lookup exception fails vendor but does not block customer", async () => {
  const harness = loadHelper({
    preferencePlan: [new Error("database details must not persist")],
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.deepEqual(harness.mailCalls[0].roles, { customer: true, vendor: false });
  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "sent");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.status, "failed");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.error, "vendor_preference_lookup_failed");
  assert.equal(result.emailFailed, true);
  assert.doesNotMatch(JSON.stringify(harness.order), /database details/);
});

test("persists partial provider acceptance as terminal evidence with a warning", async () => {
  const harness = loadHelper({
    mailPlan: [{
      customer: {
        ...sentResult("customer"),
        status: "partial",
        acceptedCount: 1,
        rejectedCount: 1,
        reason: "provider_partially_rejected_recipients",
      },
      vendor: sentResult("vendor"),
    }],
  });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);
  const replay = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "partial");
  assert.equal(harness.order.paidOrderEmailDelivery.customer.acceptedCount, 1);
  assert.equal(harness.order.paidOrderEmailDelivery.customer.rejectedCount, 1);
  assert.equal(result.emailWarning, "paid_order_email_delivery_incomplete");
  assert.equal(result.emailFailed, false);
  assert.ok(harness.order.paidConfirmationEmailSentAt instanceof Date);
  assert.equal(replay.reason, "no_claimable_delivery");
  assert.equal(harness.mailCalls.length, 1);
});

test("stale claim token cannot overwrite a newer customer claim", async () => {
  const harness = loadHelper({ staleFinalizeRole: "customer" });

  const result = await harness.helper.sendOrderPaidConfirmationIfNeeded(harness.order._id);

  assert.equal(harness.order.paidOrderEmailDelivery.customer.status, "processing");
  assert.equal(harness.order.paidOrderEmailDelivery.customer.claimToken, "newer-worker-token");
  assert.equal(harness.order.paidOrderEmailDelivery.vendor.status, "sent");
  assert.equal(
    harness.lifecycleEntries.some((entry) => entry.recipientRole === "customer"),
    false
  );
  assert.equal(result.emailWarning, "paid_order_email_delivery_incomplete");
  assert.equal(harness.order.paidConfirmationEmailSentAt, null);
});
