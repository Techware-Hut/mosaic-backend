const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('./frontendUrl');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');
const { baseLayout } = require('./emailTemplates/baseLayout');

const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

/**
 * 2. VENDOR EMAIL — NEW SERVICE BOOKING REQUEST
 */
exports.sendVendorNewServiceBookingEmail = async ({
  to,
  vendorName,
  firstName,
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
  if (!to || (Array.isArray(to) && to.length === 0)) return;

  const rawFirstName = firstName || (vendorName ? String(vendorName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeCustomerName = esc(customerName || 'Customer');
  const safeServiceTitle = esc(serviceTitle || (Array.isArray(services) && services.length > 0 ? services.join(', ') : 'Professional Service'));
  const safeDate = esc(date || 'N/A');
  const safeSlot = esc(slot || 'N/A');
  const safeBookingId = esc(bookingId || '');

  const dashboardLink = buildPartnerBookingsUrl(businessSlug);
  const preheader = 'A customer has booked one of your professional services on Mosaic Biz Hub. Please review the details below.';
  const footerReason = 'You are receiving this email because you are a registered vendor on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      New Service Booking Request &mdash; Please Review
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      A customer has booked one of your professional services on Mosaic Biz Hub. Please review the details below and confirm or deny the request so the customer knows what to expect.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Booking Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            ${safeBookingId ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Booking ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeBookingId}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Customer:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeCustomerName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Service:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeServiceTitle}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Date:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeDate}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Time Slot:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeSlot}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Your timely response helps ensure a smooth and professional experience for the customer.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${dashboardLink}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Review Booking Request &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `A customer has booked one of your professional services on Mosaic Biz Hub. Please review the details below and confirm or deny the request so the customer knows what to expect.`,
    ``,
    `Booking Details:`,
    `Customer: ${customerName || 'Customer'}`,
    `Service: ${serviceTitle || (Array.isArray(services) && services.length > 0 ? services.join(', ') : 'Professional Service')}`,
    `Date: ${date || 'N/A'}`,
    `Time Slot: ${slot || 'N/A'}`,
    bookingId ? `Booking ID: #${bookingId}` : '',
    ``,
    `Your timely response helps ensure a smooth and professional experience for the customer.`,
    ``,
    `Review Booking Request: ${dashboardLink}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].filter(Boolean).join('\n');

  return transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'New Service Booking Request — Please Review',
    html,
    text,
  });
};

/**
 * 2. RESTAURANT VENDOR EMAIL — NEW RESERVATION REQUEST
 */
exports.sendVendorNewFoodBookingEmail = async ({
  to,
  vendorName,
  firstName,
  foodTitle,
  customerName,
  customerEmail,
  customerPhone,
  date,
  slot,
  seats,
  notes,
  bookingId,
  businessSlug,
}) => {
  if (!to || (Array.isArray(to) && to.length === 0)) return;

  const rawFirstName = firstName || (vendorName ? String(vendorName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeCustomerName = esc(customerName || 'Customer');
  const safePartySize = esc(seats || 'N/A');
  const safeDate = esc(date || 'N/A');
  const safeSlot = esc(slot || 'N/A');
  const safeNotes = esc(notes || '');
  const safeBookingId = esc(bookingId || '');

  const dashboardLink = buildPartnerBookingsUrl(businessSlug);
  const preheader = 'A customer has requested a reservation at your restaurant through Mosaic Biz Hub. Please review the details below.';
  const footerReason = 'You are receiving this email because you are a registered restaurant vendor on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      New Reservation Request &mdash; Please Review and Confirm
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      A customer has requested a reservation at your restaurant through Mosaic Biz Hub. Please review the details below and confirm or deny the request so the customer knows what to expect.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Reservation Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            ${safeBookingId ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Booking ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeBookingId}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Customer:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeCustomerName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Party Size:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safePartySize}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Reservation Date:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeDate}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Time:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeSlot}</td>
            </tr>
            ${safeNotes ? `
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Special Notes:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeNotes}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Your timely response helps ensure a smooth and enjoyable dining experience for the customer.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${dashboardLink}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Review Reservation Request &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `A customer has requested a reservation at your restaurant through Mosaic Biz Hub. Please review the details below and confirm or deny the request so the customer knows what to expect.`,
    ``,
    `Reservation Details:`,
    `Customer: ${customerName || 'Customer'}`,
    `Party Size: ${seats || 'N/A'}`,
    `Reservation Date: ${date || 'N/A'}`,
    `Time: ${slot || 'N/A'}`,
    notes ? `Special Notes: ${notes}` : '',
    bookingId ? `Booking ID: #${bookingId}` : '',
    ``,
    `Your timely response helps ensure a smooth and enjoyable dining experience for the customer.`,
    ``,
    `Review Reservation Request: ${dashboardLink}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].filter(Boolean).join('\n');

  return transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'New Reservation Request — Please Review and Confirm',
    html,
    text,
  });
};

/**
 * 1. CUSTOMER EMAIL — RESTAURANT BOOKING CONFIRMATION
 */
exports.sendCustomerNewFoodBookingConfirmationEmail = async ({
  to,
  customerName,
  firstName,
  restaurantName,
  vendorName,
  foodTitle,
  date,
  slot,
  seats,
  bookingId,
}) => {
  if (!to) return;

  const rawFirstName = firstName || (customerName ? String(customerName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeRestaurantName = esc(restaurantName || vendorName || foodTitle || 'Restaurant');
  const safeDate = esc(date || 'N/A');
  const safeSlot = esc(slot || 'N/A');
  const safeSeats = esc(seats || '');
  const safeBookingId = esc(bookingId || '');

  const reservationsLink = buildFrontendUrl('/customer/bookings');
  const preheader = 'Thank you for booking your dining experience through Mosaic Biz Hub. Here are your reservation details.';
  const footerReason = 'You are receiving this email because you made a dining reservation on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Your Reservation Is Confirmed &mdash; Thank You for Booking With Us!
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Thank you for booking your dining experience through Mosaic Biz Hub. We’re excited to help you connect with restaurants that celebrate culture, flavor, and community.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Here are your reservation details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            ${safeBookingId ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Reservation ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeBookingId}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Restaurant:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeRestaurantName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Reservation Date:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeDate}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Time:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeSlot}</td>
            </tr>
            ${safeSeats ? `
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Party Size:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeSeats}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Your restaurant has received your reservation request and will confirm or decline shortly. You’ll receive an update as soon as they respond.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${reservationsLink}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            View My Reservation &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `Thank you for booking your dining experience through Mosaic Biz Hub. We’re excited to help you connect with restaurants that celebrate culture, flavor, and community.`,
    ``,
    `Here are your reservation details:`,
    `Restaurant: ${restaurantName || vendorName || foodTitle || 'Restaurant'}`,
    `Reservation Date: ${date || 'N/A'}`,
    `Time: ${slot || 'N/A'}`,
    seats ? `Party Size: ${seats}` : '',
    bookingId ? `Reservation ID: #${bookingId}` : '',
    ``,
    `Your restaurant has received your reservation request and will confirm or decline shortly. You’ll receive an update as soon as they respond.`,
    ``,
    `View My Reservation: ${reservationsLink}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].filter(Boolean).join('\n');

  return transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'Your Reservation Is Confirmed — Thank You for Booking With Us!',
    html,
    text,
  });
};

/**
 * 1. CUSTOMER EMAIL — SERVICE BOOKING CONFIRMATION
 */
exports.sendCustomerNewServiceBookingConfirmationEmail = async ({
  to,
  customerName,
  firstName,
  serviceTitle,
  vendorName,
  date,
  slot,
  services,
  bookingId,
}) => {
  if (!to) return;

  const rawFirstName = firstName || (customerName ? String(customerName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeServiceTitle = esc(serviceTitle || (Array.isArray(services) && services.length > 0 ? services.join(', ') : 'Professional Service'));
  const safeVendorName = esc(vendorName || 'Vendor');
  const safeDate = esc(date || 'N/A');
  const safeSlot = esc(slot || 'N/A');
  const safeBookingId = esc(bookingId || '');

  const bookingsLink = buildFrontendUrl('/customer/bookings');
  const preheader = 'Thank you for booking your professional service through Mosaic Biz Hub. Here are your booking details.';
  const footerReason = 'You are receiving this email because you placed a service booking on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Your Service Booking Is Confirmed &mdash; Thank You!
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Thank you for booking your professional service through Mosaic Biz Hub. We’re honored you chose our community of trusted vendors to support your needs.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Here are the details of your booking:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            ${safeBookingId ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Booking ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">#${safeBookingId}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Service Selected:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeServiceTitle}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Vendor:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeVendorName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Date:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeDate}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Time Slot:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeSlot}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Your vendor has received your request and will confirm or decline shortly. You’ll receive an update as soon as they respond.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${bookingsLink}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            View My Booking &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `Thank you for booking your professional service through Mosaic Biz Hub. We’re honored you chose our community of trusted vendors to support your needs.`,
    ``,
    `Here are the details of your booking:`,
    `Service Selected: ${serviceTitle || (Array.isArray(services) && services.length > 0 ? services.join(', ') : 'Professional Service')}`,
    `Vendor: ${vendorName || 'Vendor'}`,
    `Date: ${date || 'N/A'}`,
    `Time Slot: ${slot || 'N/A'}`,
    bookingId ? `Booking ID: #${bookingId}` : '',
    ``,
    `Your vendor has received your request and will confirm or decline shortly. You’ll receive an update as soon as they respond.`,
    ``,
    `View My Booking: ${bookingsLink}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].filter(Boolean).join('\n');

  return transporter.sendMail({
    from: formatMosaicFromHeader(),
    to,
    subject: 'Your Service Booking Is Confirmed — Thank You!',
    html,
    text,
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
