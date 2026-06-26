const express = require('express');
const {
  getAllCategoriesAdmin,
  getAllCategories,
  getProductCategories,
  getServiceCategories,
  getFoodCategories,
  getProductSubcategories,
  listSubcategories,
  createCategoryRequest,
  getMyCategoryRequests,
} = require('../controllers/categoryController');
const s3Controller = require('../controllers/s3Controller');
const authenticate = require('../middlewares/authenticate');
const isAdmin = require('../middlewares/isAdmin');
const isBusinessOwner = require('../middlewares/isBusinessOwner');
const isBusinessOwnerOrAdmin = require('../middlewares/isBusinessOwnerOrAdmin');
const router = express.Router();

// Route to get all categories
router.get('/categories', getAllCategories);
router.get('/categories/products', getProductCategories);
router.get('/categories/services', getServiceCategories);
router.get('/categories/foods', getFoodCategories);
router.post('/category-requests', authenticate, isBusinessOwner, createCategoryRequest);
router.get('/category-requests/my', authenticate, isBusinessOwner, getMyCategoryRequests);
router.get('/getProductCategories', getProductCategories);
router.get('/subcategories/:categoryId', getProductSubcategories);
router.get('/sub-categories', listSubcategories);
router.get("/s3-presigned-url", authenticate,isBusinessOwnerOrAdmin, s3Controller.getPresignedUrl);
router.get('/admin/categories', authenticate, isAdmin, getAllCategoriesAdmin);


module.exports = router;
