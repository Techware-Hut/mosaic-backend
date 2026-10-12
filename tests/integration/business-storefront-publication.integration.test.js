const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
} = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const {
  registerAndVerify,
  login,
  seedApprovedBusiness,
  seedServiceBusiness,
  seedServiceCategories,
  seedVendorOnboarding,
} = require('./helpers/factories');
const User = require('../../models/User');
const Business = require('../../models/Business');
const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const originalProductListingLimitOverride = process.env.PRODUCT_LISTING_LIMIT_OVERRIDE;

test.before(async () => {
  process.env.PRODUCT_LISTING_LIMIT_OVERRIDE = '10';
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  try {
    await stopHarness();
  } finally {
    if (originalProductListingLimitOverride === undefined) {
      delete process.env.PRODUCT_LISTING_LIMIT_OVERRIDE;
    } else {
      process.env.PRODUCT_LISTING_LIMIT_OVERRIDE = originalProductListingLimitOverride;
    }
  }
});

async function setupVendorWithDraftProduct(agent, businessOverrides = {}) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    businessName: `Storefront Publication ${Date.now()}`,
    listingType: 'product',
    chargesEnabled: true,
    payoutsEnabled: true,
    ...businessOverrides,
  });
  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });

  const product = await Product.create({
    title: 'Draft Storefront Product',
    description: 'A product created during onboarding final review.',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: business._id,
    coverImage: 'https://example.test/storefront-product.png',
    isPublished: false,
    isDeleted: false,
    price: 25,
  });

  const variant = await ProductVariant.create({
    productId: product._id,
    businessId: business._id,
    ownerId: user._id,
    attributes: { size: 'standard' },
    sku: `PUB-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    price: 25,
    stock: 5,
    images: ['https://example.test/storefront-product.png'],
    isPublished: false,
    isDeleted: false,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  return { user, business, product, variant };
}

test('GET /api/business/my returns zero listing counts and readiness blockers when vendor has no listings', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    chargesEnabled: true,
    payoutsEnabled: true,
  });
  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const res = await agent.get('/api/business/my');
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const returnedBusiness = res.body.businesses.find((item) =>
    String(item._id) === String(business._id)
  );
  assert.ok(returnedBusiness);
  assert.equal(returnedBusiness.products.length, 0);
  assert.equal(returnedBusiness.services.length, 0);
  assert.equal(returnedBusiness.foods.length, 0);
  assert.equal(returnedBusiness.listingCounts.products, 0);
  assert.equal(returnedBusiness.listingCounts.services, 0);
  assert.equal(returnedBusiness.listingCounts.serviceListings, 0);
  assert.equal(returnedBusiness.listingCounts.foods, 0);
  assert.equal(returnedBusiness.listingCounts.total, 0);
  assert.equal(returnedBusiness.onboardingReadiness.hasListing, false);
  assert.equal(returnedBusiness.onboardingReadiness.canFinalReview, false);
  assert.ok(
    returnedBusiness.onboardingReadiness.blockers.some((blocker) =>
      blocker.code === 'LISTING_REQUIRED'
    )
  );
});

test('GET /api/business/my reports draft and published listing status counts from real records', async () => {
  const agent = createAgent(getApp());
  const { business, product } = await setupVendorWithDraftProduct(agent);

  const draftRes = await agent.get('/api/business/my');
  assert.equal(draftRes.status, 200, JSON.stringify(draftRes.body));
  const draftBusiness = draftRes.body.businesses.find((item) =>
    String(item._id) === String(business._id)
  );

  assert.ok(draftBusiness);
  assert.equal(draftBusiness.products.length, 1);
  assert.equal(draftBusiness.listingCounts.products, 1);
  assert.equal(draftBusiness.listingCounts.productVariants, 1);
  assert.equal(draftBusiness.listingCounts.publishedProducts, 0);
  assert.equal(draftBusiness.listingCounts.draftProducts, 1);
  assert.equal(draftBusiness.listingCounts.statusBreakdown.products.draft, 1);
  assert.equal(draftBusiness.listingCounts.statusBreakdown.products.published, 0);
  assert.equal(draftBusiness.onboardingReadiness.hasListing, true);
  assert.equal(draftBusiness.onboardingReadiness.canFinalReview, true);
  assert.equal(draftBusiness.onboardingReadiness.canPublish, true);

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 200, JSON.stringify(publishRes.body));

  const publishedRes = await agent.get('/api/business/my');
  assert.equal(publishedRes.status, 200, JSON.stringify(publishedRes.body));
  const publishedBusiness = publishedRes.body.businesses.find((item) =>
    String(item._id) === String(business._id)
  );

  assert.equal(publishedBusiness.listingCounts.publishedProducts, 1);
  assert.equal(publishedBusiness.listingCounts.draftProducts, 0);
  assert.equal(publishedBusiness.listingCounts.statusBreakdown.products.published, 1);

  const publicProduct = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(publicProduct.status, 200, JSON.stringify(publicProduct.body));
});

test('GET /api/business/my counts product records, service offerings, and food records by business', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const productBusiness = await seedApprovedBusiness(user, {
    businessName: `Product Count ${Date.now()}`,
    listingType: 'product',
  });
  const serviceBusiness = await seedServiceBusiness(user, {
    businessName: `Service Count ${Date.now()}`,
  });
  const foodBusiness = await seedApprovedBusiness(user, {
    businessName: `Food Count ${Date.now()}`,
    listingType: 'food',
  });
  const { category, subcategory } = await seedServiceCategories();

  await Product.create({
    title: 'Counted Product',
    description: 'Product counted from Product collection.',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: productBusiness._id,
    coverImage: 'https://example.test/counted-product.png',
    isPublished: true,
    isDeleted: false,
    price: 25,
  });
  await Service.create({
    title: 'Counted Service',
    description: 'Service offerings counted from Service collection.',
    categoryId: category._id,
    subcategoryId: subcategory._id,
    ownerId: user._id,
    businessId: serviceBusiness._id,
    coverImage: 'https://example.test/counted-service.png',
    services: [
      { name: 'Session', durationMinutes: 45, price: 75 },
      { name: 'Follow-up', durationMinutes: 30, price: 45 },
      { name: 'Planning', durationMinutes: 60, price: 95 },
    ],
    isPublished: false,
  });
  await Food.create({
    title: 'Counted Food',
    description: 'Food counted from Food collection.',
    price: 18,
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: foodBusiness._id,
    businessName: foodBusiness.businessName,
    coverImage: 'https://example.test/counted-food.png',
    isPublished: true,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const res = await agent.get('/api/business/my');
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const byId = new Map(res.body.businesses.map((item) => [String(item._id), item]));
  assert.equal(byId.get(String(productBusiness._id)).listingCounts.products, 1);
  assert.equal(byId.get(String(productBusiness._id)).listingCounts.total, 1);
  assert.equal(byId.get(String(serviceBusiness._id)).services.length, 1);
  assert.equal(byId.get(String(serviceBusiness._id)).listingCounts.services, 3);
  assert.equal(byId.get(String(serviceBusiness._id)).listingCounts.serviceListings, 1);
  assert.equal(byId.get(String(serviceBusiness._id)).listingCounts.draftServices, 3);
  assert.equal(byId.get(String(serviceBusiness._id)).listingCounts.total, 3);
  assert.equal(byId.get(String(serviceBusiness._id)).publication.requiredListingCount, 3);
  assert.equal(byId.get(String(serviceBusiness._id)).onboardingReadiness.requiredListingCount, 3);
  assert.equal(byId.get(String(foodBusiness._id)).listingCounts.foods, 1);
  assert.equal(byId.get(String(foodBusiness._id)).listingCounts.total, 1);
});

test('vendor publish-storefront publishes draft product listings and makes public product visible', async () => {
  const agent = createAgent(getApp());
  const { business, product, variant } = await setupVendorWithDraftProduct(agent);

  const beforePublic = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(beforePublic.status, 404);

  const myBusinesses = await agent.get('/api/business/my');
  assert.equal(myBusinesses.status, 200);
  assert.equal(myBusinesses.body.businesses[0].products.length, 1);
  assert.equal(myBusinesses.body.businesses[0].listingCounts.products, 1);
  assert.equal(myBusinesses.body.businesses[0].publication.hasRequiredListing, true);

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 200, JSON.stringify(publishRes.body));
  assert.equal(publishRes.body.success, true);
  assert.equal(publishRes.body.publication.publicMarketplaceEligible, true);
  assert.equal(publishRes.body.publication.blockers.length, 0);

  const reloadedProduct = await Product.findById(product._id).lean();
  const reloadedVariant = await ProductVariant.findById(variant._id).lean();
  assert.equal(reloadedProduct.isPublished, true);
  assert.equal(reloadedVariant.isPublished, true);

  const afterPublic = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(afterPublic.status, 200, JSON.stringify(afterPublic.body));
  assert.equal(afterPublic.body.data.title, 'Draft Storefront Product');
});

test('publish-storefront returns actionable blockers and keeps listings private when payout is incomplete', async () => {
  const agent = createAgent(getApp());
  const { business, product, variant } = await setupVendorWithDraftProduct(agent, {
    chargesEnabled: false,
    payoutsEnabled: false,
  });

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 409);
  assert.equal(publishRes.body.success, false);
  assert.ok(
    publishRes.body.blockers.some((blocker) => blocker.code === 'PAYOUT_SETUP_REQUIRED')
  );

  const reloadedProduct = await Product.findById(product._id).lean();
  const reloadedVariant = await ProductVariant.findById(variant._id).lean();
  assert.equal(reloadedProduct.isPublished, false);
  assert.equal(reloadedVariant.isPublished, false);

  const publicRes = await agent.get(`/api/public/product/${product._id}`);
  assert.equal(publicRes.status, 404);
});

test('service vendor onboarding readiness allows final review without Connect account', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user, {
    stripeConnectAccountId: null,
    chargesEnabled: false,
    payoutsEnabled: false,
  });
  const { category, subcategory } = await seedServiceCategories();
  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });
  await Service.create({
    title: 'Non-Connect Service Listing',
    description: 'Service listing for Connect policy test.',
    categoryId: category._id,
    subcategoryId: subcategory._id,
    ownerId: user._id,
    businessId: business._id,
    coverImage: 'https://example.test/non-connect-service.png',
    services: [{ name: 'Session', durationMinutes: 45, price: 75 }],
    isPublished: false,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const res = await agent.get('/api/business/my');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const returnedBusiness = res.body.businesses.find((item) =>
    String(item._id) === String(business._id)
  );

  assert.ok(returnedBusiness);
  assert.equal(returnedBusiness.onboardingReadiness.payoutRequired, false);
  assert.equal(returnedBusiness.onboardingReadiness.payoutComplete, true);
  assert.equal(returnedBusiness.onboardingReadiness.canFinalReview, true);
  assert.equal(returnedBusiness.onboardingReadiness.canPublish, true);
  assert.ok(
    !returnedBusiness.onboardingReadiness.blockers.some((blocker) =>
      blocker.code === 'PAYOUT_SETUP_REQUIRED'
    )
  );
});

test('vendor publish-storefront publishes draft service listings', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user, {
    stripeConnectAccountId: null,
    chargesEnabled: false,
    payoutsEnabled: false,
  });
  const { category, subcategory } = await seedServiceCategories();
  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });
  const service = await Service.create({
    title: 'Draft Storefront Service',
    description: 'A service created during onboarding final review.',
    categoryId: category._id,
    subcategoryId: subcategory._id,
    ownerId: user._id,
    businessId: business._id,
    coverImage: 'https://example.test/storefront-service.png',
    services: [
      { name: 'Consultation', durationMinutes: 30, price: 50 },
      { name: 'Implementation', durationMinutes: 60, price: 125 },
    ],
    isPublished: false,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const beforeList = await agent.get('/api/services/list');
  assert.equal(beforeList.status, 200);
  assert.ok(!beforeList.body.data.some((entry) => String(entry.id || entry._id) === String(service._id)));

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 200, JSON.stringify(publishRes.body));
  assert.equal(publishRes.body.publication.payoutRequired, false);
  assert.equal(publishRes.body.publication.payoutComplete, true);
  assert.equal(publishRes.body.publication.requiredListingCount, 2);
  assert.equal(publishRes.body.publication.published.services, 2);
  assert.equal(publishRes.body.publication.published.serviceListings, 1);

  const reloadedService = await Service.findById(service._id).lean();
  assert.equal(reloadedService.isPublished, true);

  const afterDetail = await agent.get(`/api/public/services/${service._id}`);
  assert.equal(afterDetail.status, 200, JSON.stringify(afterDetail.body));
});

test('vendor publish-storefront publishes draft food listings and public food detail stays private before publish', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedApprovedBusiness(user, {
    listingType: 'food',
    stripeConnectAccountId: null,
    chargesEnabled: false,
    payoutsEnabled: false,
  });
  await seedVendorOnboarding(user, {
    businessId: business._id,
    status: 'verified',
  });
  const food = await Food.create({
    title: 'Draft Storefront Food',
    description: 'A food listing created during onboarding final review.',
    price: 18,
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: business._id,
    businessName: business.businessName,
    coverImage: 'https://example.test/storefront-food.png',
    isPublished: false,
  });

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const beforeDetail = await agent.get(`/api/public/foods/${food._id}`);
  assert.equal(beforeDetail.status, 404);

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 200, JSON.stringify(publishRes.body));
  assert.equal(publishRes.body.publication.payoutRequired, false);
  assert.equal(publishRes.body.publication.payoutComplete, true);
  assert.equal(publishRes.body.publication.published.foods, 1);

  const reloadedFood = await Food.findById(food._id).lean();
  assert.equal(reloadedFood.isPublished, true);

  const afterList = await agent.get('/api/food/list');
  assert.equal(afterList.status, 200);
  assert.ok(afterList.body.data.some((entry) => String(entry.id || entry._id) === String(food._id)));

  const afterDetail = await agent.get(`/api/public/foods/${food._id}`);
  assert.equal(afterDetail.status, 200, JSON.stringify(afterDetail.body));
});

test('publish-storefront allows the tenth Silver product when nine are already published', async () => {
  const agent = createAgent(getApp());
  const { user, business, product } = await setupVendorWithDraftProduct(agent, { isActive: false });

  await Product.insertMany(Array.from({ length: 9 }, (_, index) => ({
    title: `Published quota product ${index}`,
    slug: `published-quota-${Date.now()}-${index}`,
    description: 'Published quota fixture.',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: business._id,
    coverImage: `https://example.test/quota-${index}.png`,
    isPublished: true,
    isActive: true,
    isDeleted: false,
    price: 25,
  })));

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 200, JSON.stringify(publishRes.body));

  const [publishedProduct, publishedCount] = await Promise.all([
    Product.findById(product._id).lean(),
    Product.countDocuments({
      businessId: business._id,
      isPublished: true,
      isActive: { $ne: false },
      isDeleted: false,
    }),
  ]);
  assert.equal(publishedProduct.isPublished, true);
  assert.equal(publishedCount, 10);
});

