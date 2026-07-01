const express = require('express');
const router = express.Router();
const { createService, getMyServices, deleteService, updateService, getServiceById, getBusinessServiceById, getServiceUploadUrl, createParentService, addChildServices, getParentServices, getChildServices } = require('../controllers/serviceController');
const { deleteChildService } = require('../controllers/serviceChildController');
const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const isCustomer = require('../middlewares/isCustomer');
const { listReviews, upsertReview, deleteReview } = require('../controllers/reviewController');

router.get(
  '/upload-url',
  authenticate,
  isBusinessOwner,
  getServiceUploadUrl
);

router.get(
  '/parent-services',
  authenticate,
  isBusinessOwner,
  getParentServices
);

router.get(
  '/child-services/:parentServiceId',
  authenticate,
  isBusinessOwner,
  getChildServices
);

router.delete(
  '/:parentServiceId/child-services/:childServiceId',
  authenticate,
  isBusinessOwner,
  deleteChildService
);

router.post(
  '/parent',
  authenticate,
  isBusinessOwner,
  createParentService
);

router.post(
  '/add-child-services',
  authenticate,
  isBusinessOwner,
  addChildServices
);

router.post(
  '/',
  authenticate,
  isBusinessOwner,
  createService
);


router.get(
  '/my-services',
  authenticate,
  isBusinessOwner,
  getMyServices
);

router.get(
  '/business-service/:id',
  getBusinessServiceById
);

router.get(
  '/:serviceId/reviews',
  listReviews('service')
);

router.post(
  '/:serviceId/reviews',
  authenticate,
  isCustomer,
  upsertReview('service')
);

router.delete(
  '/:serviceId/reviews/:reviewId',
  authenticate,
  isCustomer,
  deleteReview('service')
);

router.get(
  '/:id',
  authenticate,
  isBusinessOwner,
  getServiceById
);

router.delete(
  '/delete-service/:id',
  authenticate,
  isBusinessOwner,
  deleteService
);


router.put(
  '/:id',
  authenticate, 
  isBusinessOwner,
  updateService // controller method
);





router.get('/', (req, res) => {
  res.json({ message: 'Mosaic Biz Hub API is working 5feb' });
});

module.exports = router;
