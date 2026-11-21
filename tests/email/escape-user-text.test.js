const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { esc } = require('../../utils/emailTemplates/baseLayout');
const logoPath = require.resolve('../../utils/emailLogoAttachment');
require.cache[logoPath] = { id: logoPath, filename: logoPath, loaded: true, exports: {
  resolvePlatformLogoAttachment: async () => ({ attachment: null, logoSrcForHtml: 'https://example.test/logo.png' }),
  withOptionalLogoAttachment: o => o,
} };

// Adapted from draft #341's transport capture; footer destination is deliberately unchanged.
function loadWithCapture(rel) {
  const modPath = path.resolve(__dirname, '../..', rel);
  const sent = [];
  const originalLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === 'nodemailer') return { createTransport: () => ({ sendMail: async m => { sent.push(m); return { messageId: 'test' }; } }) };
    if (req.endsWith('/smtpTransport') || req === './smtpTransport') return {
      createMosaicTransport: () => ({ sendMail: async m => { sent.push(m); return { messageId: 'test' }; } }),
      formatMosaicFromHeader: () => 'Mosaic <sender@example.test>',
      isSuppressedMailResult: () => false,
    };
    if (req === './emailLogoAttachment') return {
      resolvePlatformLogoAttachment: async () => ({ attachment: null, logoSrcForHtml: 'https://example.test/logo.png' }),
      withOptionalLogoAttachment: o => o,
    };
    if (req === '../services/invoiceService') return { renderInvoicePdfBufferForOrder: async () => Buffer.from('mock pdf') };
    if (req === '../models/ContactInquiry') return class { async save() {} };
    return originalLoad.call(this, req, parent, isMain);
  };
  delete require.cache[modPath];
  try { return { mod: require(modPath), sent }; } finally { Module._load = originalLoad; }
}
const values = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="https://evil.example">x</a>', '"quotes" & \'single\'', "O'Brien", 'José Núñez', 'Smith & Sons', '李小龙'];
const recipient = 'vendor@example.test';
const data = v => ({ to: recipient, adminEmail: recipient, vendorName: v, firstName: v, customerName: v, serviceTitle: v, restaurantName: v, foodTitle: v, businessName: v, message: v, note: v, notes: v, customerEmail: v, customerPhone: v, budget: v, requestedServices: [v], businessSlug: 'shop', bookingId: 'booking-1', rfqId: 'rfq-1', date: '2026-11-21', slot: '10:00', seats: 2, applicationId: 'application-1', paymentLink: 'https://mosaicbizhub.com/pay?booking=1&mode=pay' });
const cases = [
  ['utils/BuisnessprofileMail.js', (m,v) => m.sendBusinessProfileReviewEmail(recipient,v,v)],
  ['utils/BuisnessprofileMail.js', (m,v) => m.sendQuestionVerificationEmail(recipient,v,3,10)],
  ['utils/WellcomeMailer.js', (m,v) => m.sendWelcomeEmail(recipient,v)],
  ...['sendVendorVerificationGuidanceEmail','sendPaymentReminderEmail','sendVendorStorefrontPublishedEmail','sendVendorRejectionEmail'].map(fn => ['utils/WellcomeMailer.js', (m,v) => m[fn](data(v))]),
  ...['sendVendorSubmissionConfirmationEmail', 'sendVendorTrustBadgeAssignedEmail', 'sendAdminVendorCategoryRequestEmail', 'sendVendorCategoryRequestSubmittedEmail', 'sendCustomerNewCategoryNotificationEmail', 'sendVendorCategoryRequestRejectedEmail', 'sendVendorCategoryRequestApprovedEmail'].map(fn => ['utils/WellcomeMailer.js', (m,v) => m[fn]({...data(v), applicationId:v, requestId:v, requestedCategory:v, categoryName:v, subcategoryName:v, adminReason:v})]),
  ['utils/WellcomeMailer.js', (m,v) => m.sendAdminVendorProfileCompletedEmail(data(v))],
  ['utils/WellcomeMailer.js', (m,v) => m.sendVendorApprovedEmail(data(v))],
  ['utils/WellcomeMailer.js', (m,v) => m.sendAdminOnboardingSubmissionEmail({...data(v), tierPlan:v})],
  ...['order_cancelled','return_initiated','order_refunded','unknown'].map(event => ['utils/orderPhase.js', (m,v) => m.sendOrderLifecycleEmail(recipient,{groupOrderId:v},event)]),
  ...['accepted','rejected'].map(status => ['utils/orderPhase.js', (m,v) => m.sendOrderStatusEmail(recipient, {groupOrderId:v, userId:{name:v}}, status, {firstName:v}), status === 'rejected']),
  ...['shipped','delivered'].map(status => ['utils/orderPhase.js', (m,v) => m.sendOrderUpdateEmail(recipient,status,null,{firstName:v,customerName:v,orderNo:v,trackingId:v}), false]),
  ...['sendVendorNewServiceRfqEmail','sendCustomerServiceRfqConfirmationEmail'].map(fn => ['utils/rfqMailer.js', (m,v) => m[fn](data(v))]),
  ...['sendVendorNewServiceBookingEmail','sendVendorNewFoodBookingEmail','sendCustomerNewFoodBookingConfirmationEmail','sendCustomerNewServiceBookingConfirmationEmail','sendCustomerServicePaymentRequestEmail','sendCustomerServiceBookingDecisionEmail'].map(fn => ['utils/bookingMailer.js', (m,v) => m[fn](data(v))]),
  ...['approved','blocked','deactivated'].map(action => ['utils/approvalMail.js', (m,v) => m.sendBusinessStatusEmail({ ...data(v), action, adminNote:v, business: {name:v, type:'service', slug:'shop'} })]),
  ...['customer','vendor'].map(role => ['utils/OrderMail.js', (m,v) => m.sendOrderPaidEmails({
    order: {_id:'order-1',groupOrderId:v,userId:{name:v},businessId:{businessName:v,slug:'shop'},items:[],totalAmount:42},
    customerEmails:[recipient],vendorEmails:[recipient],roles:{customer:role==='customer',vendor:role==='vendor'},
  }), role === 'vendor']),
  // Contact inquiry email escaping is owned by BE #344 (PR #350).
];
for (const [i, [file, render, firstNameOnly = false]] of cases.entries()) test(`template ${i + 1}: ${file} escapes user text and preserves envelope/links`, async () => {
  const {mod,sent} = loadWithCapture(file);
  await render(mod,'Baseline');
  assert.equal(sent.length,1);
  const baseline=sent.pop();
  const hrefs = html => [...html.matchAll(/href="([^"]*)"/g)].map(m=>m[1]);
  for (const value of values) {
    await render(mod,value);
    assert.equal(sent.length,1);
    const mail=sent.pop();
    assert.ok(mail.html.includes(esc(value)), value);
    assert.doesNotMatch(mail.html, /<script>|<img src=x|<a href="https:\/\/evil\.example"/);
    assert.doesNotMatch(mail.html, /&amp;(?:#039;|quot;|amp;|lt;)/, 'no double escaping in HTML');
    if (mail.text !== undefined) {
      assert.doesNotMatch(mail.text, /&#039;|&amp;|&quot;|&lt;/, 'plain text has no HTML entities');
      // Order status and vendor paid-order greetings deliberately use only the first name.
      const rawName = firstNameOnly ? value.split(' ')[0] : value;
      assert.ok(mail.text.includes(rawName), `plain text preserves raw ${rawName}`);
    }
    assert.deepEqual(mail.to,baseline.to);
    if (file.includes('approvalMail')) assert.ok(mail.subject.includes(value));
    else if (file.includes('OrderMail')) assert.ok(mail.subject.includes(value));
    else if (file.includes('orderPhase') && !mail.subject.includes('Mosaic Biz Hub -')) assert.ok(mail.subject.includes(value));
    else assert.equal(mail.subject,baseline.subject);
    // Appeal mailto contains the business name by design; preserve its original encoding.
    const expected=hrefs(baseline.html).map(h=>h.replace(encodeURIComponent('Baseline'),encodeURIComponent(value)));
    assert.deepEqual(hrefs(mail.html),expected);
    const decoded=mail.html.replace(/&#039;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    assert.ok(decoded.includes(value));
  }
  await render(mod,'Name\r\nBcc: injected@example.test');
  assert.doesNotMatch(sent.pop().subject,/[\r\n]/);
});

test('shared esc handles stored and previously sanitized text safely',()=>{
  assert.equal(esc(null),'');
  assert.equal(esc(0),'0');
  assert.equal(esc('&lt;script&gt;'),'&amp;lt;script&amp;gt;');
});

