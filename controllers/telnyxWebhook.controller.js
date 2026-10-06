const { verifyTelnyxWebhookSignature } = require('../utils/telnyxService');

/**
 * Controller to handle inbound webhooks from Telnyx (delivery receipts, inbound SMS, status updates).
 */
exports.handleTelnyxWebhook = async (req, res) => {
  const signature = req.headers['telnyx-signature-ed25519'];
  const timestamp = req.headers['telnyx-timestamp'];
  let rawBody = req.body;

  let event;

  try {
    if (signature && timestamp && process.env.TELNYX_PUBLIC_KEY) {
      event = verifyTelnyxWebhookSignature({
        rawBody,
        signature,
        timestamp,
        publicKey: process.env.TELNYX_PUBLIC_KEY,
      });
    } else {
      // In production, require signature header if public key is configured
      if (process.env.NODE_ENV === 'production' && process.env.TELNYX_PUBLIC_KEY && !signature) {
        return res.status(400).json({
          success: false,
          error: 'Missing telnyx-signature-ed25519 header',
        });
      }

      if (Buffer.isBuffer(rawBody)) {
        const bodyStr = rawBody.toString('utf8');
        event = bodyStr.trim() ? JSON.parse(bodyStr) : {};
      } else if (typeof rawBody === 'string') {
        event = rawBody.trim() ? JSON.parse(rawBody) : {};
      } else if (rawBody && typeof rawBody === 'object') {
        event = rawBody;
      } else {
        event = {};
      }

      // If payload was double-wrapped as a serialized Buffer JSON object: { type: 'Buffer', data: [...] }
      if (event && event.type === 'Buffer' && Array.isArray(event.data)) {
        const decoded = Buffer.from(event.data).toString('utf8');
        event = decoded.trim() ? JSON.parse(decoded) : {};
      }
    }
  } catch (err) {
    console.error('[Telnyx Webhook] Signature verification or parsing failed:', err.message);
    return res.status(400).json({
      success: false,
      error: `Webhook verification failed: ${err.message}`,
    });
  }

  if (!event || Object.keys(event).length === 0 || !event.data || typeof event.data !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'Invalid or empty Telnyx event payload',
    });
  }

  const eventData = event.data;
  const eventType = eventData.event_type;
  const payload = eventData.payload;

  console.info('[Telnyx Webhook] Event received:', {
    eventType,
    id: eventData?.id,
    messageId: payload?.id,
    to: payload?.to?.[0]?.phone_number || payload?.to,
    from: payload?.from?.phone_number || payload?.from,
  });

  switch (eventType) {
    case 'message.sent':
      console.info(`[Telnyx Webhook] Message ${payload?.id} sent successfully.`);
      break;

    case 'message.delivered':
      console.info(`[Telnyx Webhook] Message ${payload?.id} delivered to ${payload?.to?.[0]?.phone_number || payload?.to}.`);
      break;

    case 'message.failed':
      console.warn(`[Telnyx Webhook] Message ${payload?.id} delivery failed:`, {
        errors: payload?.errors,
        to: payload?.to,
      });
      break;

    case 'message.received':
      console.info(`[Telnyx Webhook] Inbound message received from ${payload?.from?.phone_number || payload?.from}:`, {
        text: payload?.text,
        media: payload?.media,
      });
      break;

    default:
      console.info(`[Telnyx Webhook] Unhandled event type: ${eventType}`);
  }

  return res.status(200).json({
    received: true,
    eventType: eventType || 'unknown',
    eventId: eventData?.id || null,
  });
};
