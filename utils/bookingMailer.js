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

const buildPartnerBookingsUrl = (businessSlug) => {
  if (businessSlug) {
    return buildFrontendUrl(`/partners/${encodeURIComponent(businessSlug)}/bookings`);
  }
  return buildFrontendUrl('/partners/dashboard');
};

exports.sendVendorNewServiceBookingEmail = async ({
  to,
  vendorName,
  serviceTitle,
  customerName,
  customerEmail,
  customerPhone,
  services,
  date,
  slot,
  bookingId,
  businessSlug,
}) => {
  if (!to || to.length === 0) return;

  const dashboardLink = buildPartnerBookingsUrl(businessSlug);

  const selectedServices = Array.isArray(services) && services.length > 0
    ? services.map((item) => `<li>${safe(item)}</li>`).join('')
    : '<li>No service names provided</li>';

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'New service booking request received',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(vendorName, 'Vendor')},</h2>
        <p>You have received a new service booking request and action is required.</p>
        <p><strong>Booking ID:</strong> ${safe(bookingId)}</p>
        <p><strong>Date:</strong> ${safe(date)}</p>
        <p><strong>Slot:</strong> ${safe(slot)}</p>
        <p><strong>Customer:</strong> ${safe(customerName)} (${safe(customerEmail)}, ${safe(customerPhone)})</p>
        <p><strong>Requested Services:</strong></p>
        <ul>${selectedServices}</ul>
        <p>Please review the request and either request payment, approve it, or reject it from your dashboard.</p>
        <p>
          <a href="${dashboardLink}" style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
            Review booking requests
          </a>
        </p>
      </div>
    `,
  });
};

exports.sendVendorNewFoodBookingEmail = async ({
  to,
  vendorName,
  foodTitle,
  customerName,
  customerEmail,
  customerPhone,
  date,
  slot,
  seats,
  bookingId,
  businessSlug,
}) => {
  if (!to || to.length === 0) return;

  const dashboardLink = buildPartnerBookingsUrl(businessSlug);

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'New food reservation request received',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(vendorName, 'Vendor')},</h2>
        <p>You have received a new food reservation request.</p>
        <p><strong>Booking ID:</strong> ${safe(bookingId)}</p>
        <p><strong>Food item:</strong> ${safe(foodTitle)}</p>
        <p><strong>Date:</strong> ${safe(date)}</p>
        <p><strong>Slot:</strong> ${safe(slot)}</p>
        <p><strong>Party size:</strong> ${safe(seats)}</p>
        <p><strong>Customer:</strong> ${safe(customerName)} (${safe(customerEmail)}, ${safe(customerPhone)})</p>
        <p>Please review the reservation from your dashboard.</p>
        <p>
          <a href="${dashboardLink}" style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
            Review reservations
          </a>
        </p>
      </div>
    `,
  });
};

exports.sendCustomerNewServiceBookingConfirmationEmail = async ({
  to,
  customerName,
  serviceTitle,
  vendorName,
  date,
  slot,
  services,
  bookingId,
}) => {
  if (!to) return;

  const bookingsLink = buildFrontendUrl('/customer/bookings');

  const selectedServices = Array.isArray(services) && services.length > 0
    ? services.map((item) => `<li>${safe(item)}</li>`).join('')
    : '<li>No service names provided</li>';

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'Your service booking request has been received',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(customerName, 'Customer')},</h2>
        <p>Your service booking request has been received successfully.</p>
        <p><strong>Booking ID:</strong> ${safe(bookingId)}</p>
        <p><strong>Service:</strong> ${safe(serviceTitle)}</p>
        <p><strong>Vendor:</strong> ${safe(vendorName)}</p>
        <p><strong>Date:</strong> ${safe(date)}</p>
        <p><strong>Slot:</strong> ${safe(slot)}</p>
        <p><strong>Requested Services:</strong></p>
        <ul>${selectedServices}</ul>
        <p>We will notify you once the vendor reviews your request.</p>
        <p>
          <a href="${bookingsLink}" style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
            View My Bookings
          </a>
        </p>
      </div>
    `,
  });
};

exports.sendCustomerServicePaymentRequestEmail = async ({
  to,
  customerName,
  serviceTitle,
  vendorName,
  date,
  slot,
  paymentLink,
  bookingId,
  message,
}) => {
  if (!to) return;

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'Payment requested for your service booking',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(customerName, 'Customer')},</h2>
        <p>${safe(vendorName, 'The vendor')} has requested payment for your booking before approval.</p>
        <p><strong>Booking ID:</strong> ${safe(bookingId)}</p>
        <p><strong>Date:</strong> ${safe(date)}</p>
        <p><strong>Slot:</strong> ${safe(slot)}</p>
        ${message ? `<p><strong>Vendor note:</strong> ${safe(message)}</p>` : ''}
        <p>
          <a href="${paymentLink}" style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
            Pay Now
          </a>
        </p>
      </div>
    `,
  });
};

exports.sendCustomerServiceBookingDecisionEmail = async ({
  to,
  customerName,
  serviceTitle,
  vendorName,
  date,
  slot,
  bookingId,
  status,
  note,
}) => {
  if (!to) return;

  const subject = status === 'approved'
    ? 'Your service booking has been approved'
    : 'Your service booking has been rejected';

  const heading = status === 'approved'
    ? 'Your booking is approved'
    : 'Your booking was not approved';

  await transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Hi ${safe(customerName, 'Customer')},</h2>
        <p><strong>${heading}</strong></p>
        <p><strong>Booking ID:</strong> ${safe(bookingId)}</p>
        <p><strong>Vendor:</strong> ${safe(vendorName)}</p>
        <p><strong>Date:</strong> ${safe(date)}</p>
        <p><strong>Slot:</strong> ${safe(slot)}</p>
        ${note ? `<p><strong>Vendor note:</strong> ${safe(note)}</p>` : ''}
      </div>
    `,
  });
};
