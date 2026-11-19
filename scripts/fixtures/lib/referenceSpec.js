'use strict';

/**
 * Synthetic reference data for an empty, isolated staging database.
 *
 * Reference data is what the app expects to exist before any vendor or buyer
 * signs up: subscription plans (vendor onboarding / listing limits), the
 * product, service and food category trees (listing forms, marketplace
 * filters) and minority types (business profile + marketplace filter).
 *
 * Everything here is synthetic. Plan prices and limits are placeholders for
 * staging QA, not the production price list. Stripe ids are obviously fake
 * placeholders (see STRIPE_PLACEHOLDER_PREFIX) and are only meant for
 * Stripe TEST mode: the app's ensurePlanPrice() helper treats an unknown
 * price/product id as stale (Stripe "resource_missing") and creates a fresh
 * test-mode product and price on first subscription checkout. On hosted
 * staging, ensurePlanPrice() refuses outright (no Stripe call) if the
 * configured Stripe key is a live key.
 *
 * Each entry has a stable `key` ("<kind>:<slug>"); the seeder upserts by that
 * key and never touches a document it did not create.
 */

const slugify = require('slugify');

const REFERENCE_TAG = 'mbh-synthetic-reference-v1';
const STRIPE_PLACEHOLDER_PREFIX = 'SYNTHETIC_TEST_ONLY_';
const SYNTHETIC_DESCRIPTION = 'Synthetic staging reference data.';

const toSlug = (name) => slugify(name, { lower: true, strict: true });

/**
 * The three tiers the code expects (models/SubscriptionPlan.js enum,
 * scripts/migrate-rename-plan-tiers.js, utils/vendorTierWelcomeEmail.js).
 * Listing and image limits follow the tier copy in vendorTierWelcomeEmail.js;
 * food limits mirror the service limits; prices are synthetic placeholders.
 */
const SUBSCRIPTION_PLANS = [
  {
    name: 'Launch Plan',
    price: 99,
    limits: { productListings: 5, serviceListings: 3, foodListings: 3, imageLimit: 3, videoLimit: 0 },
    features: { supportLevel: 'community', communityEventsAccess: true },
  },
  {
    name: 'Growth Plan',
    price: 249,
    limits: { productListings: 10, serviceListings: 5, foodListings: 5, imageLimit: 5, videoLimit: 1 },
    features: {
      supportLevel: 'email',
      analyticsDashboard: true,
      marketingTools: true,
      communityEventsAccess: true,
      searchPriority: true,
    },
  },
  {
    name: 'Legacy Plan',
    price: 499,
    limits: { productListings: 20, serviceListings: 10, foodListings: 10, imageLimit: 7, videoLimit: 5 },
    features: {
      supportLevel: 'priority',
      analyticsDashboard: true,
      marketingTools: true,
      featuredPlacement: true,
      communityEventsAccess: true,
      searchPriority: true,
      listingPriority: true,
      pushNotifications: true,
      aiRecommendation: true,
      topTierPlacement: true,
      topTierVisibility: true,
    },
  },
];

/** category name -> subcategory names */
const PRODUCT_CATEGORIES = {
  'Apparel & Accessories': ['Clothing', 'Jewelry'],
  'Beauty & Personal Care': ['Skincare', 'Hair Care'],
  'Home & Living': ['Home Decor', 'Candles & Fragrance'],
  'Art & Collectibles': ['Prints & Posters', 'Handmade Crafts'],
};

const SERVICE_CATEGORIES = {
  'Professional Services': ['Business Consulting', 'Bookkeeping'],
  'Health & Wellness': ['Personal Training', 'Massage Therapy'],
  'Home Services': ['Home Cleaning', 'Handyman Repairs'],
  'Creative Services': ['Photography', 'Graphic Design'],
};

