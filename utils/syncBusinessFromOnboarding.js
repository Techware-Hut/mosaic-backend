const VENDOR_SUBSCRIPTION_REQUIRED = 'VENDOR_SUBSCRIPTION_REQUIRED';
const VENDOR_SUBSCRIPTION_INVALID = 'VENDOR_SUBSCRIPTION_INVALID';

const VENDOR_SUBSCRIPTION_REQUIRED_MESSAGE =
  'An active vendor subscription is required before your business profile can be completed.';
const VENDOR_SUBSCRIPTION_INVALID_MESSAGE =
  'Your vendor subscription record is incomplete. Please contact support so we can finish linking your subscription.';

/**
 * Typed conflict error for the Business sync subscription gate.
 * Carries only safe, client-displayable fields (no payload echoes).
 */
function createVendorSubscriptionError(code, message, nextAction) {
  const error = new Error(message);
  error.name = 'VendorSubscriptionSyncError';
  error.code = code;
  error.statusCode = 409;
  error.nextAction = nextAction;
  return error;
}

function isVendorSubscriptionError(error) {
  return (
    Boolean(error) &&
    (error.code === VENDOR_SUBSCRIPTION_REQUIRED ||
      error.code === VENDOR_SUBSCRIPTION_INVALID)
  );
}

/**
 * A Business location is safe to persist only when it is a complete GeoJSON
 * Point: type 'Point' with exactly two finite numeric coordinates.
 * Anything else — including the schema's historical materialized
 * { address: '' } — is rejected by the 2dsphere index with Mongo error
 * 16755 on save (production incident #251).
 */
function hasValidGeoPoint(location) {
  return (
    Boolean(location) &&
    location.type === 'Point' &&
    Array.isArray(location.coordinates) &&
    location.coordinates.length === 2 &&
    location.coordinates.every((value) => Number.isFinite(value))
  );
}

function hasAnyAddressValue(address) {
  if (!address) return false;
  return ['street', 'city', 'state', 'country', 'zipCode'].some(
    (key) => String(address[key] || '').trim()
  );
}

function normalizeMinorityCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function buildAddressFromOnboarding(onboarding) {
  const src = onboarding?.address || {};
  return {
    street: String(src.street || '').trim(),
    city: String(src.city || '').trim(),
    state: String(src.state || '').trim(),
    country: String(src.country || '').trim(),
    zipCode: String(src.zipCode || '').trim(),
  };
}

function buildSocialLinksFromOnboarding(onboarding) {
  return {
    website: onboarding?.website || '',
    facebook: onboarding?.facebook || '',
    instagram: onboarding?.instagram || '',
    twitter: onboarding?.twitter || '',
    linkedin: onboarding?.linkedin || '',
    tiktok: onboarding?.tiktok || '',
  };
}

/**
 * Returns true when onboarding has profile data that never made it onto Business
 * (e.g. vendors who completed onboarding before profile sync included all fields).
 */
function needsProfileBackfillFromOnboarding(business, onboarding) {
  if (!business || !onboarding) return false;

  const needsAddress =
    hasAnyAddressValue(onboarding.address) &&
    !hasAnyAddressValue(business.address);

  const onboardingLogo = onboarding.businessProfileImage?.url;
  const needsLogo =
    Boolean(String(onboardingLogo || '').trim()) &&
    !String(business.logo || '').trim();

  const onboardingCover = onboarding.featureBanner?.url;
  const needsCover =
    Boolean(String(onboardingCover || '').trim()) &&
    !String(business.coverImage || '').trim();

  const needsLanguage =
    Boolean(String(onboarding.language || '').trim()) &&
    !String(business.language || '').trim();

  const onboardingMinority = normalizeMinorityCategories(
    onboarding.minorityCategories
  );
  const businessMinority = normalizeMinorityCategories(
    business.minorityCategories
  );
  const needsMinority =
    onboardingMinority.length > 0 && businessMinority.length === 0;

  return (
    needsAddress ||
    needsLogo ||
    needsCover ||
    needsLanguage ||
    needsMinority
  );
}

