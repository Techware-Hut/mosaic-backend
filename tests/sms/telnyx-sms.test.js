const { test, describe, before, after, it } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const express = require('express');

const {
  normalizePhoneNumber,
  sendSMS,
  sendOtpSMS,
  sendOrderNotificationSMS,
  sendBookingNotificationSMS,
} = require('../../utils/telnyxService');
const { handleTelnyxWebhook } = require('../../controllers/telnyxWebhook.controller');

describe('Telnyx SMS Service & Webhook Suite', () => {

  describe('Phone Number Normalization', () => {
    it('normalizes 10-digit US phone numbers to E.164 format', () => {
      assert.equal(normalizePhoneNumber('7572607200'), '+17572607200');
      assert.equal(normalizePhoneNumber('(757) 260-7200'), '+17572607200');
      assert.equal(normalizePhoneNumber('757-260-7200'), '+17572607200');
      assert.equal(normalizePhoneNumber('17572607200'), '+17572607200');
      assert.equal(normalizePhoneNumber('+1 757 260 7200'), '+17572607200');
    });

    it('returns null for empty or invalid phone numbers', () => {
      assert.equal(normalizePhoneNumber(''), null);
      assert.equal(normalizePhoneNumber(null), null);
      assert.equal(normalizePhoneNumber('invalid-number'), null);
      assert.equal(normalizePhoneNumber('123'), null);
    });
  });

  describe('SMS Send Validation & Guardrails', () => {
    it('rejects sending when destination phone number is invalid', async () => {
      const result = await sendSMS({ to: 'abc', text: 'Hello' });
      assert.equal(result.success, false);
      assert.equal(result.error, 'Invalid destination phone number');
    });

    it('rejects sending when text body is empty', async () => {
      const result = await sendSMS({ to: '757-260-7200', text: '   ' });
      assert.equal(result.success, false);
      assert.equal(result.error, 'Message body text is required');
    });

    it('returns configuration error when TELNYX_API_KEY is missing', async () => {
      const origKey = process.env.TELNYX_API_KEY;
      delete process.env.TELNYX_API_KEY;

      const result = await sendSMS({ to: '757-260-7200', text: 'Test message' });
      assert.equal(result.success, false);
      assert.equal(result.error, 'TELNYX_API_KEY not configured');

      process.env.TELNYX_API_KEY = origKey;
    });
  });

  describe('Notification Helper Formatters', () => {
    it('formats OTP SMS correctly', async () => {
      const origKey = process.env.TELNYX_API_KEY;
      delete process.env.TELNYX_API_KEY;

      const res = await sendOtpSMS({ to: '7572607200', otp: '123456' });
      assert.equal(res.success, false);
      assert.equal(res.error, 'TELNYX_API_KEY not configured');

      process.env.TELNYX_API_KEY = origKey;
    });

    it('formats Order notification SMS correctly', async () => {
      const origKey = process.env.TELNYX_API_KEY;
      delete process.env.TELNYX_API_KEY;

      const res = await sendOrderNotificationSMS({
        to: '7572607200',
        orderNumber: 'MBH-12345',
        status: 'delivered',
        customerName: 'Michelle',
      });
      assert.equal(res.success, false);
      assert.equal(res.error, 'TELNYX_API_KEY not configured');

      process.env.TELNYX_API_KEY = origKey;
    });
  });

  describe('Telnyx Inbound Webhook Handling', () => {
    let app;

    before(() => {
      app = express();
      app.use('/api/webhooks/telnyx', express.raw({ type: '*/*' }), handleTelnyxWebhook);
    });

    it('processes message.delivered event correctly', async () => {
      const mockEvent = {
        data: {
          id: 'evt_12345',
          event_type: 'message.delivered',
          payload: {
            id: 'msg_98765',
            to: [{ phone_number: '+17572607200', status: 'delivered' }],
            from: { phone_number: '+17572607200' },
          },
        },
      };

      const res = await supertest(app)
        .post('/api/webhooks/telnyx')
        .send(mockEvent);

      assert.equal(res.status, 200);
      assert.equal(res.body.received, true);
      assert.equal(res.body.eventType, 'message.delivered');
      assert.equal(res.body.eventId, 'evt_12345');
    });

    it('processes message.received (inbound customer SMS) event correctly', async () => {
      const mockInboundEvent = {
        data: {
          id: 'evt_inbound_1',
          event_type: 'message.received',
          payload: {
            id: 'msg_inbound_1',
            to: [{ phone_number: '+17572607200' }],
            from: { phone_number: '+17575551234' },
            text: 'Hello, need help with my order',
          },
        },
      };

      const res = await supertest(app)
        .post('/api/webhooks/telnyx')
        .send(mockInboundEvent);

      assert.equal(res.status, 200);
      assert.equal(res.body.received, true);
      assert.equal(res.body.eventType, 'message.received');
    });

    it('handles malformed webhook JSON safely', async () => {
      const res = await supertest(app)
        .post('/api/webhooks/telnyx')
        .set('Content-Type', 'text/plain')
        .send('not a valid json payload');

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });
  });
});
