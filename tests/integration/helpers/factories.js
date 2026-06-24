const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../../../models/User');
const Business = require('../../../models/Business');
const Product = require('../../../models/Product');
const Service = require('../../../models/Service');
const ServiceCategory = require('../../../models/ServiceCategory');
const ServiceSubcategory = require('../../../models/ServiceSubcategory');
const Subscription = require('../../../models/Subscription');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const VendorOnboarding = require('../../../models/VendorOnboardingStage1');
const Discount = require('../../../models/Discounts');
const { getCapturedOtp } = require('./otpCapture');

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

let mobileCounter = 0;

function uniqueMobile() {
  mobileCounter += 1;
  return `+1415555${String(mobileCounter).padStart(4, '0')}`;
}

const validStage1Draft = {
  businessName: 'Integration Test Business LLC',
  businessType: 'product',
  primaryContactName: 'Integration Vendor',
  address: {
    city: 'Atlanta',
    state: 'GA',
    country: 'USA',
    zipCode: '30301',
  },
  acceptedTerms: true,
  declarationAccepted: true,
  isMinorityOwned: false,
};

async function registerUser(agent, { role = 'customer', password = 'Secret123!' } = {}) {
  const email = uniqueEmail(role);
  const mobile = uniqueMobile();

  const res = await agent.post('/api/users/register').send({
    name: `${role} Integration`,
    email,
    password,
    mobile,
    role,
  });

  if (res.status !== 201) {
    throw new Error(
      `Register failed (${res.status}): ${JSON.stringify(res.body)}`
    );
  }

  return { res, email, password, mobile };
}

async function verifyRegistrationOtp(agent, email) {
  const otp = getCapturedOtp(email);
  if (!otp) {
    throw new Error(`No captured OTP for ${email}`);
  }

  return agent.post('/api/users/verify-otp').send({ email, otp });
}

async function registerAndVerify(agent, options = {}) {
  const { res: registerRes, email, password } = await registerUser(agent, options);
  const verifyRes = await verifyRegistrationOtp(agent, email);
  return { registerRes, verifyRes, email, password };
}

async function login(agent, email, password) {
  return agent.post('/api/users/login').send({ email, password });
}

async function createAdminDirect() {
  const email = uniqueEmail('admin');
  const password = 'AdminSecret123!';
  const user = await User.create({
    name: 'Integration Admin',
    email,
    mobile: uniqueMobile(),
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    isOtpVerified: true,
  });

  return { user, email, password };
}

async function ensureSubscriptionPlan() {
  let plan = await SubscriptionPlan.findOne({ name: 'Silver Plan' });
  if (!plan) {
    plan = await SubscriptionPlan.create({
      name: 'Silver Plan',
      price: 0,
      limits: {
        productListings: 10,
        serviceListings: 10,
        foodListings: 10,
        imageLimit: 100,
        videoLimit: 10,
      },
    });
  }
  return plan;
}

async function seedApprovedBusiness(ownerUser, overrides = {}) {
  const owner =
    ownerUser && ownerUser._id
      ? ownerUser
      : await User.findById(ownerUser);

  if (!owner) {
    throw new Error('seedApprovedBusiness requires a valid owner User');
  }

  const plan = await ensureSubscriptionPlan();
  const subscription = await Subscription.create({
    userId: owner._id,
    subscriptionPlanId: plan._id,
    stripeSubscriptionId: `sub_int_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    paymentStatus: 'COMPLETED',
    startDate: new Date(),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status: 'active',
  });

  return Business.create({
    owner: owner._id,
    businessName: 'Integration Vendor Shop',
    email: owner.email,
    isApproved: overrides.isApproved ?? true,
    isActive: overrides.isActive ?? true,
    stripeConnectAccountId: overrides.stripeConnectAccountId ?? 'acct_integration_test',
    listingType: 'product',
    subscriptionId: subscription._id,
    subscriptionPlanId: plan._id,
    ...overrides,
  });
}

async function seedServiceCategories() {
  const category = await ServiceCategory.create({
    name: `Integration Service Category ${Date.now()}`,
  });
  const subcategory = await ServiceSubcategory.create({
    name: `Integration Service Subcategory ${Date.now()}`,
    category: category._id,
  });

  return { category, subcategory };
}

async function seedServiceBusiness(ownerUser, overrides = {}) {
  return seedApprovedBusiness(ownerUser, {
    listingType: 'service',
    ...overrides,
  });
}

async function seedPublishedProduct(business, ownerUser) {
  return Product.create({
    title: 'Integration Test Product',
    description: 'Integration test product description',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: ownerUser._id,
    businessId: business._id,
    isPublished: true,
    price: 1999,
    coverImage: 'https://example.test/product.png',
    slug: `integration-product-${Date.now()}`,
  });
}

async function seedVendorOnboarding(user, overrides = {}) {
  return VendorOnboarding.create({
    userId: user._id,
    applicationId: overrides.applicationId || `MBH-INT-${Date.now()}`,
    businessName: validStage1Draft.businessName,
    status: overrides.status || 'draft',
    isMinorityOwned: overrides.isMinorityOwned ?? false,
    verificationPayment: overrides.verificationPayment || {
      status: 'paid',
      paymentIntentId: 'pi_integration_test',
    },
    ...overrides,
  });
}

async function seedDiscount(business, overrides = {}) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`.toUpperCase();

  return Discount.create({
    businessId: business._id,
    name: overrides.name || 'Integration Discount',
    couponCode: overrides.couponCode || `INT${suffix}`.slice(0, 20),
    type: overrides.type || 'percentage',
    value: overrides.value ?? 10,
    minOrderAmount: overrides.minOrderAmount ?? 0,
    isActive: overrides.isActive ?? true,
    ...overrides,
  });
}

module.exports = {
  validStage1Draft,
  registerUser,
  verifyRegistrationOtp,
  registerAndVerify,
  login,
  createAdminDirect,
  seedApprovedBusiness,
  seedServiceBusiness,
  seedServiceCategories,
  seedPublishedProduct,
  seedDiscount,
  seedVendorOnboarding,
  uniqueEmail,
};
