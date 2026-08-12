const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const mailerPath = path.resolve(__dirname, "../../utils/OrderMail.js");

const ENV_KEYS = [
  "MAIL_HOST",
  "MAIL_PORT",
  "MAIL_SECURE",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "MAIL_FROM",
  "SUPPORT_EMAIL",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function baseOrder(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439020",
    groupOrderId: "MBH-ORDER-001",
    userId: { name: "Customer User", email: "customer@example.com" },
    vendorId: "507f1f77bcf86cd799439021",
    businessId: {
      businessName: "Vendor Shop",
      slug: "vendor-shop",
      email: "orders@vendor.example",
      owner: { email: "owner@vendor.example" },
    },
    items: [
      { productId: { title: "Test Product" }, quantity: 1, price: 20 },
    ],
    totalAmount: 20,
    currency: "USD",
    paymentStatus: "paid",
    ...overrides,
  };
}

function loadOrderMailerWithMocks({
  createdConfigs = [],
  sentMessages = [],
  sendMail,
  renderInvoice,
} = {}) {
  let renderCount = 0;
  const nodemailerMock = {
    createTransport(config) {
      createdConfigs.push(config);
      return {
        sendMail: async (message) => {
          sentMessages.push(message);
          if (sendMail) return sendMail(message, sentMessages.length);
          return {
            messageId: `<message-${sentMessages.length}@mosaic.test>`,
            accepted: message.to,
            rejected: [],
          };
        },
      };
    },
  };

  const originalLoad = Module._load;
  const originalGlobalMailer = global.__MAILER__;
  delete global.__MAILER__;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "nodemailer") return nodemailerMock;
    if (request === "./frontendUrl") {
      return {
        buildFrontendUrl: (route = "/") =>
          `https://mosaicbizhub.com${route.startsWith("/") ? route : `/${route}`}`,
      };
    }
    if (request === "../services/invoiceService") {
      return {
        renderInvoicePdfBufferForOrder: async (order) => {
          renderCount += 1;
          if (renderInvoice) return renderInvoice(order);
          return Buffer.from("%PDF-1.4 test invoice");
        },
      };
    }
    if (request === "./emailLogoAttachment") {
      return {
        resolvePlatformLogoAttachment: async () => ({
          attachment: {
            filename: "logo.png",
            content: Buffer.from("logo"),
            cid: "platformLogo",
            contentType: "image/png",
          },
          logoSrcForHtml: "cid:platformLogo",
        }),
        withOptionalLogoAttachment: (attachments = [], logoAttachment) =>
          logoAttachment ? [logoAttachment, ...attachments] : attachments,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[mailerPath];
  const mailer = require(mailerPath);
  Module._load = originalLoad;
  if (originalGlobalMailer === undefined) delete global.__MAILER__;
  else global.__MAILER__ = originalGlobalMailer;

  return {
    mailer,
    createdConfigs,
    sentMessages,
    getRenderCount: () => renderCount,
  };
}

test("uses provider-neutral SMTP config and the configured MAIL_FROM", async () => {
  const savedEnv = snapshotEnv();
  process.env.MAIL_HOST = "smtp.resend.com";
  process.env.MAIL_PORT = "465";
  process.env.MAIL_SECURE = "true";
  process.env.MAIL_USER = "resend";
  process.env.MAIL_PASSWORD = "smtp-password";
  process.env.MAIL_FROM = "Mosaic Biz Hub <hello@mosaicbizhub.com>";
  process.env.SUPPORT_EMAIL = "support@mosaicbizhub.com";

  const harness = loadOrderMailerWithMocks();
  let results;
  try {
    results = await harness.mailer.sendOrderPaidEmails({
      order: baseOrder(),
      currency: "usd",
      customerEmails: ["customer@example.com"],
      vendorEmails: ["vendor@example.com", "orders@vendor.example"],
    });
  } finally {
    restoreEnv(savedEnv);
    delete require.cache[mailerPath];
  }

  assert.deepEqual(harness.createdConfigs[0], {
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: "smtp-password" },
  });
  assert.equal(harness.sentMessages.length, 2);
  assert.equal(harness.sentMessages[0].from, "Mosaic Biz Hub <hello@mosaicbizhub.com>");
  assert.equal(harness.sentMessages[1].from, "Mosaic Biz Hub <hello@mosaicbizhub.com>");
  assert.deepEqual(harness.sentMessages[0].to, ["customer@example.com"]);
  assert.deepEqual(harness.sentMessages[1].to, ["vendor@example.com", "orders@vendor.example"]);
  assert.equal(results.customer.messageId, "<message-1@mosaic.test>");
  assert.equal(results.vendor.messageId, "<message-2@mosaic.test>");
});

test("returns provider IDs and explicit partial-rejection evidence", async () => {
  const harness = loadOrderMailerWithMocks({
    sendMail: async (_message, callNumber) => callNumber === 1
      ? {
          messageId: "customer-provider-id",
          accepted: ["customer@example.com"],
          rejected: [],
        }
      : {
          messageId: "vendor-provider-id",
          accepted: ["vendor@example.com"],
          rejected: ["orders@vendor.example"],
        },
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    currency: "usd",
    customerEmails: ["customer@example.com"],
    vendorEmails: ["vendor@example.com", "orders@vendor.example"],
  });

  assert.deepEqual(results.customer, {
    status: "sent",
    provider: "smtp",
    recipientCount: 1,
    acceptedCount: 1,
    rejectedCount: 0,
    messageId: "customer-provider-id",
    reason: null,
  });
  assert.deepEqual(results.vendor, {
    status: "partial",
    provider: "smtp",
    recipientCount: 2,
    acceptedCount: 1,
    rejectedCount: 1,
    messageId: "vendor-provider-id",
    reason: "provider_partially_rejected_recipients",
  });
});

