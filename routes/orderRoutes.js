const express = require('express');
const router = express.Router();
const { initiateOrder, getUserOrders, getVendorOrders, acceptOrder, rejectOrder, shipOrder, getAllOrdersAdmin, deliverOrder, acceptReturn, initiateReturn, cancelOrderByUser } = require('../controllers/orderController');
const { retrieveIntent } = require('../controllers/stripePaymentController');
const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner')
const isAdmin = require('../middlewares/isAdmin');
const isCustomer = require('../middlewares/isCustomer');
const { getInvoicePdf } = require('../controllers/invoiceController');



router.post('/initiate', authenticate, isCustomer, initiateOrder);
router.get('/retrieve-intent/:id', authenticate, retrieveIntent);
router.get('/user', authenticate, getUserOrders);
router.get('/:id/invoice.pdf', authenticate, getInvoicePdf);
router.get('/vendor', authenticate, isBusinessOwner, getVendorOrders);
router.put('/accept/:orderId', authenticate, isBusinessOwner, acceptOrder);
router.put('/reject/:orderId', authenticate, isBusinessOwner, rejectOrder);
router.put('/ship/:orderId', authenticate, isBusinessOwner, shipOrder);
router.put('/deliver/:orderId', authenticate, isBusinessOwner, deliverOrder);
router.put('/return/:orderId', authenticate, isBusinessOwner, acceptReturn);
router.put('/initiateReturn/:orderId', authenticate, isCustomer, initiateReturn);
router.post("/:orderId/cancel", authenticate, isCustomer, cancelOrderByUser);
router.get('/admin', authenticate, isAdmin, getAllOrdersAdmin);




module.exports = router;
