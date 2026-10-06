const Telnyx = require('telnyx');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

let telnyxClient = null;

function getTelnyxClient() {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!telnyxClient) {
    telnyxClient = new Telnyx({ apiKey });
  }
  return telnyxClient;
}

/**
 * Normalizes any valid phone number string into E.164 format (+1XXXXXXXXXX).
 * Defaults to 'US' if country code is omitted.
 *
 * @param {string} phone
 * @param {string} [defaultCountry='US']
 * @returns {string|null} E.164 formatted phone number or null if invalid
 */
function normalizePhoneNumber(phone, defaultCountry = 'US') {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  const cleaned = phone.trim();
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);

  if (parsed && parsed.isValid()) {
    return parsed.number; // e.g. "+17572607200"
  }

  // Fallback cleanup for simple 10-digit US numbers
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }

  return null;
}

/**
 * Sends an SMS or MMS message via Telnyx.
 *
 * @param {Object} options
 * @param {string} options.to - Destination phone number
 * @param {string} options.text - Message body text
 * @param {string[]} [options.mediaUrls] - Optional MMS media URLs
 * @param {string} [options.from] - Sender phone number (defaults to process.env.TELNYX_PHONE_NUMBER)
 * @param {string} [options.messagingProfileId] - Messaging Profile ID (defaults to process.env.TELNYX_MESSAGING_PROFILE_ID)
 * @returns {Promise<{ success: boolean, messageId?: string, status?: string, error?: string, details?: any }>}
 */
