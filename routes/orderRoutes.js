const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

function buildBuyNowQuoteLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many quote requests. Please try again later.' },
  });
}
const { buyNowQuote, initiateOrder, getUserOrders, getVendorOrders, acceptOrder, rejectOrder, shipOrder, getAllOrdersAdmin, deliverOrder, acceptReturn, initiateReturn, cancelOrderByUser } = require('../controllers/orderController');
const { retrieveIntent } = require('../controllers/stripePaymentController');
const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner')
const isAdmin = require('../middlewares/isAdmin');
const isCheckoutBuyer = require('../middlewares/isCheckoutBuyer');
const { getInvoicePdf } = require('../controllers/invoiceController');



router.post('/buy-now-quote', buildBuyNowQuoteLimiter(), authenticate, isCheckoutBuyer, buyNowQuote);
router.post('/initiate', authenticate, isCheckoutBuyer, initiateOrder);
router.get('/retrieve-intent/:id', authenticate, retrieveIntent);
router.get('/user', authenticate, getUserOrders);
router.get('/:id/invoice.pdf', authenticate, getInvoicePdf);
router.get('/vendor', authenticate, isBusinessOwner, getVendorOrders);
router.put('/accept/:orderId', authenticate, isBusinessOwner, acceptOrder);
router.put('/reject/:orderId', authenticate, isBusinessOwner, rejectOrder);
router.put('/ship/:orderId', authenticate, isBusinessOwner, shipOrder);
router.put('/deliver/:orderId', authenticate, isBusinessOwner, deliverOrder);
router.put('/return/:orderId', authenticate, isBusinessOwner, acceptReturn);
router.put('/initiateReturn/:orderId', authenticate, isCheckoutBuyer, initiateReturn);
router.post("/:orderId/cancel", authenticate, isCheckoutBuyer, cancelOrderByUser);
router.get('/admin', authenticate, isAdmin, getAllOrdersAdmin);




module.exports = router;