test('publish-storefront rejects an over-quota batch before business activation or partial publication', async () => {
  const agent = createAgent(getApp());
  const { user, business, product, variant } = await setupVendorWithDraftProduct(agent, {
    isActive: false,
  });

  await Product.insertMany(Array.from({ length: 9 }, (_, index) => ({
    title: `At-cap quota product ${index}`,
    slug: `at-cap-quota-${Date.now()}-${index}`,
    description: 'At-cap quota fixture.',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: business._id,
    coverImage: `https://example.test/at-cap-${index}.png`,
    isPublished: true,
    isActive: true,
    isDeleted: false,
    price: 25,
  })));
  const secondDraft = await Product.create({
    title: 'Second draft in over-quota batch',
    description: 'Must remain a draft when the batch is rejected.',
    categoryId: new mongoose.Types.ObjectId(),
    subcategoryId: new mongoose.Types.ObjectId(),
    ownerId: user._id,
    businessId: business._id,
    coverImage: 'https://example.test/second-draft.png',
    isPublished: false,
    isActive: true,
    isDeleted: false,
    price: 30,
  });

  const publishRes = await agent.post(`/api/business/${business._id}/publish-storefront`);
  assert.equal(publishRes.status, 403, JSON.stringify(publishRes.body));
  assert.ok(publishRes.body.blockers.some((blocker) => (
    blocker.code === 'LISTING_LIMIT_REACHED' &&
    blocker.listingType === 'product' &&
    blocker.limit === 10 &&
    blocker.current === 9 &&
    blocker.attemptedIncrease === 2 &&
    blocker.projected === 11
  )));

  const [reloadedBusiness, firstDraft, secondDraftReloaded, reloadedVariant] = await Promise.all([
    Business.findById(business._id).lean(),
    Product.findById(product._id).lean(),
    Product.findById(secondDraft._id).lean(),
    ProductVariant.findById(variant._id).lean(),
  ]);
  assert.equal(reloadedBusiness.isActive, false);
  assert.equal(firstDraft.isPublished, false);
  assert.equal(secondDraftReloaded.isPublished, false);
  assert.equal(reloadedVariant.isPublished, false);
});
