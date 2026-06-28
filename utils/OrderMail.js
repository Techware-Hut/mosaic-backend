// mailer/orderPaid.js
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const { renderInvoicePdfBufferForOrder } = require("../services/invoiceService");
const { buildFrontendUrl, getFrontendLogoUrl } = require("./frontendUrl");

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.MAIL_USER;
const LOGO_URL = getFrontendLogoUrl();

const transporter =
  global.__MAILER__ ||
  nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
  });

const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const CURRENCY_MINOR_DIGITS = {
  USD: 2, INR: 2, EUR: 2, GBP: 2, AED: 2, AUD: 2, CAD: 2, JPY: 0, KWD: 3,
};

function minorDigits(currency = 'USD') {
  const c = String(currency || 'USD').toUpperCase();
  return CURRENCY_MINOR_DIGITS[c] ?? 2;
}

function toMajor(minor, currency = 'USD') {
  const d = minorDigits(currency);
  return Number(minor || 0) / Math.pow(10, d);
}

function fmt(amountMajor, currency = 'USD', locale = 'en-US') {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amountMajor || 0));
  } catch {
    // fallback if currency code unknown
    return `${currency} ${Number(amountMajor || 0).toFixed(2)}`;
  }
}

async function fetchImageBuffer(url) {
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    return Buffer.from(data);
  } catch {
    return null; // gracefully skip logo if it fails
  }
}

/**
 * Build a production-grade invoice PDF.
 * - order.totalAmount is assumed to be in MINOR units (e.g., paise).
 * - order.items[i].price is treated as MAJOR (unit price captured at purchase).
 * Returns: Buffer
 */
