const express = require('express');
const { getAdminSalesSummary, getAllOrdersAdmin } = require('../../controllers/orderController');
const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');

const router = express.Router();

// Admin order list — alias for GET /api/orders/admin (frontend /admin/api/* pattern)
router.get('/summary', authenticate, isAdmin, getAdminSalesSummary);
router.get('/', authenticate, isAdmin, getAllOrdersAdmin);

module.exports = router;
