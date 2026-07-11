const express = require('express');

const router = express.Router();

const authenticate = require('../middlewares/authenticate');
const isCustomer = require('../middlewares/isCustomer');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const {
  createRevealEnquiry,
  createServiceRfq,
  getVendorEnquiries,
  getVendorRfqs,
} = require('../controllers/customer/enquiry');

router.post('/reveal', authenticate, createRevealEnquiry);
router.post('/rfq', authenticate, isCustomer, createServiceRfq);
router.get('/vendor', authenticate, isBusinessOwner, getVendorEnquiries);
router.get('/vendor/rfqs', authenticate, isBusinessOwner, getVendorRfqs);

module.exports = router;