async function buildInvoicePdf({ order }) {
  if (!order) throw new Error('order is required');

  // --- Prep data safely ---
  const currency = (order.currency || 'USD').toUpperCase();
  const orderNo = order.groupOrderId || String(order._id || '');
  const orderDate = new Date(order.updatedAt || order.createdAt || Date.now());
  const business = order.businessId || {};
  const customer = order.userId || {};
  const ship = order.shippingAddress || {};

  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  const isPaid = paymentStatus === 'paid' || order.status === 'delivered' || order.status === 'accepted';

  const items = Array.isArray(order.items) ? order.items : [];

  // --- Money calc ---
  let subtotalMajor = 0;
  const normalizedItems = items.map((it) => {
    const name = it?.productId?.title || it?.productId?.name || 'Item';
    const options = [it?.size, it?.color].filter(Boolean).join(' / ');
    const sku = it?.sku || '';
    const qty = Number(it?.quantity || 1);
    const unitMajor = Number(it?.price || 0); // unit price in MAJOR currency
    const lineMajor = unitMajor * qty;
    subtotalMajor += lineMajor;
    return { name, options, sku, qty, unitMajor, lineMajor };
  });

  const totalMajor = toMajor(order.totalAmount || 0, currency);

  // Reconcile differences (e.g., tax/discount/shipping applied server-side)
  // Only show if there is a non-trivial diff ≥ 0.01 major units.
  const diffMajor = Number((totalMajor - subtotalMajor).toFixed(2));
  const showAdjustments = Math.abs(diffMajor) >= 0.01;

  // --- PDF doc plumbing ---
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // --- Header with logo + invoice meta ---
  const logoBuf = await fetchImageBuffer(LOGO_URL);
  const headerTop = 40;
  let y = headerTop;

  if (logoBuf) {
    doc.image(logoBuf, 40, y, { width: 120 });
  } else {
    // Text fallback if logo not available
    doc.fontSize(18).fillColor('#111').text('Mosaic Biz Hub', 40, y);
  }

  // Right-side invoice block
  const metaX = 360;
  doc
    .fontSize(20)
    .fillColor('#111')
    .text('INVOICE', metaX, y, { align: 'right', width: 195 });

  y += 8;
  doc
    .fontSize(10)
    .fillColor('#666')
    .text(`Invoice #: ${orderNo}`, metaX, y + 26, { align: 'right', width: 195 })
    .text(`Date: ${orderDate.toLocaleDateString()}`, metaX, doc.y, { align: 'right', width: 195 })
    .text(`Payment: ${isPaid ? 'PAID' : (paymentStatus || 'PENDING').toUpperCase()}`, metaX, doc.y, { align: 'right', width: 195 });

  // Paid/Due badge
  const badgeW = 70, badgeH = 18;
  const badgeX = metaX + 125, badgeY = headerTop + 4;
  doc
    .roundedRect(badgeX, badgeY, badgeW, badgeH, 4)
    .fill(isPaid ? '#16a34a' : '#f59e0b');
  doc
    .fillColor('#fff')
    .fontSize(10)
    .text(isPaid ? 'PAID' : 'DUE', badgeX, badgeY + 4, { width: badgeW, align: 'center' });

  // --- Addresses (two columns) ---
  y = 110;
  const colW = 260;
  doc.fillColor('#111').fontSize(12).text('Billed To', 40, y, { underline: true });
  doc.fontSize(10).fillColor('#333');
  const billLines = [
    customer.name || customer.fullName || 'Customer',
    customer.email || '',
    [ship.fullName, ship.addressLine1, ship.addressLine2, ship.city, ship.state, ship.pincode, ship.country]
      .filter(Boolean)
      .join(', ')
  ].filter(Boolean);
  billLines.forEach((line) => doc.text(line, 40, doc.y, { width: colW }));

  const rightX = 320;
  doc.fillColor('#111').fontSize(12).text('Seller', rightX, y, { underline: true });
  doc.fontSize(10).fillColor('#333');
  const sellerLines = [
    business.businessName || 'Vendor',
    business.email || '',
    business.address
      ? [business.address.street, business.address.city, business.address.state, business.address.zipCode, business.address.country]
        .filter(Boolean)
        .join(', ')
      : null
  ].filter(Boolean);
  sellerLines.forEach((line) => doc.text(line, rightX, doc.y, { width: colW }));

  // Separator
  y = Math.max(doc.y + 10, 170);
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#e5e7eb').stroke();

  // --- Items table ---
  y += 15;
  const cols = [
    { key: 'name', label: 'Item', x: 40, width: 200 },
    { key: 'sku', label: 'SKU', x: 245, width: 70 },
    { key: 'options', label: 'Options', x: 320, width: 100 },
    { key: 'qty', label: 'Qty', x: 425, width: 35, align: 'right' },
    { key: 'unitMajor', label: 'Unit', x: 465, width: 70, align: 'right', format: (v) => fmt(v, currency) },
    { key: 'lineMajor', label: 'Total', x: 540, width: 55, align: 'right', format: (v) => fmt(v, currency) }
  ];

  // Header row background
  doc.save();
  doc.rect(40, y - 3, 515, 20).fill('#f3f4f6').restore();
  doc.fontSize(10).fillColor('#111');
  cols.forEach((c) => {
    doc.text(c.label, c.x, y, { width: c.width, align: c.align || 'left' });
  });
  y += 20;
  doc.moveTo(40, y).lineTo(555, y).strokeColor('#e5e7eb').stroke();

  // Rows
  const rowPadY = 6;
  normalizedItems.forEach((row, idx) => {
    const heights = cols.map((c) => {
      const val = c.format ? c.format(row[c.key]) : row[c.key];
      return doc.heightOfString(String(val ?? ''), { width: c.width });
    });
    const rowH = Math.max(16, ...heights) + rowPadY;

    // Page break if needed
    if (y + rowH > doc.page.height - 120) {
      doc.addPage();
      y = 60;

      // repeat header on new page
      doc.rect(40, y - 3, 515, 20).fill('#f3f4f6');
      doc.fillColor('#111').fontSize(10);
      cols.forEach((c) => {
        doc.text(c.label, c.x, y, { width: c.width, align: c.align || 'left' });
      });
      y += 20;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#e5e7eb').stroke();
    }

    doc.fillColor('#111');
    cols.forEach((c) => {
      const raw = row[c.key];
      const val = c.format ? c.format(raw) : raw;
      doc.text(String(val ?? ''), c.x, y + rowPadY / 2, { width: c.width, align: c.align || 'left' });
    });

    y += rowH;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#f3f4f6').stroke();
  });

  // --- Totals box (right aligned) ---
  y += 15;
  const totalsX = 360;
  const totalsW = 195;

  function totLine(label, value, bold = false) {
    doc.fontSize(bold ? 11 : 10).fillColor('#111');
    const currentY = doc.y;
    doc.text(label, totalsX, currentY, { width: 110, align: 'right' });
    doc.text(fmt(value, currency), totalsX + 115, currentY, { width: 80, align: 'right' });
  }

  doc.rect(totalsX, y - 6, totalsW, 60 + (showAdjustments ? 18 : 0)).strokeColor('#e5e7eb').stroke();

  doc.y = y;
  totLine('Subtotal', Number(subtotalMajor.toFixed(2)));
  if (showAdjustments) {
    totLine('Adjustments', diffMajor); // can be +/-
  }
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#111').text('Grand Total', totalsX, doc.y, { width: 110, align: 'right' });
  doc.fontSize(11).text(fmt(totalMajor, currency), totalsX + 115, doc.y - 12, { width: 80, align: 'right' });

  // Amount due (simple: 0 if paid, else total)
  doc.moveDown(0.6);
  const due = isPaid ? 0 : totalMajor;
  doc.fontSize(10).fillColor('#666');
  doc.text('Amount Due', totalsX, doc.y, { width: 110, align: 'right' });
  doc.text(fmt(due, currency), totalsX + 115, doc.y - 12, { width: 80, align: 'right' });

  // --- Footer ---
  doc.moveDown(2);
  doc.strokeColor('#e5e7eb').moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.6);
  doc.fontSize(9).fillColor('#666');
  doc.text(`Payment ID: ${order.paymentId || '—'}`);
  doc.text(`Support: ${SUPPORT_EMAIL}`);
  doc.text(`Thank you for your purchase!`, { align: 'right' });

  doc.end();
  return done;
}

