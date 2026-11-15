const express = require('express');
const router = express.Router();

const {
  createServiceBooking,
  createFoodBooking,
  requestServiceBookingPayment,
  approveServiceBooking,
  rejectServiceBooking,
  getVendorBookings,
  getVendorServiceBookings,
  getVendorFoodBookings,
  getCustomerBookings,
  getCustomerServiceBookings,
  getCustomerFoodBookings,
  updateBookingStatus,
  deleteBooking,
} = require('../controllers/bookingController');

const authenticate = require('../middlewares/authenticate');
const isCheckoutBuyer = require('../middlewares/isCheckoutBuyer');
const isAdmin = require('../middlewares/isAdmin');
const isBusinessOwner = require('../middlewares/isBusinessOwner');

router.post('/service', authenticate, isCheckoutBuyer, createServiceBooking);
router.post('/service/:serviceId', authenticate, isCheckoutBuyer, createServiceBooking);
router.post('/food', authenticate, isCheckoutBuyer, createFoodBooking);
router.post('/food/:foodId', authenticate, isCheckoutBuyer, createFoodBooking);

router.get('/vendor', authenticate, isBusinessOwner, getVendorBookings);
router.get('/vendor/service', authenticate, isBusinessOwner, getVendorServiceBookings);
router.get('/vendor/food', authenticate, isBusinessOwner, getVendorFoodBookings);
router.get('/customer', authenticate, isCheckoutBuyer, getCustomerBookings);
router.get('/customer/service', authenticate, isCheckoutBuyer, getCustomerServiceBookings);
router.get('/customer/food', authenticate, isCheckoutBuyer, getCustomerFoodBookings);
router.put('/service/:id/request-payment', authenticate, isBusinessOwner, requestServiceBookingPayment);
router.put('/service/:id/approve', authenticate, isBusinessOwner, approveServiceBooking);
router.put('/service/:id/reject', authenticate, isBusinessOwner, rejectServiceBooking);

router.put('/confirm/:id', authenticate, isBusinessOwner, (req, res) => {
  req.body.status = 'confirmed';
  updateBookingStatus(req, res);
});

router.put('/complete/:id', authenticate, isBusinessOwner, (req, res) => {
  req.body.status = 'completed';
  updateBookingStatus(req, res);
});

router.put('/cancel/:id', authenticate, (req, res) => {
  req.body.status = 'cancelled';
  updateBookingStatus(req, res);
});

router.delete('/:id', authenticate, isAdmin, deleteBooking);

module.exports = router;
