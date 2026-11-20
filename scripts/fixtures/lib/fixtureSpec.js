'use strict';

/**
 * Declarative list of the synthetic staging fixtures.
 *
 * Each entry has a stable `key` (stored on the document as `fixtureKey`),
 * the model it belongs to, the unique fields to check for collisions with
 * non-fixture documents, and a `build(ctx)` that returns schema-valid data.
 *
 * Coverage (see the hosted QA fixture plan and staging acceptance matrix):
 *   - 4 QA roles: buyer (customer), vendor A (seller), vendor B (vendor-buyer),
 *     admin.
 *   - food vendor with a food listing (dashboard R2 / R3 food parts).
 *   - vendor A service storefront with bookable offerings and hours (R1).
 *   - vendor A product storefront with stock-tracked variants (cart/stock).
 *
 * No Stripe objects are referenced: Connect fields stay unset and the
 * subscription ids are synthetic placeholders, never Stripe ids.
 */

const mongoose = require('mongoose');

const FIXTURE_TAG = 'mbh-synthetic-v1';
const NAME_PREFIX = '[QA-SYNTH]';
const ASSET_BASE = 'https://example.invalid/mbh-synthetic';

const ROLES = Object.freeze({
  buyer: { userKey: 'user.buyer', role: 'customer', label: 'Buyer' },
  vendorA: { userKey: 'user.vendorA', role: 'business_owner', label: 'Vendor A' },
  vendorB: { userKey: 'user.vendorB', role: 'business_owner', label: 'Vendor B' },
  admin: { userKey: 'user.admin', role: 'admin', label: 'Admin' },
  foodVendor: { userKey: 'user.foodVendor', role: 'business_owner', label: 'Food Vendor' },
});

const ROLE_ORDER = ['buyer', 'vendorA', 'vendorB', 'admin', 'foodVendor'];

const WEEKDAY_HOURS = '9:00 AM - 5:00 PM';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function listingHours() {
  return DAYS.map((day) => ({
    day,
    hours: WEEKDAY_HOURS,
    closed: day === 'Saturday' || day === 'Sunday',
  }));
}

function businessHoursObject() {
  const open = { open: '09:00', close: '17:00', closed: false };
  const closed = { open: '', close: '', closed: true };
  return {
    monday: open,
    tuesday: open,
    wednesday: open,
    thursday: open,
    friday: open,
    saturday: closed,
    sunday: closed,
  };
}

const ADDRESS = {
  street: '100 Example Way',
  city: 'Norfolk',
  state: 'VA',
  zipCode: '23510',
  country: 'USA',
};

const dec = (value) => mongoose.Types.Decimal128.fromString(value);
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function userEntry(roleName) {
  const role = ROLES[roleName];
  return {
    key: role.userKey,
    model: 'User',
    unique: (ctx) => ({ email: ctx.emails[roleName], mobile: ctx.mobiles[roleName] }),
    build: (ctx) => ({
      name: `${NAME_PREFIX} ${role.label}`,
      email: ctx.emails[roleName],
      mobile: ctx.mobiles[roleName],
      role: role.role,
      provider: 'local',
      isOtpVerified: true,
      verificationStatus: 'completed',
      ...(ctx.passwordHash ? { passwordHash: ctx.passwordHash } : {}),
    }),
  };
}

function subscriptionEntry(key, ownerRole, businessKey) {
  return {
    key,
    model: 'Subscription',
    unique: () => ({}),
    build: (ctx) => ({
      userId: ctx.id(ROLES[ownerRole].userKey),
      businessId: ctx.id(businessKey),
      subscriptionPlanId: ctx.planId,
      // Placeholder only; not a Stripe subscription id.
      stripeSubscriptionId: `mbh_synthetic_${key.replace(/\W+/g, '_')}`,
      paymentStatus: 'COMPLETED',
      payerEmail: ctx.emails[ownerRole],
      startDate: ctx.now,
      endDate: new Date(ctx.now.getTime() + YEAR_MS),
      status: 'active',
      welcomeEmailSent: true,
    }),
  };
}

function onboardingEntry(key, ownerRole, businessKey, businessType, applicationId, businessName) {
  return {
    key,
    model: 'VendorOnboardingStage1',
    unique: () => ({ applicationId }),
    build: (ctx) => ({
      userId: ctx.id(ROLES[ownerRole].userKey),
      businessId: ctx.id(businessKey),
      applicationId,
      businessName,
      businessType,
      isMinorityOwned: false,
      hasBusinessLicense: false,
      primaryContactName: `${NAME_PREFIX} ${ROLES[ownerRole].label}`,
      address: { ...ADDRESS },
      acceptedTerms: true,
      declarationAccepted: true,
      noLicenseComplianceConfirmed: true,
      // No payment object exists; this only marks Stage 1 as complete.
      verificationPayment: { status: 'paid' },
      status: 'verified',
      reviewDecision: 'approved',
      submittedAt: ctx.now,
      reviewedAt: ctx.now,
      verifiedAt: ctx.now,
    }),
  };
}