function baseLayout({ heading, introHtml, ctaHref, ctaText }) {
  return `
  <div style="margin:0;padding:0;background:#f6f8fa;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;">
      <tr><td align="center" style="padding:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td align="center" style="padding:24px 24px 8px;">
            <img src="cid:platformLogo" alt="Mosaic Biz Hub" width="120" style="display:block;margin:0 auto 8px;" />
            <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;margin:12px 0 0;color:#111827;">${heading}</h1>
            ${introHtml || ""}
            ${ctaHref ? `<div style="height:8px;"></div><a href="${ctaHref}" style="display:inline-block;background:#0d6efd;color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;padding:10px 16px;border-radius:8px;">${escapeHtml(ctaText || "Open Dashboard")}</a>` : ""}
          </td></tr>
          <tr><td align="center" style="padding:16px;background:#f9fafb;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;margin:0;">&copy; ${new Date().getFullYear()} Mosaic Biz Hub. All rights reserved.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

function customerIntro({ order, businessName }) {
  const orderNo = order.groupOrderId || order._id?.toString();
  return `
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#374151;margin:8px 0 0;">
    Hi ${escapeHtml(order.userId?.name || "there")},<br/>
    Your payment to <strong>${escapeHtml(businessName)}</strong> is confirmed. Order <strong>#${escapeHtml(orderNo)}</strong> is now placed.
  </p>
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6b7280;margin:10px 0 0;">
    We've attached your invoice (PDF). You can view your order any time from your account.
  </p>`;
}

function vendorIntro({ order, businessName }) {
  const orderNo = order.groupOrderId || order._id?.toString();
  const itemCount = (order.items || []).reduce((n, it) => n + Number(it.quantity || 1), 0);
  return `
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#374151;margin:8px 0 0;">
    Hi ${escapeHtml(businessName)},<br/>
    You received a <strong>paid order</strong> <strong>#${escapeHtml(orderNo)}</strong> with ${itemCount} item${itemCount === 1 ? "" : "s"}.
  </p>
  <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6b7280;margin:10px 0 0;">
    The customer invoice is attached. Manage this order in your Partners dashboard.
  </p>`;
}

/**
 * Send order-paid emails to customer + vendor with a PDF invoice.
 * Expects order populated with: userId{name,email}, vendorId{name,email}, businessId{businessName,slug,email,owner{email}}, items.productId{name|title}
 */
exports.sendOrderPaidEmails = async ({ order, currency, customerEmails = [], vendorEmails = [] }) => {
  console.log("Preparing order-paid emails", {
    orderId: order?._id?.toString?.() || null,
    groupOrderId: order?.groupOrderId || null,
    currency,
    customerRecipientCount: customerEmails.length,
    vendorRecipientCount: vendorEmails.length,
  });

  const businessName = order.businessId?.businessName || "Vendor";
  const businessSlug = order.businessId?.slug || "";
  const customerOrdersUrl = buildFrontendUrl("/customer/order");
  const partnerOrdersUrl = businessSlug
    ? buildFrontendUrl(`/partners/${encodeURIComponent(businessSlug)}/orders`)
    : buildFrontendUrl("/partners/dashboard");

  // Build PDF once
  const pdf = await renderInvoicePdfBufferForOrder(order);
  const invoiceFileName = `invoice-${order.groupOrderId || order._id}.pdf`;

  const attachments = [
    { filename: "logo.png", path: LOGO_URL, cid: "platformLogo" },
    { filename: invoiceFileName, content: pdf, contentType: "application/pdf" },
  ];

  // CUSTOMER EMAIL
  if (customerEmails.length) {
    const customerHtml = baseLayout({
      heading: "🧾 Payment received — your order is confirmed",
      introHtml: customerIntro({ order, businessName }),
      ctaHref: customerOrdersUrl,
      ctaText: "View Your Order",
    });
    const orderNo = order.groupOrderId || order._id?.toString();
    const customerText = [
      `Hi ${order.userId?.name || "there"},`,
      ``,
      `Your payment to ${businessName} is confirmed.`,
      `Order #${orderNo} is placed.`,
      `View your order: ${customerOrdersUrl}`,
      ``,
      `Invoice attached (PDF).`,
      ``,
      `— Mosaic Biz Hub Team`,
    ].join("\n");

    await transporter.sendMail({
      from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
      to: customerEmails,
      subject: `✅ Order #${orderNo} confirmed`,
      text: customerText,
      html: customerHtml,
      attachments,
      headers: { "X-Entity-Ref-ID": `order-paid-customer-${order._id}-${Date.now()}` },
    });
  }

  // VENDOR EMAIL
  if (vendorEmails.length) {
    const vendorHtml = baseLayout({
      heading: "💸 You’ve received a paid order",
      introHtml: vendorIntro({ order, businessName }),
      ctaHref: partnerOrdersUrl,
      ctaText: "Open Partners Dashboard",
    });
    const orderNo = order.groupOrderId || order._id?.toString();
    const vendorText = [
      `Hi ${businessName},`,
      ``,
      `You received a paid order #${orderNo}.`,
      `Manage: ${partnerOrdersUrl}`,
      ``,
      `Customer invoice attached (PDF).`,
      ``,
      `— Mosaic Biz Hub Team`,
    ].join("\n");

    await transporter.sendMail({
      from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
      to: vendorEmails,
      subject: `🛍️ New paid order #${orderNo}`,
      text: vendorText,
      html: vendorHtml,
      attachments,
      headers: { "X-Entity-Ref-ID": `order-paid-vendor-${order._id}-${Date.now()}` },
    });
  }
};