async function sendSMS({ to, text, mediaUrls, from, messagingProfileId }) {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) {
    console.warn(`[Telnyx SMS] Invalid destination phone number: "${to}"`);
    return {
      success: false,
      error: 'Invalid destination phone number',
    };
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return {
      success: false,
      error: 'Message body text is required',
    };
  }

  const client = getTelnyxClient();
  if (!client) {
    console.warn('[Telnyx SMS] TELNYX_API_KEY is not configured. SMS not sent.');
    return {
      success: false,
      error: 'TELNYX_API_KEY not configured',
    };
  }

  const senderNumber = from || process.env.TELNYX_PHONE_NUMBER || '+17572607200';
  const profileId = messagingProfileId || process.env.TELNYX_MESSAGING_PROFILE_ID;

  const payload = {
    to: normalizedTo,
    from: senderNumber,
    text: text.trim(),
  };

  if (profileId) {
    payload.messaging_profile_id = profileId;
  }

  if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
    payload.media_urls = mediaUrls;
  }

  try {
    const response = await client.messages.send(payload);
    const messageData = response?.data;

    console.info('[Telnyx SMS] Message dispatched successfully:', {
      messageId: messageData?.id,
      to: normalizedTo,
      status: messageData?.to?.[0]?.status || 'queued',
    });

    return {
      success: true,
      messageId: messageData?.id,
      status: messageData?.to?.[0]?.status || 'queued',
    };
  } catch (error) {
    const errorDetails = error.errors || error.raw?.errors || error.response?.data?.errors || null;
    console.error('[Telnyx SMS] Failed to send message:', {
      to: normalizedTo,
      error: error.message || error,
      details: errorDetails,
    });

    return {
      success: false,
      error: error.message || 'Failed to send SMS via Telnyx',
      details: errorDetails,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// AUTH SMS HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * 1A — Sends a customer OTP SMS for signup/verification.
 */
async function sendOtpSMS({ to, otp, appName = 'Mosaic Biz Hub', validMinutes = 10 }) {
  const text = `${appName}: Your verification code is ${otp}. Enter it to complete your signup. It will expire in ${validMinutes} minutes. If you didn't request this, ignore.`;
  return sendSMS({ to, text });
}

/**
 * 1B — Sends a vendor OTP SMS for account activation.
 */
async function sendVendorOtpSMS({ to, otp, validMinutes = 10 }) {
  const text = `Your Mosaic Biz Hub vendor verification code is ${otp}. Enter it to activate your account. It will expire in ${validMinutes} minutes.`;
  return sendSMS({ to, text });
}

/**
 * 1C — Sends a customer welcome SMS after first successful OTP verification.
 */
async function sendCustomerWelcomeSMS({ to, firstName }) {
  const name = firstName || 'there';
  const text = `Welcome to Mosaic Biz Hub, ${name}! Explore diverse vendors and start discovering new favorites today.`;
  return sendSMS({ to, text });
}

// ─────────────────────────────────────────────────────────────
// VENDOR ONBOARDING SMS HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * 1D — Sends a tier welcome SMS after a vendor's subscription goes active.
 * @param {'launch'|'growth'|'premium'} tier
 */
async function sendVendorTierWelcomeSMS({ to, vendorName, tier }) {
  const name = vendorName || 'Vendor';
  let text;

  switch ((tier || '').toLowerCase()) {
    case 'growth':
      text = `Mosaic Biz Hub: Welcome to Growth, ${name}! You now have enhanced profiles, promotions, messaging, push notifications, catalog upload, and expanded analytics. Log in to activate your business now.`;
      break;
    case 'premium':
      text = `Mosaic Biz Hub: You're on Premium, ${name}! Enjoy unlimited listings, custom branding, RFQ access, priority support, and full analytics. Log in and make your mark.`;
      break;
    default: // launch
      text = `Mosaic Biz Hub: Welcome, ${name}! You're now on the Launch Tier — perfect for building visibility. You can list 5 products/3 services, add images, and access basic analytics. Log in to complete your profile and start showcasing your business.`;
  }

  return sendSMS({ to, text });
}

/**
 * 2A — Sends a vendor application approved SMS.
 */
async function sendVendorApprovedSMS({ to, vendorName }) {
  const name = vendorName || 'Vendor';
  const text = `Mosaic Biz Hub: Congratulations, ${name}! Your vendor application has been approved. Log in to set up your profile, select a subscription plan, and start listing your products or services.`;
  return sendSMS({ to, text });
}

/**
 * 2B — Sends a vendor application rejected SMS.
 */
async function sendVendorRejectedSMS({ to, vendorName, reason }) {
  const name = vendorName || 'Vendor';
  const rejectionReason = reason || 'does not meet current requirements';
  const text = `Mosaic Biz Hub: We've reviewed your vendor application. Unfortunately, it wasn't approved at this time. Reason: ${rejectionReason}. You may reapply after addressing the issue. Questions? Contact support.`;
  return sendSMS({ to, text });
}

/**
 * 2C — Sends a vendor profile setup complete SMS.
 */
async function sendVendorProfileCompleteSMS({ to, vendorName }) {
  const name = vendorName || 'Vendor';
  const text = `Mosaic Biz Hub: Your vendor profile is complete, ${name}! You're all set to receive customers. Keep your listings updated and check your dashboard for performance insights.`;
  return sendSMS({ to, text });
}

// ─────────────────────────────────────────────────────────────
// ORDER LIFECYCLE SMS HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * 3A — Sends order placed confirmation SMS to customer.
 */
async function sendOrderPlacedCustomerSMS({ to, orderNumber }) {
  const text = `Mosaic Biz Hub: Your order #${orderNumber} has been placed successfully! We've notified the vendor. You'll receive updates as your order progresses.`;
  return sendSMS({ to, text });
}

/**
 * 3B — Sends new order alert SMS to vendor.
 */
async function sendOrderPlacedVendorSMS({ to, orderNumber, customerName }) {
  const customer = customerName || 'a customer';
  const text = `Mosaic Biz Hub: New order #${orderNumber} received from ${customer}! Log in to review and confirm. Timely response improves your rating.`;
  return sendSMS({ to, text });
}

/**
 * 3C — Sends order accepted SMS to customer.
 */
async function sendOrderAcceptedSMS({ to, orderNumber, vendorName }) {
  const vendor = vendorName || 'the vendor';
  const text = `Mosaic Biz Hub: Great news! Your order #${orderNumber} has been accepted by ${vendor} and is being prepared. We'll update you when it ships.`;
  return sendSMS({ to, text });
}

/**
 * 3D — Sends order shipped SMS to customer.
 */
async function sendOrderShippedSMS({ to, orderNumber, trackingId, trackingUrl }) {
  let text = `Mosaic Biz Hub: Your order #${orderNumber} is on the way!`;
  if (trackingId) text += ` Tracking ID: ${trackingId}.`;
  if (trackingUrl) text += ` Track here: ${trackingUrl}`;
  return sendSMS({ to, text });
}

/**
 * 3E — Sends order delivered SMS to customer.
 */
async function sendOrderDeliveredSMS({ to, orderNumber, vendorName }) {
  const vendor = vendorName || 'the vendor';
  const text = `Mosaic Biz Hub: Your order #${orderNumber} has been delivered! We hope you love it. Leave a review to help others discover ${vendor}.`;
  return sendSMS({ to, text });
}

/**
 * 3F — Sends order cancelled SMS to customer.
 */
async function sendOrderCancelledCustomerSMS({ to, orderNumber }) {
  const text = `Mosaic Biz Hub: Your order #${orderNumber} has been cancelled. If you didn't request this, contact support. A refund will be processed if applicable.`;
  return sendSMS({ to, text });
}

/**
 * 3F — Sends order cancelled SMS to vendor.
 */
async function sendOrderCancelledVendorSMS({ to, orderNumber, customerName }) {
  const customer = customerName || 'the customer';
  const text = `Mosaic Biz Hub: Order #${orderNumber} from ${customer} has been cancelled. Review your dashboard for details.`;
  return sendSMS({ to, text });
}

/**
 * 3G — Sends refund initiated SMS to customer.
 */
async function sendOrderRefundedSMS({ to, orderNumber }) {
  const text = `Mosaic Biz Hub: A refund for order #${orderNumber} has been initiated. It should reflect in your account within 5-7 business days depending on your bank.`;
  return sendSMS({ to, text });
}

// ─────────────────────────────────────────────────────────────
// BOOKING & RESERVATION SMS HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * 4A — Sends service booking confirmed SMS to customer.
 */
async function sendServiceBookingCreatedCustomerSMS({ to, businessName, date, time, bookingId }) {
  const biz = businessName || 'the vendor';
  const bookingRef = bookingId ? ` Booking ID: ${bookingId}.` : '';
  const text = `Mosaic Biz Hub: Your booking with ${biz} on ${date} at ${time} is confirmed!${bookingRef} See you then!`;
  return sendSMS({ to, text });
}

/**
 * 4B — Sends new booking alert SMS to vendor.
 */
async function sendServiceBookingAlertVendorSMS({ to, customerName, serviceName, date, time }) {
  const customer = customerName || 'a customer';
  const service = serviceName || 'your service';
  const text = `Mosaic Biz Hub: New booking from ${customer} for ${service} on ${date} at ${time}. Log in to confirm or reschedule.`;
  return sendSMS({ to, text });
}

/**
 * 4C — Sends booking approved SMS to customer.
 */
async function sendServiceBookingApprovedSMS({ to, businessName, serviceName, date, time }) {
  const biz = businessName || 'the vendor';
  const service = serviceName || 'your service';
  const text = `Mosaic Biz Hub: ${biz} has confirmed your booking for ${service} on ${date} at ${time}. See you there!`;
  return sendSMS({ to, text });
}

/**
 * 4D — Sends booking rejected SMS to customer.
 */
async function sendServiceBookingRejectedSMS({ to, businessName, date }) {
  const biz = businessName || 'the vendor';
  const text = `Mosaic Biz Hub: Unfortunately, your booking request with ${biz} for ${date} was not approved. Please try rebooking or contact the vendor.`;
  return sendSMS({ to, text });
}

/**
 * 4E — Sends food/table reservation confirmed SMS to customer.
 */
async function sendFoodReservationCreatedSMS({ to, restaurantName, numberOfPeople, date, time, bookingId }) {
  const restaurant = restaurantName || 'the restaurant';
  const people = numberOfPeople || 'your party';
  const bookingRef = bookingId ? ` Booking ID: ${bookingId}.` : '';
  const text = `Mosaic Biz Hub: Your reservation at ${restaurant} for ${people} on ${date} at ${time} is confirmed.${bookingRef}`;
  return sendSMS({ to, text });
}

// ─────────────────────────────────────────────────────────────
// LEGACY HELPERS (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────

/**
 * @deprecated Use sendOrderAcceptedSMS / sendOrderShippedSMS / sendOrderDeliveredSMS instead.
 */
async function sendOrderNotificationSMS({ to, orderNumber, status, customerName }) {
  const greeting = customerName ? `Hi ${customerName}, ` : '';
  const text = `${greeting}your Mosaic Biz Hub order #${orderNumber} is now: ${status.toUpperCase()}. Track updates at https://mosaicbizhub.com/orders/${orderNumber}`;
  return sendSMS({ to, text });
}

/**
 * @deprecated Use sendServiceBookingCreatedCustomerSMS instead.
 */
async function sendBookingNotificationSMS({ to, bookingType, businessName, date, time }) {
  const text = `Mosaic Biz Hub: Your ${bookingType || 'service'} booking with ${businessName || 'vendor'} is confirmed for ${date} at ${time}.`;
  return sendSMS({ to, text });
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK SIGNATURE VERIFICATION
// ─────────────────────────────────────────────────────────────

/**
 * Verifies the incoming Telnyx webhook signature using the public key.
 */
function verifyTelnyxWebhookSignature({ rawBody, signature, timestamp, publicKey }) {
  const key = publicKey || process.env.TELNYX_PUBLIC_KEY;
  if (!key) {
    throw new Error('TELNYX_PUBLIC_KEY is not configured');
  }

  const client = getTelnyxClient() || new Telnyx({ apiKey: 'dummy' });
  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
  return client.webhooks.unwrap(payloadStr, { 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': timestamp }, key);
}

module.exports = {
  getTelnyxClient,
  normalizePhoneNumber,
  sendSMS,
  // Auth
  sendOtpSMS,
  sendVendorOtpSMS,
  sendCustomerWelcomeSMS,
  // Vendor Onboarding
  sendVendorTierWelcomeSMS,
  sendVendorApprovedSMS,
  sendVendorRejectedSMS,
  sendVendorProfileCompleteSMS,
  // Orders
  sendOrderPlacedCustomerSMS,
  sendOrderPlacedVendorSMS,
  sendOrderAcceptedSMS,
  sendOrderShippedSMS,
  sendOrderDeliveredSMS,
  sendOrderCancelledCustomerSMS,
  sendOrderCancelledVendorSMS,
  sendOrderRefundedSMS,
  // Bookings & Reservations
  sendServiceBookingCreatedCustomerSMS,
  sendServiceBookingAlertVendorSMS,
  sendServiceBookingApprovedSMS,
  sendServiceBookingRejectedSMS,
  sendFoodReservationCreatedSMS,
  // Legacy
  sendOrderNotificationSMS,
  sendBookingNotificationSMS,
  // Webhook
  verifyTelnyxWebhookSignature,
};
