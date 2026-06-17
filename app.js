const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const userRoutes = require('./routes/userRoutes')
const businessRoutes = require('./routes/businessRoutes');
const vendorOnboardRoutes = require('./routes/vendorOnboarding.routes');
const subscriptionPlanRoutes = require('./routes/subscriptionPlanRoutes')
const productRoutes = require('./routes/productRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const foodRoutes = require('./routes/foodRoutes');
const minorityTypeRoutes = require('./routes/minorityTypeRoutes');
const uploadImageRoute = require('./routes/uploadImage')
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const subcategoryRoutes = require('./routes/subcategoryRoutes');
const publicListingRoutes = require('./routes/publicListing');
const privateListingRoutes = require('./routes/privateListing');
const businessProfileRoutes = require('./routes/businessProfileRoutes');
const cmsRoutes = require('./routes/admin/cmsRoutes');







// admin Routes
const adminUserRoutes = require('./routes/admin/userRoutes')
const adminFaqRoutes = require('./routes/admin/faqRoutes');
const testimonialRoutes = require('./routes/admin/testimonialRoutes');
const blogRoutes = require('./routes/admin/Blog/blogRoutes');
const productCategoryRoutes = require('./routes/admin/productCategoryRoutes')
const productSubcategoryRoutes = require('./routes/admin/productSubcategoryRoutes')
const ServiceCategoryRoutes = require('./routes/admin/categoryRoutes')
const categoryRequestRoutes = require('./routes/admin/categoryRequestRoutes');
const serviceSubcategoryRoutes = require('./routes/admin/serviceSubcategoryRoutes');
const foodCategoryRoutes = require('./routes/admin/foodCategoryRoutes')
const foodSubcategoryRoutes = require('./routes/admin/foodSubcategoryRoutes');
const adminBusinessRoutes = require('./routes/admin/businessRoutes')
const adminProductRoutes = require('./routes/admin/adminProductRoutes')
const vendorOnboardVerifyStage1Routes= require("./routes/vendorOnboarding.routes")


// User Routes
const wishlistRoutes = require('./routes/customer/wishlistRoutes');
const cartRoutes = require('./routes/customer/cartRoutes');

//discount route

const discountRoutes = require('./routes/discounts');

// Service Booking Route

const bookingRoutes = require('./routes/bookingRoutes')



// Import Payment and Order Routes
const paymentRoutes = require('./routes/paymentRoutes');
const orderRoutes = require('./routes/orderRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

// Stripe connect 
const connectRoutes = require('./routes/connectRoutes');
const stripeNewRoutes = require('./routes/stripe.routes');

// biling
const apiRoutes = require('./routes/api.routes');



const googlePlace = require('./routes/googlePlace');
const featuredProductRoutes = require('./routes/featuredProductRoutes');
const contactInquiryRoutes = require('./routes/contactInquiryRoutes');

const authRoutes = require('./routes/authRoutes');
const enquiryRoutes = require('./routes/enquiryRoutes');





const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const app = express();

const allowedOrigins = Array.from(
  new Set([
    'https://www.mosaicbizhub.com',
    'https://app.mosaicbizhub.com',
    'https://mosaic-biz-frontend-launch.vercel.app',
    'http://localhost:3000',
    'http://localhost:8081',
    'https://app.minorityownedbusiness.info',
    'http://192.168.1.50:3000',
    'exp://192.168.0.104:8081',
    'exp://192.168.0.104:3000',
    'exp://192.168.0.104:3001',
    process.env.FRONTEND_URL,
  ].filter(Boolean))
);
app.set('trust proxy', 1);
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));




// Subscrption
app.use(cookieParser());
const stripeRoutes = require('./routes/stripeRoutes');

const { handleVendorPaymentWebhook } = require('./controllers/vendorOnboarding.controller');
const { handleSubscriptionWebhook } = require('./controllers/webhookController');


app.use('/api/stripe', stripeRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/vendor-onboarding/webhook/payment', 
  express.raw({ type: 'application/json' }), 
  handleVendorPaymentWebhook
);
app.use('/api/subscription/webhook', 
  express.raw({ type: 'application/json' }), 
  handleSubscriptionWebhook
);
app.use(express.json());


app.use('/api/product', productRoutes);
app.use('/api', publicListingRoutes);
app.use('/api/private', privateListingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/vendor-onboarding', vendorOnboardRoutes);
app.use('/admin/vendor-onboard-verify-stage1', vendorOnboardVerifyStage1Routes);
app.use('/api/subscription-plans', subscriptionPlanRoutes);
app.use('/api/service', serviceRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/minority-types', minorityTypeRoutes);
app.use('/api', uploadImageRoute);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api', categoryRoutes);
app.use('/api', subcategoryRoutes);

app.use('/api/cms', cmsRoutes);



//CMS Route's For maneging the admin content
app.use('/cms', cmsRoutes);


// Admin Routes
app.use('/admin/users', adminUserRoutes);
app.use('/admin/faqs', adminFaqRoutes);
app.use('/api/admin/testimonials', testimonialRoutes);
app.use('/admin/api/blogs', blogRoutes);
app.use('/admin/api/business', adminBusinessRoutes);
app.use('/api/admin/business', adminBusinessRoutes);
app.use('/admin/api/products', adminProductRoutes);
app.use('/api/business-profile', businessProfileRoutes);
app.use('/api/admin/category/product', productCategoryRoutes);
app.use('/api/admin/category/product-subcategory', productSubcategoryRoutes);
app.use('/api/admin/category/service', ServiceCategoryRoutes);
app.use('/api/admin/category-requests', categoryRequestRoutes);
app.use('/api/admin/category/service-subcategory', serviceSubcategoryRoutes);
app.use('/api/admin/category/food', foodCategoryRoutes);
app.use('/api/admin/category/food-subcategory', foodSubcategoryRoutes);
// In app.js, add:
const businessProfileVerifyRoutes = require('./routes/admin/businessProfileVerifyRoutes');
app.use('/admin/business-profile-verify', businessProfileVerifyRoutes);



// disount routes 

app.use('/api/discounts', discountRoutes);


// User Routes
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/cart', cartRoutes);




app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/bookings', bookingRoutes)
app.use('/api/connect', connectRoutes);



// subscription 


app.use('/stripe', stripeNewRoutes);



// billing

app.use('/api', apiRoutes);


// Place Api

app.use('/api/google-places', googlePlace)
app.use('/api', featuredProductRoutes);
app.use('/api/contact-inquiry', contactInquiryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/enquiries', enquiryRoutes);



// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Mosaic Biz Hub API is working 9 feb ' });
});

const { isSentryEnabled } = require('./instrument');

if (process.env.ENABLE_SENTRY_DEBUG_ROUTE === 'true' && isSentryEnabled()) {
  app.get('/internal/sentry-debug', (_req, _res) => {
    throw new Error('Sentry debug route test error');
  });
}

if (isSentryEnabled()) {
  const Sentry = require('./instrument');
  Sentry.setupExpressErrorHandler(app);
}

// require('./jobs/cleanupImages');

module.exports = app;
