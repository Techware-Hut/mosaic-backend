const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const userController = require('../controllers/userController');
const authenticate = require('../middlewares/authenticate')
const toPublicAuthUser = require('../utils/toPublicAuthUser');
const {
  resolveSessionPolicy, readCredentialCookie, readBearerCredential,
} = require('../utils/sessionPolicy');
const { sendError, sendUnauthorized } = require('../utils/apiError');

const router = express.Router();

function buildAuthLimiter(max, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: {
      success: false,
      message,
    },
  });
}

// Rate limiters for sensitive auth flows
const registerLimiter = buildAuthLimiter(
  5,
  'Too many registration attempts. Please try again later.'
);

const loginLimiter = buildAuthLimiter(
  15,
  'Too many login attempts. Please try again later.'
);

const otpVerifyLimiter = buildAuthLimiter(
  10,
  'Too many OTP verification attempts. Please try again later.'
);

const otpResendLimiter = buildAuthLimiter(
  5,
  'Too many OTP resend attempts. Please try again later.'
);

const forgotPasswordLimiter = buildAuthLimiter(
  5,
  'Too many password reset requests. Please try again later.'
);

const resetPasswordLimiter = buildAuthLimiter(
  10,
  'Too many password reset attempts. Please try again later.'
);

function toAuthCheckUser(user) {
  return toPublicAuthUser(user);
}

// Register route
router.post(
  '/register',
  registerLimiter,
  [
    body('name').notEmpty().trim().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('mobile').trim().notEmpty().withMessage('Mobile number is required').isMobilePhone('any').withMessage('Enter a valid mobile number'),
    body('role').optional().isIn(['customer', 'business_owner']).withMessage('Invalid role'),
  ],
  userController.registerUser
);

// Login route
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  userController.loginUser
);

router.post('/logout', userController.logout);

router.post(
  '/verify-otp',
  otpVerifyLimiter,
  [
    body('email').optional().isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required'),
    body('mobile').optional().trim().notEmpty().withMessage('Valid mobile number is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  userController.verifyOtp
);

router.post(
  '/resend-otp',
  otpResendLimiter,
  [
    body('email').optional().isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required'),
    body('mobile').optional().trim().notEmpty().withMessage('Valid mobile number is required'),
  ],
  userController.resendOtp
);

router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  [body('email').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required')],
  userController.forgotPassword
);

router.post(
  '/reset-password',
  resetPasswordLimiter,
  [
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  userController.resetPassword
);

// Compatibility metadata is not an authentication credential. Keep all JWT,
// identity and session-version checks in the existing authenticate middleware.
function requireAuthCheckCompatibility(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  let policy;
  try { policy = resolveSessionPolicy(); }
  catch {
    return sendUnauthorized(req, res, 'Invalid authentication session policy configuration', {
      code: 'INVALID_AUTH_SESSION_POLICY',
    });
  }

  let selectedCookie;
  if (policy.staging) {
    try {
      selectedCookie = readCredentialCookie(req, policy.cookieNames.token);
      readBearerCredential(req);
    } catch {
      return sendUnauthorized(req, res, 'Conflicting authentication credentials', {
        code: 'AUTH_CREDENTIAL_CONFLICT',
      });
    }
  }

  // Read the raw query so Express parser choices cannot hide duplicates/arrays.
  const query = new URL(req.originalUrl || req.url || '/auth/check', 'http://auth-check.invalid').searchParams;
  const values = query.getAll('sessionPolicy');
  const structured = [...query.keys()].some((key) => /^sessionPolicy[\[.]/.test(key));
  const supplied = values.length > 0 || structured;
  if ((supplied && (structured || values.length !== 1 ||
      !['legacy', 'staging-v1'].includes(values[0]) || values[0] !== policy.mode)) ||
      (!supplied && policy.staging && selectedCookie.present)) {
    return sendError(req, res, 409, {
      message: 'Frontend and backend session policies do not match',
      code: 'AUTH_SESSION_POLICY_MISMATCH',
    });
  }

  // Unmarked anonymous and bearer-only clients retain the existing auth path.
  res.locals.authCheckSessionPolicy = policy.mode;
  return next();
}

router.get('/auth/check', requireAuthCheckCompatibility, authenticate, (req, res) => {
  res.json({
    loggedIn: true,
    sessionPolicy: res.locals.authCheckSessionPolicy,
    user: toAuthCheckUser(req.user),
  });
});

// ── Vendor Settings ────────────────────────────────────────────────────────────

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  userController.changePassword
);

router.get('/notification-preferences', authenticate, userController.getNotificationPreferences);

router.patch(
  '/notification-preferences',
  authenticate,
  [
    body('newBookingOrOrder').optional().isBoolean(),
    body('newReview').optional().isBoolean(),
    body('paymentReceived').optional().isBoolean(),
    body('marketingEmails').optional().isBoolean(),
  ],
  userController.updateNotificationPreferences
);

module.exports = router;