const FOOD_CATEGORIES = {
  Restaurants: ['Soul Food', 'Caribbean Cuisine'],
  'Bakery & Desserts': ['Cakes & Cupcakes', 'Cookies & Pastries'],
  Catering: ['Event Catering', 'Meal Prep'],
  'Food Trucks': ['Street Food', 'Barbecue'],
};

/** Same names as seed/seedMinorityTypes.js, so filters match existing data. */
const MINORITY_TYPES = [
  'African Americans',
  'Alaska Natives',
  'Arab and other Middle Eastern Americans',
  'Asian Americans',
  'Latinos (including Puerto Ricans)',
  'Native Americans',
  'Native Hawai’ians',
  'Pacific Islanders',
];

/** Model name -> fields that must be unique against non-synthetic documents. */
const UNIQUE_FIELDS = {
  SubscriptionPlan: ['name', 'stripePriceId'],
  ProductCategory: ['name', 'slug'],
  ServiceCategory: ['name', 'slug'],
  FoodCategory: ['name', 'slug'],
  ProductSubcategory: ['slug'],
  ServiceSubcategory: ['slug'],
  FoodSubcategory: ['slug'],
  MinorityType: ['name'],
};

function planEntries() {
  return SUBSCRIPTION_PLANS.map((plan) => {
    const slug = toSlug(plan.name);
    const placeholder = `${STRIPE_PLACEHOLDER_PREFIX}${slug.replace(/-/g, '_')}`;
    return {
      key: `subscription-plan:${slug}`,
      model: 'SubscriptionPlan',
      data: {
        name: plan.name,
        price: plan.price,
        currency: 'usd',
        interval: 'year',
        intervalCount: 1,
        trialPeriodDays: 0,
        durationInDays: 365,
        stripeProductId: `prod_${placeholder}`,
        stripePriceId: `price_${placeholder}`,
        limits: { ...plan.limits },
        features: { ...plan.features },
      },
    };
  });
}

function categoryTree(modelBase, kind, tree) {
  const entries = [];
  for (const [categoryName, subNames] of Object.entries(tree)) {
    const categorySlug = toSlug(categoryName);
    const categoryKey = `${kind}-category:${categorySlug}`;
    entries.push({
      key: categoryKey,
      model: `${modelBase}Category`,
      data: { name: categoryName, slug: categorySlug, description: SYNTHETIC_DESCRIPTION },
    });
    for (const subName of subNames) {
      const subSlug = toSlug(subName);
      const data = { name: subName, slug: subSlug };
      // Only ProductSubcategory declares a description field.
      if (modelBase === 'Product') data.description = SYNTHETIC_DESCRIPTION;
      entries.push({
        key: `${kind}-subcategory:${subSlug}`,
        model: `${modelBase}Subcategory`,
        parentKey: categoryKey,
        parentField: 'category',
        data,
      });
    }
  }
  return entries;
}

function minorityTypeEntries() {
  return MINORITY_TYPES.map((name) => ({
    key: `minority-type:${toSlug(name)}`,
    model: 'MinorityType',
    data: { name, description: SYNTHETIC_DESCRIPTION, isActive: true },
  }));
}

/**
 * Ordered spec: parents always come before their children.
 * @returns {Array<{ key: string, model: string, data: object, parentKey?: string, parentField?: string }>}
 */
function buildReferenceSpec() {
  return [
    ...planEntries(),
    ...categoryTree('Product', 'product', PRODUCT_CATEGORIES),
    ...categoryTree('Service', 'service', SERVICE_CATEGORIES),
    ...categoryTree('Food', 'food', FOOD_CATEGORIES),
    ...minorityTypeEntries(),
  ];
}

module.exports = {
  REFERENCE_TAG,
  STRIPE_PLACEHOLDER_PREFIX,
  SUBSCRIPTION_PLANS,
  PRODUCT_CATEGORIES,
  SERVICE_CATEGORIES,
  FOOD_CATEGORIES,
  MINORITY_TYPES,
  UNIQUE_FIELDS,
  buildReferenceSpec,
  toSlug,
};
