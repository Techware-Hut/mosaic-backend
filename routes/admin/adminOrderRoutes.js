const express = require('express');
const { getAllOrdersAdmin } = require('../../controllers/orderController');
const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');

const router = express.Router();

// Admin order list — alias for GET /api/orders/admin (frontend /admin/api/* pattern)
router.get('/', authenticate, isAdmin, getAllOrdersAdmin);

module.exports = router;
