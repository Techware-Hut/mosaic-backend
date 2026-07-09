const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const upload = require('../middlewares/upload');
const businessController = require('../controllers/businessController');

// Validation middleware
const validateBusiness = [
  body('businessName').trim().notEmpty().withMessage('Business name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('description').optional().trim(),
  body('website').optional().isURL().withMessage('Website must be a valid URL'),
];

// Create a business (protected)
router.post(
  '/',
  authenticate,
  isBusinessOwner,
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  validateBusiness,
  businessController.createBusiness
);
router.post(
  '/retry-create',
  authenticate,
  isBusinessOwner,
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  validateBusiness,
  businessController.retryCreateBusiness
);

// Get businesses for current user
router.get(
  '/my',
  authenticate,
  isBusinessOwner,
  businessController.getMyBusinesses
);

router.post(
  '/:id/publish-storefront',
  authenticate,
  isBusinessOwner,
  businessController.publishStorefront
);

router.get(
  '/:id/shipping-settings',
  authenticate,
  isBusinessOwner,
  businessController.getBusinessShippingSettings
);

router.put(
  '/:id/shipping-settings',
  authenticate,
  isBusinessOwner,
  businessController.updateBusinessShippingSettings
);

router.get(
  '/:id/tax-settings',
  authenticate,
  isBusinessOwner,
  businessController.getBusinessTaxSettings
);

router.put(
  '/:id/tax-settings',
  authenticate,
  isBusinessOwner,
  businessController.updateBusinessTaxSettings
);

// Get a single business by slug (public)
router.get('/public/:slug', businessController.getBusinessBySlugPublic);

router.get(
  '/:slug',
  authenticate,
  isBusinessOwner,
  businessController.getBusinessBySlug
);




router.put(
  '/:id',
  authenticate,
  isBusinessOwner,
  businessController.updateBusiness
);

// Delete business
router.delete(
  '/:id',
  authenticate,
  isBusinessOwner,
  businessController.deleteBusiness
);


///


router.post('/draft', authenticate, isBusinessOwner, businessController.createBusinessDraft);

// Vendor-controlled listing visibility toggle
router.patch('/:id/visibility', authenticate, isBusinessOwner, businessController.updateBusinessVisibility);




router.get('/', businessController.getProductBusinesses);

module.exports = router;