function businessEntry({ key, ownerRole, name, slug, listingType, subscriptionKey, refs }) {
  return {
    key,
    model: 'Business',
    unique: () => ({ slug }),
    build: (ctx) => ({
      owner: ctx.id(ROLES[ownerRole].userKey),
      businessName: `${NAME_PREFIX} ${name}`,
      slug,
      description: `Synthetic ${listingType} storefront for staging QA. Not a real business.`,
      email: ctx.emails[ownerRole],
      address: { ...ADDRESS },
      listingType,
      subscriptionId: ctx.id(subscriptionKey),
      subscriptionPlanId: ctx.planId,
      subscriptionStatus: 'active',
      subscriptionStartDate: ctx.now,
      subscriptionEndDate: new Date(ctx.now.getTime() + YEAR_MS),
      businessHours: businessHoursObject(),
      isApproved: true,
      isActive: true,
      approvalDate: ctx.now,
      // Stripe Connect is intentionally left unset (onboard via the UI in TEST mode).
      onboardingStatus: 'not_started',
      tags: ['mbh-synthetic'],
      ...refs(ctx),
    }),
  };
}

function categoryEntries(prefix, modelBase, name, subName) {
  const catKey = `${prefix}.category`;
  const subKey = `${prefix}.subcategory`;
  const catSlug = `mbh-synthetic-${prefix}-category`;
  const subSlug = `mbh-synthetic-${prefix}-subcategory`;
  return [
    {
      key: catKey,
      model: `${modelBase}Category`,
      unique: () => ({ name, slug: catSlug }),
      build: () => ({
        name,
        slug: catSlug,
        description: 'Synthetic category for staging QA fixtures.',
      }),
    },
    {
      key: subKey,
      model: `${modelBase}Subcategory`,
      unique: () => ({ slug: subSlug }),
      build: (ctx) => ({
        name: subName,
        slug: subSlug,
        category: ctx.id(catKey),
      }),
    },
  ];
}

function productEntries({ key, title, slug, sku, price, stock }) {
  const variantKey = `${key}.variant`;
  return [
    {
      key,
      model: 'Product',
      unique: () => ({ slug }),
      build: (ctx) => ({
        title: `${NAME_PREFIX} ${title}`,
        slug,
        description: `Synthetic product for staging QA (stock ${stock}). Not for sale.`,
        categoryId: ctx.id('product.category'),
        subcategoryId: ctx.id('product.subcategory'),
        ownerId: ctx.id(ROLES.vendorA.userKey),
        businessId: ctx.id('business.vendorA.product'),
        price: dec(price),
        attributes: [],
        shipping: { standard: 0, overnight: 0, local: 0 },
        coverImage: `${ASSET_BASE}/${slug}.png`,
        galleryImages: [],
        isPublished: true,
        isActive: true,
      }),
    },
    {
      key: variantKey,
      model: 'ProductVariant',
      unique: () => ({ sku }),
      build: (ctx) => ({
        productId: ctx.id(key),
        businessId: ctx.id('business.vendorA.product'),
        ownerId: ctx.id(ROLES.vendorA.userKey),
        attributes: {},
        sku,
        price: dec(price),
        stock,
        isPublished: true,
      }),
    },
  ];
}

const PRODUCTS = [
  {
    key: 'product.widget',
    title: 'Widget',
    slug: 'mbh-synthetic-widget',
    sku: 'MBH-SYNTH-WIDGET',
    price: '10.00',
    stock: 5,
  },
  {
    key: 'product.limited',
    title: 'Limited Item',
    slug: 'mbh-synthetic-limited-item',
    sku: 'MBH-SYNTH-LIMITED',
    price: '25.00',
    stock: 1,
  },
];

