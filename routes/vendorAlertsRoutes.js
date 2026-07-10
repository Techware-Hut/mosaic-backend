const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const { getVendorAlertsSummary } = require('../controllers/vendorAlertsController');

router.get('/summary', authenticate, isBusinessOwner, getVendorAlertsSummary);

module.exports = router;