test("classifies an all-recipient provider rejection as failed", async () => {
  const harness = loadOrderMailerWithMocks({
    sendMail: async () => ({
      messageId: "rejected-message-id",
      accepted: [],
      rejected: ["customer@example.com"],
    }),
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: ["customer@example.com"],
    vendorEmails: [],
    roles: { customer: true, vendor: false },
  });

  assert.equal(results.customer.status, "failed");
  assert.equal(results.customer.error, "provider_rejected_all_recipients");
  assert.equal(results.customer.messageId, "rejected-message-id");
  assert.equal(results.customer.acceptedCount, 0);
  assert.equal(results.customer.rejectedCount, 1);
});

test("does not report success when the provider accepts no recipients", async () => {
  const harness = loadOrderMailerWithMocks({
    sendMail: async () => ({
      messageId: "empty-acceptance-id",
      accepted: [],
      rejected: [],
    }),
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: ["customer@example.com"],
    vendorEmails: [],
    roles: { customer: true, vendor: false },
  });

  assert.equal(results.customer.status, "failed");
  assert.equal(results.customer.error, "provider_accepted_no_recipients");
  assert.equal(results.customer.acceptedCount, 0);
  assert.equal(results.customer.rejectedCount, 0);
});

test("marks provider acceptance without recipient evidence as unverified", async () => {
  const harness = loadOrderMailerWithMocks({
    sendMail: async () => ({ messageId: "provider-queued-id" }),
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: ["customer@example.com"],
    vendorEmails: [],
    roles: { customer: true, vendor: false },
  });

  assert.deepEqual(results.customer, {
    status: "partial",
    provider: "smtp",
    recipientCount: 1,
    rejectedCount: 0,
    messageId: "provider-queued-id",
    reason: "provider_acceptance_unverified",
  });
});

test("marks provider under-acceptance as partial without an explicit rejection", async () => {
  const harness = loadOrderMailerWithMocks({
    sendMail: async () => ({
      messageId: "provider-under-accepted-id",
      accepted: ["vendor@example.com"],
      rejected: [],
    }),
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: [],
    vendorEmails: ["vendor@example.com", "orders@vendor.example"],
    roles: { customer: false, vendor: true },
  });

  assert.equal(results.vendor.status, "partial");
  assert.equal(results.vendor.acceptedCount, 1);
  assert.equal(results.vendor.recipientCount, 2);
  assert.equal(results.vendor.reason, "provider_partially_accepted_recipients");
});

test("sanitizes a raw SMTP error and still attempts the other role", async () => {
  const harness = loadOrderMailerWithMocks({
    sendMail: async (_message, callNumber) => {
      if (callNumber === 1) {
        const error = new Error("535 bad password super-secret-value");
        error.code = "EAUTH";
        throw error;
      }
      return {
        messageId: "vendor-accepted-id",
        accepted: ["vendor@example.com"],
        rejected: [],
      };
    },
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: ["customer@example.com"],
    vendorEmails: ["vendor@example.com"],
  });

  assert.equal(harness.sentMessages.length, 2);
  assert.equal(results.customer.status, "failed");
  assert.equal(results.customer.error, "provider_authentication_failed");
  assert.equal(results.vendor.status, "sent");
  assert.equal(results.vendor.messageId, "vendor-accepted-id");
  assert.doesNotMatch(JSON.stringify(results), /super-secret-value|bad password/);
});

test("still sends customer and vendor email when invoice rendering fails", async () => {
  const harness = loadOrderMailerWithMocks({
    renderInvoice: async () => {
      throw new Error("/private/runtime/path/lib-secret.so missing");
    },
  });

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: ["customer@example.com"],
    vendorEmails: ["vendor@example.com"],
  });

  assert.equal(harness.getRenderCount(), 1);
  assert.equal(harness.sentMessages.length, 2);
  assert.equal(results.invoiceAttachment.status, "failed");
  assert.equal(results.invoiceAttachment.error, "invoice_generation_failed");
  assert.equal(results.customer.status, "sent");
  assert.equal(results.vendor.status, "sent");
  for (const message of harness.sentMessages) {
    const pdfAttachments = (message.attachments || []).filter(
      (part) => part.contentType === "application/pdf"
    );
    assert.equal(pdfAttachments.length, 0);
  }
  assert.doesNotMatch(JSON.stringify(results), /private|lib-secret/);
  assert.doesNotMatch(
    harness.sentMessages[0].text,
    /Invoice attached \(PDF\)/i
  );
});

test("missing recipients fail without rendering an invoice", async () => {
  const harness = loadOrderMailerWithMocks();

  const results = await harness.mailer.sendOrderPaidEmails({
    order: baseOrder(),
    customerEmails: [],
    vendorEmails: [],
  });

  assert.equal(harness.getRenderCount(), 0);
  assert.equal(harness.sentMessages.length, 0);
  assert.equal(results.customer.status, "failed");
  assert.equal(results.customer.reason, "missing_recipient");
  assert.equal(results.vendor.status, "failed");
  assert.equal(results.vendor.reason, "missing_recipient");
});