function buildFixtureSpec() {
  const entries = [];

  for (const roleName of ROLE_ORDER) {
    entries.push(userEntry(roleName));
  }

  entries.push(
    ...categoryEntries('product', 'Product', 'QA Synthetic Goods', 'QA Synthetic Widgets'),
    ...categoryEntries('service', 'Service', 'QA Synthetic Services', 'QA Synthetic Consulting'),
    ...categoryEntries('food', 'Food', 'QA Synthetic Dining', 'QA Synthetic Tasting')
  );

  entries.push(
    subscriptionEntry('subscription.vendorA.product', 'vendorA', 'business.vendorA.product'),
    subscriptionEntry('subscription.vendorA.service', 'vendorA', 'business.vendorA.service'),
    subscriptionEntry('subscription.foodVendor', 'foodVendor', 'business.foodVendor')
  );

  entries.push(
    businessEntry({
      key: 'business.vendorA.product',
      ownerRole: 'vendorA',
      name: 'Vendor A Goods',
      slug: 'mbh-synthetic-vendor-a-goods',
      listingType: 'product',
      subscriptionKey: 'subscription.vendorA.product',
      refs: (ctx) => ({
        products: PRODUCTS.map((p) => ctx.id(p.key)),
        productCategories: [ctx.id('product.category')],
        usage: { totalProducts: PRODUCTS.length },
      }),
    }),
    businessEntry({
      key: 'business.vendorA.service',
      ownerRole: 'vendorA',
      name: 'Vendor A Services',
      slug: 'mbh-synthetic-vendor-a-services',
      listingType: 'service',
      subscriptionKey: 'subscription.vendorA.service',
      refs: (ctx) => ({
        services: [ctx.id('service.consult')],
        serviceCategories: [ctx.id('service.category')],
        usage: { totalServices: 1 },
      }),
    }),
    businessEntry({
      key: 'business.foodVendor',
      ownerRole: 'foodVendor',
      name: 'Food Vendor Kitchen',
      slug: 'mbh-synthetic-food-vendor-kitchen',
      listingType: 'food',
      subscriptionKey: 'subscription.foodVendor',
      refs: (ctx) => ({
        foods: [ctx.id('food.tasting')],
        foodCategories: [ctx.id('food.category')],
        usage: { totalFoods: 1 },
      }),
    })
  );

  entries.push(
    onboardingEntry(
      'onboarding.vendorA',
      'vendorA',
      'business.vendorA.product',
      'product',
      'MBH-SYNTH-VENDOR-A',
      `${NAME_PREFIX} Vendor A Goods`
    ),
    onboardingEntry(
      'onboarding.foodVendor',
      'foodVendor',
      'business.foodVendor',
      'food',
      'MBH-SYNTH-FOOD-VENDOR',
      `${NAME_PREFIX} Food Vendor Kitchen`
    )
  );

  for (const product of PRODUCTS) {
    entries.push(...productEntries(product));
  }

  entries.push({
    key: 'service.consult',
    model: 'Service',
    unique: () => ({ slug: 'mbh-synthetic-consultation' }),
    build: (ctx) => ({
      title: `${NAME_PREFIX} Consultation`,
      slug: 'mbh-synthetic-consultation',
      description: 'Synthetic bookable service for staging QA. Not a real offer.',
      price: 50,
      duration: '1 hour',
      services: [
        {
          name: 'Intro consultation',
          description: 'Synthetic 60 minute slot',
          durationMinutes: 60,
          price: 50,
        },
        {
          name: 'Follow-up',
          description: 'Synthetic 30 minute slot',
          durationMinutes: 30,
          price: 30,
        },
      ],
      categoryId: ctx.id('service.category'),
      subcategoryId: ctx.id('service.subcategory'),
      ownerId: ctx.id(ROLES.vendorA.userKey),
      businessId: ctx.id('business.vendorA.service'),
      isPublished: true,
      isActive: true,
      coverImage: `${ASSET_BASE}/consultation.png`,
      maxBookingsPerSlot: 1,
      rfqEnabled: false,
      businessHours: listingHours(),
      contact: { email: ctx.emails.vendorA, address: '100 Example Way, Norfolk, VA' },
    }),
  });

  entries.push({
    key: 'food.tasting',
    model: 'Food',
    unique: () => ({ slug: 'mbh-synthetic-tasting-menu' }),
    build: (ctx) => ({
      title: `${NAME_PREFIX} Tasting Menu`,
      slug: 'mbh-synthetic-tasting-menu',
      description: 'Synthetic food listing for staging QA. Not a real menu.',
      price: 20,
      coverImage: `${ASSET_BASE}/tasting-menu.png`,
      categoryId: ctx.id('food.category'),
      subcategoryId: ctx.id('food.subcategory'),
      businessName: `${NAME_PREFIX} Food Vendor Kitchen`,
      businessHours: listingHours(),
      tableTypes: [{ type: '2-Seater', count: 4 }, { type: '4-Seater', count: 2 }],
      bookingTimeSlots: ['12:00 PM', '1:00 PM', '6:00 PM', '7:00 PM'],
      ownerId: ctx.id(ROLES.foodVendor.userKey),
      businessId: ctx.id('business.foodVendor'),
      isPublished: true,
      isActive: true,
    }),
  });

  return entries;
}

module.exports = {
  FIXTURE_TAG,
  NAME_PREFIX,
  ROLES,
  ROLE_ORDER,
  PRODUCTS,
  buildFixtureSpec,
};
