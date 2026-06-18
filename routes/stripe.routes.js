const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const isAdmin = require('../middlewares/isAdmin');
const {
  createAccountSession,
  createExpressLoginLink,
  getAccountBalance,
  getLastPayout,
  backfillMissingStripeCustomers,
} = require('../controllers/stripe.controller');

// POST /stripe/account-session
router.post('/account-session', authenticate, isBusinessOwner, createAccountSession);
router.post('/express-login-link', authenticate, isBusinessOwner, createExpressLoginLink);

router.get('/account-balance', authenticate, isBusinessOwner, getAccountBalance);
router.get('/last-payout', authenticate, isBusinessOwner, getLastPayout);

router.post('/backfill-customers', authenticate, isAdmin, backfillMissingStripeCustomers);



module.exports = router;
