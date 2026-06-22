const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const userController = require('../controllers/userController');
const authenticate = require('../middlewares/authenticate')
const toPublicAuthUser = require('../utils/toPublicAuthUser');

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
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  userController.verifyOtp
);

router.post(
  '/resend-otp',
  otpResendLimiter,
  [body('email').isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }).withMessage('Valid email is required')],
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

router.get('/auth/check', authenticate, (req, res) => {
  res.json({ loggedIn: true, user: toAuthCheckUser(req.user) });
});

module.exports = router;
