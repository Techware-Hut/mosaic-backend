const express = require('express');
const { toggleProductFeatured, getAllProducts } = require('../../controllers/admin/adminProduct.controller');
const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');

const router = express.Router();

// Get all products (admin only)
router.get('/', authenticate, isAdmin, getAllProducts);

// Toggle product featured status (admin only)
router.patch('/:productId/featured', authenticate, isAdmin, toggleProductFeatured);

module.exports = router;