const PDFDocument = require("pdfkit");
const Order = require("../models/Order");

function formatMoney(value, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
    }).format(Number(value || 0));
  } catch {
    return `${String(currency || "USD").toUpperCase()} ${Number(value || 0).toFixed(2)}`;
  }
}

/** Order.totalAmount is an explicit major-currency-unit schema contract. */
function normalizeOrderTotalMajor(order) {
  const stored = Number(order?.totalAmount || 0);
  return Number.isFinite(stored) ? stored : 0;
}

function lineItemsFor(order) {
  return (Array.isArray(order?.items) ? order.items : []).map((item) => {
    const quantity = Math.max(1, Number(item?.quantity || 1));
    const unitPrice = Number(item?.price || 0);
    return {
      name: item?.productId?.title || item?.productId?.name || "Item",
      detail: [item?.size, item?.color, item?.sku].filter(Boolean).join(" / "),
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
    };
  });
}

function paymentPresentation(paymentStatus) {
  switch (String(paymentStatus || "").toLowerCase()) {
    case "paid":
      return { label: "PAID", color: "#15803d", amountDueIsZero: true };
    case "refunded":
      return { label: "REFUNDED", color: "#1d4ed8", amountDueIsZero: true };
    case "failed":
      return { label: "PAYMENT FAILED", color: "#b91c1c", amountDueIsZero: false };
    default:
      return { label: "PAYMENT PENDING", color: "#b45309", amountDueIsZero: false };
  }
}

function writeAddress(doc, title, lines, x, y, width) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(title, x, y, { width });
  doc.font("Helvetica").fontSize(9).fillColor("#374151");
  lines.filter(Boolean).forEach((line) => doc.text(String(line), x, doc.y + 2, { width }));
}

/**
 * Render an invoice with PDFKit only. This deliberately has no browser,
 * executable, remote-image, or native shared-library runtime dependency.
 */
async function renderInvoicePdfBufferForOrder(order) {
  if (!order) throw new Error("order is required");

  const currency = String(order.currency || "USD").toUpperCase();
  const items = lineItemsFor(order);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const total = normalizeOrderTotalMajor(order);
  const adjustment = Number((total - subtotal).toFixed(2));
  const payment = paymentPresentation(order.paymentStatus);
  const business = order.businessId || {};
  const customer = order.userId || {};
  const shipping = order.shippingAddress || {};

  const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827").text("Mosaic Biz Hub", 44, 42);
  doc.fontSize(24).text("INVOICE", 350, 42, { width: 200, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#4b5563");
  doc.text(`Order: ${order.groupOrderId || order._id || ""}`, 350, 76, { width: 200, align: "right" });
  doc.text(`Date: ${new Date(order.updatedAt || order.createdAt || Date.now()).toLocaleDateString("en-US")}`, 350, 90, { width: 200, align: "right" });
  doc.font("Helvetica-Bold").fillColor(payment.color);
  doc.text(payment.label, 350, 104, { width: 200, align: "right" });

  const shippingLine = [
    shipping.addressLine1,
    shipping.addressLine2,
    shipping.city,
    shipping.state,
    shipping.pincode,
    shipping.country,
  ].filter(Boolean).join(", ");
  writeAddress(doc, "BILLED TO", [customer.name || shipping.fullName || "Customer", customer.email, shippingLine], 44, 140, 235);
  writeAddress(doc, "SELLER", [business.businessName || "Vendor", business.email], 315, 140, 235);

  let y = Math.max(doc.y + 28, 225);
  const drawHeader = () => {
    doc.rect(44, y, 506, 22).fill("#f3f4f6");
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
    doc.text("ITEM", 52, y + 7, { width: 245 });
    doc.text("QTY", 310, y + 7, { width: 42, align: "right" });
    doc.text("UNIT", 365, y + 7, { width: 78, align: "right" });
    doc.text("TOTAL", 455, y + 7, { width: 87, align: "right" });
    y += 28;
  };
  drawHeader();

  for (const item of items) {
    const rowHeight = 28 + (item.detail ? 12 : 0);
    if (y + rowHeight > doc.page.height - 150) {
      doc.addPage();
      y = 52;
      drawHeader();
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827").text(item.name, 52, y, { width: 245 });
    if (item.detail) {
      doc.font("Helvetica").fontSize(8).fillColor("#6b7280").text(item.detail, 52, y + 13, { width: 245 });
    }
    doc.font("Helvetica").fontSize(9).fillColor("#111827");
    doc.text(String(item.quantity), 310, y, { width: 42, align: "right" });
    doc.text(formatMoney(item.unitPrice, currency), 365, y, { width: 78, align: "right" });
    doc.text(formatMoney(item.lineTotal, currency), 455, y, { width: 87, align: "right" });
    y += rowHeight;
    doc.moveTo(44, y - 5).lineTo(550, y - 5).strokeColor("#e5e7eb").stroke();
  }

  y += 12;
  const totalLine = (label, value, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#111827");
    doc.text(label, 350, y, { width: 95, align: "right" });
    doc.text(formatMoney(value, currency), 455, y, { width: 87, align: "right" });
    y += bold ? 20 : 16;
  };
  totalLine("Subtotal", subtotal);
  if (Math.abs(adjustment) >= 0.01) totalLine("Adjustments", adjustment);
  totalLine("Grand total", total, true);
  totalLine("Amount due", payment.amountDueIsZero ? 0 : total);

  doc.font("Helvetica").fontSize(8).fillColor("#6b7280");
  doc.text(`Payment reference: ${order.paymentId || "-"}`, 44, doc.page.height - 78, { width: 506 });
  doc.text("Thank you for supporting independent businesses.", 44, doc.page.height - 63, { width: 506 });

  doc.end();
  return completed;
}

async function renderInvoicePdfById(orderId) {
  const order = await Order.findById(orderId)
    .populate({ path: "userId", select: "name email" })
    .populate({ path: "businessId", select: "businessName email address slug" })
    .populate({ path: "items.productId", select: "title name" })
    .lean();

  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  return renderInvoicePdfBufferForOrder(order);
}

module.exports = {
  normalizeOrderTotalMajor,
  paymentPresentation,
  renderInvoicePdfBufferForOrder,
  renderInvoicePdfById,
};
