const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const invoiceServicePath = path.resolve(
  __dirname,
  "../../services/invoiceService.js"
);

function loadBrowserFreeInvoiceService() {
  const originalLoad = Module._load;
  Module._load = function guardedLoad(request, parent, isMain) {
    const normalized = String(request).replace(/\\/g, "/");
    if (
      request === "puppeteer" ||
      normalized.endsWith("/utils/pdfFromHtml") ||
      normalized.endsWith("/utils/invoiceHtml")
    ) {
      throw new Error(`Browser-backed invoice dependency loaded: ${request}`);
    }
    if (
      normalized.endsWith("/models/Order") ||
      normalized.endsWith("/models/Order.js") ||
      request === "../models/Order"
    ) {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[invoiceServicePath];
  try {
    return require(invoiceServicePath);
  } finally {
    Module._load = originalLoad;
  }
}

function paidOrder(overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439020",
    groupOrderId: "MBH-PDF-001",
    userId: { name: "QA Customer", email: "qa-customer@example.com" },
    businessId: {
      businessName: "QA Vendor",
      email: "qa-vendor@example.com",
    },
    shippingAddress: {
      addressLine1: "123 Test Street",
      city: "Testville",
      state: "NY",
      pincode: "10001",
      country: "US",
    },
    items: [
      {
        productId: { title: "QA Product" },
        quantity: 2,
        price: 10,
      },
    ],
    totalAmount: 20,
    currency: "USD",
    paymentStatus: "paid",
    createdAt: new Date("2026-08-12T12:00:00.000Z"),
    paymentId: "pi_test_redacted",
    ...overrides,
  };
}

test("renders a valid invoice PDF without loading a browser runtime", async () => {
  const service = loadBrowserFreeInvoiceService();

  const pdf = await service.renderInvoicePdfBufferForOrder(paidOrder());

  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 1000);
});

test("normalizes current major-unit totals without dividing by 100", () => {
  const service = loadBrowserFreeInvoiceService();

  assert.equal(service.normalizeOrderTotalMajor(paidOrder({ totalAmount: 20 }), 20), 20);
  assert.equal(service.normalizeOrderTotalMajor(paidOrder({ totalAmount: 20.5 }), 20.5), 20.5);
});

test("preserves major-unit totals even when adjustments exceed the item subtotal", () => {
  const service = loadBrowserFreeInvoiceService();

  assert.equal(service.normalizeOrderTotalMajor(paidOrder({ totalAmount: 200 }), 20), 200);
  assert.equal(service.normalizeOrderTotalMajor(paidOrder({ totalAmount: 2000 }), 20), 2000);
});

test("uses truthful invoice payment labels and amount-due semantics", () => {
  const service = loadBrowserFreeInvoiceService();

  assert.deepEqual(service.paymentPresentation("paid"), {
    label: "PAID",
    color: "#15803d",
    amountDueIsZero: true,
  });
  assert.deepEqual(service.paymentPresentation("refunded"), {
    label: "REFUNDED",
    color: "#1d4ed8",
    amountDueIsZero: true,
  });
  assert.equal(service.paymentPresentation("failed").label, "PAYMENT FAILED");
  assert.equal(service.paymentPresentation("failed").amountDueIsZero, false);
  assert.equal(service.paymentPresentation("pending").label, "PAYMENT PENDING");
});
