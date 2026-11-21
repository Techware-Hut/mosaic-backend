'use strict';

const rateLimit = require('express-rate-limit');

// Per-IP limiter for the public contact form. Each call returns a fresh store,
// so tests can mount their own instance. app.js supplies the trust proxy policy.
function createContactInquiryLimiter() {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many messages sent. Please try again later.',
    },
  });
  Object.defineProperty(limiter, 'name', { value: 'contactInquiryLimiter' });
  return limiter;
}

module.exports = {
  createContactInquiryLimiter,
  contactInquiryLimiter: createContactInquiryLimiter(),
};
