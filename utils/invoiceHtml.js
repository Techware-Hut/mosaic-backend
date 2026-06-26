// utils/invoiceHtml.js
const axios = require('axios');
const { getFrontendLogoUrl } = require('./frontendUrl');

const CURRENCY_MINOR_DIGITS = { USD: 2, INR: 2, EUR: 2, GBP: 2, AED: 2, AUD: 2, CAD: 2, JPY: 0, KWD: 3 };
const LOGO_URL = getFrontendLogoUrl();

const minorDigits = (c = 'USD') => CURRENCY_MINOR_DIGITS[String(c || 'USD').toUpperCase()] ?? 2;
// Smart converter: if a subtotal hint is provided, choose minor→major or pass-through (already major)
const toMajor = (minorOrMajor, c = 'USD', hintSubtotalMajor) => {
    const n = Number(minorOrMajor || 0);
    const d = minorDigits(c);
    const asMinor = n / Math.pow(10, d);
    if (typeof hintSubtotalMajor === 'number' && Number.isFinite(hintSubtotalMajor)) {
        const diffIfMinor = Math.abs(asMinor - hintSubtotalMajor);
        const diffIfMajor = Math.abs(n - hintSubtotalMajor);
        return diffIfMinor < diffIfMajor ? asMinor : n;
    }
    return asMinor;
};
const fmt = (v, c = 'USD', locale = 'en-US') => {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency: c }).format(Number(v || 0)); }
    catch { return `${c} ${Number(v || 0).toFixed(2)}`; }
};

function esc(s = '') {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function fetchImageDataUri(url) {
    try {
        const { data, headers } = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        const mime = headers['content-type'] || 'image/png';
        const b64 = Buffer.from(data).toString('base64');
        return `data:${mime};base64,${b64}`;
    } catch { return null; }
}

async function invoiceHtmlForOrder({ order }) {
    if (!order) throw new Error('order is required');

    const currency = (order.currency || 'USD').toUpperCase();
    const orderNo = order.groupOrderId || String(order._id || '');
    const orderDate = new Date(order.updatedAt || order.createdAt || Date.now());
    const business = order.businessId || {};
    const customer = order.userId || {};
    const ship = order.shippingAddress || {};

    const paymentStatus = String(order.paymentStatus || '').toLowerCase();
    const isPaid = paymentStatus === 'paid' || order.status === 'delivered' || order.status === 'accepted';

    const items = Array.isArray(order.items) ? order.items : [];

    let subtotalMajor = 0;
    const rows = items.map((it) => {
        const name = it?.productId?.title || it?.productId?.name || 'Item';
        const options = [it?.size, it?.color].filter(Boolean).join(' / ');
        const sku = it?.sku || '';
        const qty = Number(it?.quantity || 1);
        const unitMajor = Number(it?.price || 0); // unit price captured at purchase (MAJOR)
        const lineMajor = unitMajor * qty;
        subtotalMajor += lineMajor;
        return { name, options, sku, qty, unitMajor, lineMajor };
    });

    const totalMajor = toMajor(order.totalAmount || 0, currency, subtotalMajor);
    const diffMajor = Number((totalMajor - subtotalMajor).toFixed(2));
    const showAdj = Math.abs(diffMajor) >= 0.01;


    const logoDataUri = await fetchImageDataUri(LOGO_URL);

    const billToLines = [
        customer.name || customer.fullName || 'Customer',
        customer.email || '',
        [ship.fullName, ship.addressLine1, ship.addressLine2, ship.city, ship.state, ship.pincode, ship.country]
            .filter(Boolean).join(', ')
    ].filter(Boolean);

    const sellerLines = [
        business.businessName || 'Vendor',
        business.email || '',
        business.address
            ? [business.address.street, business.address.city, business.address.state, business.address.zipCode, business.address.country]
                .filter(Boolean).join(', ')
            : ''
    ].filter(Boolean);

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invoice ${esc(orderNo)}</title>
<style>
  :root{--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--bg:#ffffff;--accent:#0d6efd;--badgePaid:#16a34a;--badgeDue:#f59e0b;}
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
  .wrap{width:800px;margin:0 auto;padding:24px 28px}
  .header{display:flex;justify-content:space-between;align-items:flex-start}
  .logo{height:46px}.meta{text-align:right}.h1{font-size:24px;margin:4px 0 0}.muted{color:var(--muted);font-size:12px}
  .badge{display:inline-block;padding:4px 10px;border-radius:999px;color:#fff;font-size:11px;margin-top:6px}
  .paid{background:var(--badgePaid)}.due{background:var(--badgeDue)}
  .cols{display:flex;gap:24px;margin-top:24px}.col{flex:1} h3{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.03em}
  .card{border:1px solid var(--line);padding:12px;border-radius:8px}.sep{height:1px;background:var(--line);margin:20px 0}
  table{width:100%;border-collapse:collapse;font-size:12px} thead th{background:#f3f4f6;text-align:left;padding:10px;border-bottom:1px solid var(--line)}
  tbody td{padding:10px;border-bottom:1px solid #f3f4f6;vertical-align:top} td.r,th.r{text-align:right}
  .totals{margin-top:16px;margin-left:auto;width:360px;border:1px solid var(--line);border-radius:8px;padding:12px}
  .trow{display:flex;justify-content:space-between;margin:6px 0}.grand{font-weight:600;font-size:14px;margin-top:8px}
  .footer{margin-top:28px;padding-top:12px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);display:flex;justify-content:space-between}
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="Mosaic Biz Hub"/>` : `<div class="h1">Mosaic Biz Hub</div>`}</div>
      <div class="meta">
        <div class="h1">INVOICE</div>
        <div class="muted">Invoice #: ${esc(orderNo)}</div>
        <div class="muted">Date: ${esc(orderDate.toLocaleDateString())}</div>
        <span class="badge ${isPaid ? 'paid' : 'due'}">${isPaid ? 'PAID' : (paymentStatus || 'DUE').toUpperCase()}</span>
      </div>
    </div>

    <div class="cols">
      <div class="col"><h3>Billed To</h3><div class="card">${billToLines.map(l => `<div>${esc(l)}</div>`).join('')}</div></div>
      <div class="col"><h3>Seller</h3><div class="card">${sellerLines.map(l => `<div>${esc(l)}</div>`).join('')}</div></div>
    </div>

    <div class="sep"></div>

    <table>
      <thead><tr><th>Item</th><th>SKU</th><th>Options</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${esc(String(r.name).slice(0, 80))}</td>
            <td>${esc(String(r.sku).slice(0, 32))}</td>
            <td>${esc(String(r.options || '').slice(0, 48))}</td>
            <td class="r">${r.qty}</td>
            <td class="r">${esc(fmt(r.unitMajor, currency))}</td>
            <td class="r">${esc(fmt(r.lineMajor, currency))}</td>
          </tr>`).join('')}
      </tbody>
    </table>

    <div class="totals">
      <div class="trow"><div>Subtotal</div><div>${esc(fmt(Number(subtotalMajor.toFixed(2)), currency))}</div></div>
      ${showAdj ? `<div class="trow"><div>Adjustments</div><div>${esc(fmt(diffMajor, currency))}</div></div>` : ``}
      <div class="trow grand"><div>Grand Total</div><div>${esc(fmt(totalMajor, currency))}</div></div>
    </div>

    <div class="footer">
      <div>Payment ID: ${esc(order.paymentId || '—')}</div>
      <div>Thank you for your purchase!</div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { invoiceHtmlForOrder, toMajor, fmt };
