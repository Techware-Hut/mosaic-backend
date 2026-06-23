const express = require('express');
const router = express.Router();
const { getAllServices, getServiceBySlug, getAllProducts,getProductsByFilters, getAllFood, getProductById, getVendorProfile, getProductsByBusinessId, getServiceById, getFoodById, searchPublicListings} = require('../controllers/publicListing');
const { listProductsRanked  } = require('../controllers/productListingController');
const attachSimilarQuery = require('../middlewares/attachSimilarQuery');


router.get('/services/list', getAllServices);
router.get('/public/search', searchPublicListings);

router.get('/services/:slug', getServiceBySlug);
router.get('/public/services/:id', getServiceById);
router.get('/public/foods/:id', getFoodById);

router.get('/products/list', getAllProducts);//this api used in productpage for filtering
router.get('/products/filters', getProductsByFilters);

router.get('/public/product/:productId', getProductById);

router.get('/public/product/vendor-profile/:businessId', getVendorProfile);

router.get('/public/products/business/:businessId', getProductsByBusinessId);

// router.get('/products/:slug', getProductBySlug);

router.get('/food/list', getAllFood);

// router.get('/food/:slug', getFoodBySlug);




// GET /api/ranked?categoryId=&subcategoryId=&page=1&pageSize=24&maxPerVendor=3
router.get('/ranked', listProductsRanked);
router.get('/:id/similar', attachSimilarQuery , listProductsRanked)





module.exports = router;
