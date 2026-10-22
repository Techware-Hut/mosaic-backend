const express = require('express');
const { handleStripeWebhook } = require('../controllers/webhookController');
const { handleTelnyxWebhook } = require('../controllers/telnyxWebhook.controller');
const webhookRouter = express.Router();

// Canonical Stripe webhook endpoint for order-payment events
webhookRouter.post('/stripe', express.raw({ type: '*/*' }), handleStripeWebhook);

// Canonical Telnyx webhook endpoint for SMS/MMS delivery and inbound messages
webhookRouter.post('/telnyx', express.raw({ type: '*/*' }), handleTelnyxWebhook);

module.exports = webhookRouter;
