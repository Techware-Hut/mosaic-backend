const express = require('express');
const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');
const {
  listAllPlatformReviews,
  toggleReviewVisibility,
  removePlatformReview,
} = require('../../controllers/admin/adminReviewController');

const router = express.Router();

router.use(authenticate, isAdmin);

router.get('/', listAllPlatformReviews);
router.patch('/:reviewId/moderation', toggleReviewVisibility);
router.delete('/:reviewId', removePlatformReview);

module.exports = router;
