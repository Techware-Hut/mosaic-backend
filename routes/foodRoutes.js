const express = require('express');
const router = express.Router();

const {
  createFood,
  getMyFoods,
  getBusinessFoodById,
  getFoodById,
  updateFood,
  deleteFood,
  getFoodUploadUrl,
} = require('../controllers/foodController');

const authenticate = require('../middlewares/authenticate');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const isCustomer = require('../middlewares/isCustomer');
const { listReviews, upsertReview, deleteReview } = require('../controllers/reviewController');

router.get('/upload-url', authenticate, isBusinessOwner, getFoodUploadUrl);

router.post('/add-food', authenticate, isBusinessOwner, createFood);

router.get('/my-foods', authenticate, isBusinessOwner, getMyFoods);

router.get('/business-food/:id', getBusinessFoodById);

router.get('/:foodId/reviews', listReviews('food'));

router.post('/:foodId/reviews', authenticate, isCustomer, upsertReview('food'));

router.delete('/:foodId/reviews/:reviewId', authenticate, isCustomer, deleteReview('food'));

router.get('/food-by-id/:id', authenticate, isBusinessOwner, getFoodById);

router.put('/update-food/:id', authenticate, isBusinessOwner, updateFood);

router.delete('/delete-food/:id', authenticate, isBusinessOwner, deleteFood);

router.get('/', (req, res) => {
  res.json({ message: 'Food API is working' });
});

module.exports = router;
