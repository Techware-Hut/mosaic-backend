const express = require('express');
const { 
  createProductWithVariants, 
  addVariants, 
  updateVariant, 
  deleteVariant, 
  deleteProduct, 
  getProductById, 
  updateProduct,
  getVariantById, 
  updateVariantStock,
  getBusinessProducts,
  getProductUploadUrl, 
  getVariantImageUploadUrl  
} = require('../controllers/productController');
const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const isCustomer = require('../middlewares/isCustomer');
const { listReviews, upsertReview, deleteReview } = require('../controllers/reviewController');
const { 
  validateProductInput, 
  validateVariantInput, 
  validateUpdateVariantInput  
} = require('../validators/productValidators');

const router = express.Router();

// ============================================
// SPECIAL ROUTES - MUST COME FIRST
// ============================================

/**
 * @route   GET /api/product/upload-url
 * @desc    Get pre-signed URL for product image upload
 * @access  Private
 */
router.get(
  '/upload-url',
  authenticate,
  isBusinessOwner,
  getProductUploadUrl
);

/**
 * @route   GET /api/product/variant-upload-url
 * @desc    Get pre-signed URL for variant image upload
 * @access  Private
 */
router.get(
  '/variant-upload-url',
  authenticate,
  isBusinessOwner,
  getVariantImageUploadUrl
);

/**
 * @route   GET /api/product/business/:businessId
 * @desc    Get all products for a business
 * @access  Private
 */
router.get(
  '/business/:businessId',
  authenticate,
  isBusinessOwner,
  getBusinessProducts  // Note: This should be getBusinessProducts, not getProductById
);

router.get(
  '/:productId/reviews',
  listReviews('product')
);

router.post(
  '/:productId/reviews',
  authenticate,
  isCustomer,
  upsertReview('product')
);

router.delete(
  '/:productId/reviews/:reviewId',
  authenticate,
  isCustomer,
  deleteReview('product')
);

// ============================================
// PRODUCT ROUTES WITH PARAMETERS
// ============================================

/**
 * @route   POST /api/product
 * @desc    Create a new product with variants
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  isBusinessOwner,
  // validateProductInput,
  createProductWithVariants
);

/**
 * @route   GET /api/product/:productId
 * @desc    Get single product by ID with all variants
 * @access  Private
 */
router.get(
  '/:productId',
  authenticate,
  isBusinessOwner,
  getProductById
);

/**
 * @route   PUT /api/product/:productId
 * @desc    Update a product
 * @access  Private
 */
router.put(
  '/:productId',
  authenticate,
  isBusinessOwner,
  updateProduct
);

/**
 * @route   DELETE /api/product/delete-product/:productId
 * @desc    Soft delete a product and all its variants
 * @access  Private
 */
router.delete(
  '/delete-product/:productId',
  authenticate,
  isBusinessOwner,
  deleteProduct
);

// ============================================
// VARIANT ROUTES
// ============================================

/**
 * @route   GET /api/product/get-variant/:productId/:variantId
 * @desc    Get a single variant by ID
 * @access  Private
 */
router.get(
  '/get-variant/:productId/:variantId',
  authenticate,
  isBusinessOwner,
  getVariantById
);

/**
 * @route   POST /api/product/add-variants/:productId
 * @desc    Add variants to an existing product
 * @access  Private
 */
router.post(
  '/add-variants/:productId',
  authenticate,
  isBusinessOwner,
  // validateVariantInput,
  addVariants
);

/**
 * @route   PUT /api/product/update-variant/:productId/:variantId
 * @desc    Update a specific variant
 * @access  Private
 */
router.put(
  '/update-variant/:productId/:variantId',
  authenticate,
  isBusinessOwner,
  // validateUpdateVariantInput,
  updateVariant
);

/**
 * @route   PATCH /api/product/update-variantstock/:variantId
 * @desc    Update variant stock (increment/decrement/set)
 * @access  Private
 */
router.patch(
  '/update-variantstock/:variantId',
  authenticate,
  isBusinessOwner,
  updateVariantStock
);

/**
 * @route   DELETE /api/product/delete-variant/:productId/:variantId
 * @desc    Soft delete a specific variant
 * @access  Private
 */
router.delete(
  '/delete-variant/:productId/:variantId',
  authenticate,
  isBusinessOwner,
  deleteVariant
);

module.exports = router;