async function syncBusinessFromOnboarding({
  userId,
  onboarding,
  Business,
  Subscription,
}) {
  const subscription = await Subscription.findOne({
    userId,
    status: 'active',
  }).sort({ createdAt: -1 });

  // The Business schema hard-requires a real subscription linkage:
  //   - subscriptionId / subscriptionPlanId are required refs
  //   - subscriptionStatus enum is active|expired|cancelled|pending
  // Writing null refs or a synthetic 'inactive' status throws a Mongoose
  // ValidationError, which surfaced in production as a generic HTTP 500
  // ("Failed to sync business profile data") and blocked vendors at Stage 3.
  // Fail fast with an actionable, typed conflict BEFORE touching Business,
  // so no partial Business is ever created.
  if (!subscription) {
    throw createVendorSubscriptionError(
      VENDOR_SUBSCRIPTION_REQUIRED,
      VENDOR_SUBSCRIPTION_REQUIRED_MESSAGE,
      'complete_subscription'
    );
  }

  if (!subscription.subscriptionPlanId) {
    throw createVendorSubscriptionError(
      VENDOR_SUBSCRIPTION_INVALID,
      VENDOR_SUBSCRIPTION_INVALID_MESSAGE,
      'contact_support'
    );
  }

  let business = await Business.findOne({ owner: userId });

  const businessData = {
    businessName: onboarding.businessName,
    description: onboarding.businessBio,
    logo: onboarding.businessProfileImage?.url,
    coverImage: onboarding.featureBanner?.url,
    email: onboarding.businessEmail || onboarding.secondaryBusinessEmail,
    phone: onboarding.businessPhone || onboarding.primaryPhone,
    address: buildAddressFromOnboarding(onboarding),
    socialLinks: buildSocialLinksFromOnboarding(onboarding),
    language: String(onboarding.language || '').trim(),
    minorityCategories: normalizeMinorityCategories(onboarding.minorityCategories),
    listingType: onboarding.businessType || 'product',
    points: onboarding.totalVerificationPoints || 0,
    badge: onboarding.badge || null,
    subscriptionId: subscription._id,
    subscriptionPlanId: subscription.subscriptionPlanId,
    subscriptionStatus: subscription.status,
  };

  if (!business) {
    business = new Business({
      owner: userId,
      ...businessData,
      // Public marketplace approval mirrors the Stage-1 application decision;
      // never grant visibility before admin verification.
      isApproved: onboarding.status === 'verified',
      // isActive stays false until Stage 6 (publish-storefront) completes.
      // That is the single point where a business goes live on the marketplace.
      isActive: false,
      usage: {
        totalProducts: 0,
        totalServices: 0,
        totalFoods: 0,
        totalImages: 0,
      },
      products: [],
      services: [],
      foods: [],
    });
  } else {
    business.businessName = businessData.businessName;
    business.description = businessData.description;
    business.logo = businessData.logo;
    business.coverImage = businessData.coverImage;
    business.email = businessData.email;
    business.phone = businessData.phone;
    business.address = businessData.address;
    business.socialLinks = {
      ...(business.socialLinks || {}),
      ...businessData.socialLinks,
    };
    business.language = businessData.language;
    business.minorityCategories = businessData.minorityCategories;
    business.listingType = businessData.listingType;
    business.points = businessData.points;
    business.badge = businessData.badge;
    business.subscriptionId = businessData.subscriptionId;
    business.subscriptionPlanId = businessData.subscriptionPlanId;
    business.subscriptionStatus = businessData.subscriptionStatus;
  }

  // The businesses collection's 2dsphere index rejects any location that is
  // not a complete GeoJSON Point (Mongo error 16755, production #251).
  // Preserve a valid Point; explicitly unset anything else — including the
  // schema's historical { address: '' } materialization — before saving, for
  // both newly constructed and existing Business records. Never fabricate
  // coordinates here.
  if (!hasValidGeoPoint(business.location)) {
    business.location = undefined;
  }

  await business.save();

  if (
    !onboarding.businessId ||
    onboarding.businessId.toString() !== business._id.toString()
  ) {
    onboarding.businessId = business._id;
    await onboarding.save();
  }

  // Keep the reverse linkage in sync so subscription → business lookups work.
  // Single-field $set (via updateOne) avoids revalidating unrelated legacy
  // subscription fields that full-document save() would trip over.
  if (
    !subscription.businessId ||
    subscription.businessId.toString() !== business._id.toString()
  ) {
    await Subscription.updateOne(
      { _id: subscription._id },
      { $set: { businessId: business._id } }
    );
    subscription.businessId = business._id;
  }

  return business;
}

module.exports = {
  syncBusinessFromOnboarding,
  needsProfileBackfillFromOnboarding,
  buildAddressFromOnboarding,
  buildSocialLinksFromOnboarding,
  normalizeMinorityCategories,
  isVendorSubscriptionError,
  hasValidGeoPoint,
  VENDOR_SUBSCRIPTION_REQUIRED,
  VENDOR_SUBSCRIPTION_INVALID,
  VENDOR_SUBSCRIPTION_REQUIRED_MESSAGE,
  VENDOR_SUBSCRIPTION_INVALID_MESSAGE,
};
