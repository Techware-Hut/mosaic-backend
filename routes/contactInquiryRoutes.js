const express = require('express');
const router = express.Router();

const { createContactInquiry } = require('../controllers/contactInquiry.controller');
const { contactInquiryLimiter } = require('../middlewares/publicRateLimit');
const { requireRecaptcha } = require('../utils/recaptcha');

// Rate limit first (cheap, also caps calls to Google), then reCAPTCHA.
router.post('/', contactInquiryLimiter, requireRecaptcha(), createContactInquiry);

module.exports = router;
