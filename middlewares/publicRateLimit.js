'use strict';

// Per-IP rate limiters for unauthenticated endpoints that cost money or reach a
// human (Google Places billing, admin inbox, coupon guessing). app.js sets
// `trust proxy` to 1, so req.ip is the client address behind the EB load balancer.

const rateLimit = require('express-rate-limit');

function buildPublicLimiter({ name, windowMs, max, message }) {
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Unit tests drive handlers directly; the limiter's presence is asserted separately.
    skip: () => process.env.NODE_ENV === 'test',
    message: { success: false, code: 'RATE_LIMITED', message },
  });
  // Named so route tests can assert the limiter is mounted.
  Object.defineProperty(limiter, 'name', { value: name });
  return limiter;
}

const googlePlacesLimiter = buildPublicLimiter({
  name: 'googlePlacesLimiter',
  windowMs: 60 * 1000,
  max: 60, // autocomplete fires while typing; ~1/sec sustained is generous
  message: 'Too many address lookups. Please wait a moment and try again.',
});

const contactInquiryLimiter = buildPublicLimiter({
  name: 'contactInquiryLimiter',
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many messages sent. Please try again later.',
});

const couponLimiter = buildPublicLimiter({
  name: 'couponLimiter',
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many coupon attempts. Please try again later.',
});

module.exports = {
  buildPublicLimiter,
  googlePlacesLimiter,
  contactInquiryLimiter,
  couponLimiter,
};
