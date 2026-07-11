const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('./frontendUrl');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');

const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

const safe = (value, fallback = 'N/A') => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

const buildPartnerInquiriesUrl = (businessSlug) => {
  if (businessSlug) {
    return buildFrontendUrl(`/partners/${encodeURIComponent(businessSlug)}/inquiries`);
  }
  return buildFrontendUrl('/partners/dashboard');
};

exports.sendVendorNewServiceRfqEmail = async ({
  to,
  vendorName,
  serviceTitle,
  customerName,
  customerEmail,
  customerPhone,
  message,
  requestedServices,
  budget,
  rfqId,
  businessSlug,
}) => {
  if (!to || to.length === 0) return;

  const dashboardLink = buildPartnerInquiriesUrl(businessSlug);
  const selectedServices = Array.isArray(requestedServices) && requestedServices.length > 0
    ? requestedServices.map((item) => `<li>${safe(item)}</li>`).join('')
    : '<li>General quote request</li>';

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'New service quote request received',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(vendorName, 'Vendor')},</h2>
        <p>You have received a new request for quote from a customer on your Mosaic storefront.</p>
        <p><strong>Quote ID:</strong> ${safe(rfqId)}</p>
        <p><strong>Service listing:</strong> ${safe(serviceTitle)}</p>
        <p><strong>Customer:</strong> ${safe(customerName)} (${safe(customerEmail)}, ${safe(customerPhone)})</p>
        ${budget ? `<p><strong>Budget:</strong> ${safe(budget)}</p>` : ''}
        <p><strong>Requested services:</strong></p>
        <ul>${selectedServices}</ul>
        <p><strong>Message:</strong></p>
        <p>${safe(message)}</p>
        <p>Review the request in your vendor dashboard and follow up with the customer directly.</p>
        <p>
          <a href="${dashboardLink}" style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
            View quote requests
          </a>
        </p>
      </div>
    `,
  });
};

exports.sendCustomerServiceRfqConfirmationEmail = async ({
  to,
  customerName,
  serviceTitle,
  vendorName,
  message,
  requestedServices,
  budget,
  rfqId,
}) => {
  if (!to) return;

  const selectedServices = Array.isArray(requestedServices) && requestedServices.length > 0
    ? requestedServices.map((item) => `<li>${safe(item)}</li>`).join('')
    : '<li>General quote request</li>';

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'Your quote request has been received',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(customerName, 'Customer')},</h2>
        <p>Your request for quote has been sent to ${safe(vendorName, 'the vendor')}.</p>
        <p><strong>Quote ID:</strong> ${safe(rfqId)}</p>
        <p><strong>Service listing:</strong> ${safe(serviceTitle)}</p>
        ${budget ? `<p><strong>Budget:</strong> ${safe(budget)}</p>` : ''}
        <p><strong>Requested services:</strong></p>
        <ul>${selectedServices}</ul>
        <p><strong>Your message:</strong></p>
        <p>${safe(message)}</p>
        <p>The vendor will review your request and contact you with next steps.</p>
      </div>
    `,
  });
};
