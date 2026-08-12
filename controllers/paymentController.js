const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Stripe secret key
const { validationResult } = require('express-validator');
const Order = require('../models/Order');

function normalizeCurrency(currency) {
  return String(currency || 'usd').trim().toLowerCase();
}

function toStripeAmount(totalAmount) {
  const numericTotal = Number(totalAmount);
  if (!Number.isFinite(numericTotal) || numericTotal <= 0) {
    return null;
  }
  return Math.round(numericTotal * 100);
}

// Create Payment Intent
const createPaymentIntent = async (req, res) => {
  // Validate inputs
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { amount, currency, orderId } = req.body;

  try {
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const requestUserId = String(req.user?.id || req.user?._id || '');
    if (!requestUserId || order.userId.toString() !== requestUserId) {
      return res.status(403).json({ message: 'Not allowed to pay for this order.' });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({ message: 'Order is already paid.' });
    }

    const derivedAmount = toStripeAmount(order.totalAmount);
    if (!derivedAmount) {
      return res.status(400).json({ message: 'Order total is invalid.' });
    }

    const derivedCurrency = normalizeCurrency(order.currency);
    const requestedAmount = amount === undefined ? undefined : Number(amount);
    const requestedCurrency = currency === undefined ? undefined : normalizeCurrency(currency);

    if (requestedAmount !== undefined && !Number.isNaN(requestedAmount)) {
      if (Math.round(requestedAmount * 100) !== derivedAmount) {
        return res.status(400).json({ message: 'Client payment amount does not match the server-derived order total.' });
      }
    }

    if (requestedCurrency !== undefined && requestedCurrency !== derivedCurrency) {
      return res.status(400).json({ message: 'Client payment currency does not match the order currency.' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: derivedAmount,
      currency: derivedCurrency,
      metadata: { orderId },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'always',
      },
    });

    order.paymentId = paymentIntent.id;
    await order.save();

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      amount: derivedAmount,
      currency: derivedCurrency,
    });
  } catch (error) {
    console.error('Stripe payment intent creation failed:', error);

    // Specific error handling based on the Stripe error type
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ message: 'Card error: ' + error.message });
    }
    if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ message: 'Invalid request: ' + error.message });
    }

    res.status(500).json({ message: 'Payment creation failed. Please try again later.' });
  }
};

module.exports = {
  createPaymentIntent,
};
