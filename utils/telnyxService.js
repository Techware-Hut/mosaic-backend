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

/**
 * Sends a one-time passcode (OTP) SMS for signup/verification.
 */
async function sendOtpSMS({ to, otp, appName = 'Mosaic Biz Hub', validMinutes = 10 }) {
  const text = `${appName}: Your verification code is ${otp}. Enter it to complete your signup. It will expire in ${validMinutes} minutes.`;
  return sendSMS({ to, text });
}

/**
 * Sends an Order status update SMS.
 */
async function sendOrderNotificationSMS({ to, orderNumber, status, customerName }) {
  const greeting = customerName ? `Hi ${customerName}, ` : '';
  const text = `${greeting}your Mosaic Biz Hub order #${orderNumber} is now: ${status.toUpperCase()}. Track updates at https://mosaicbizhub.com/orders/${orderNumber}`;
  return sendSMS({ to, text });
}

/**
 * Sends a Booking / Reservation update SMS.
 */
async function sendBookingNotificationSMS({ to, bookingType, businessName, date, time }) {
  const text = `Mosaic Biz Hub: Your ${bookingType || 'service'} booking with ${businessName || 'vendor'} is confirmed for ${date} at ${time}.`;
  return sendSMS({ to, text });
}

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
  sendOtpSMS,
  sendOrderNotificationSMS,
  sendBookingNotificationSMS,
  verifyTelnyxWebhookSignature,
};
