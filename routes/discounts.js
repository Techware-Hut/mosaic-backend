const express = require('express');
const {
  createDiscount,
  getBusinessDiscounts,
  getDiscountById,
  updateDiscount,
  deleteDiscount,
  validateCoupon,
  applyCoupon
} = require('../controllers/discountController');

const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');

const router = express.Router();

// ============================================
// SPECIAL ROUTES (VALIDATION / APPLY)
// ============================================

/**
 * @route   POST /api/discounts/validate
 * @desc    Validate coupon code
 * @access  Public / Private (your choice)
 */
router.post('/validate', validateCoupon);

/**
 * @route   POST /api/discounts/apply
 * @desc    Apply coupon to order/cart
 * @access  Public / Private
 */
router.post('/apply', applyCoupon);


// ============================================
// BUSINESS DISCOUNT ROUTES
// ============================================

/**
 * @route   GET /api/discounts/business/:businessId
 * @desc    Get all discounts for a business
 * @access  Private
 */
router.get(
  '/business/:businessId',
  authenticate,
  isBusinessOwner,
  getBusinessDiscounts
);


// ============================================
// CRUD ROUTES
// ============================================

/**
 * @route   POST /api/discounts
 * @desc    Create new discount
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  isBusinessOwner,
  createDiscount
);

/**
 * @route   GET /api/discounts/:id
 * @desc    Get discount by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  isBusinessOwner,
  getDiscountById
);

/**
 * @route   PUT /api/discounts/:id
 * @desc    Update discount
 * @access  Private
 */
router.put(
  '/:id',
  authenticate,
  isBusinessOwner,
  updateDiscount
);

/**
 * @route   DELETE /api/discounts/:id
 * @desc    Delete discount
 * @access  Private
 */
router.delete(
  '/:id',
  authenticate,
  isBusinessOwner,
  deleteDiscount
);

module.exports = router;