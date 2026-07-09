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
    subscriptionId: subscription?._id || null,
    subscriptionPlanId: subscription?.subscriptionPlanId || null,
    subscriptionStatus: subscription?.status || 'inactive',
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

    if (business.location) {
      business.location = undefined;
    }
  }

  await business.save();

  if (
    !onboarding.businessId ||
    onboarding.businessId.toString() !== business._id.toString()
  ) {
    onboarding.businessId = business._id;
    await onboarding.save();
  }

  return business;
}

module.exports = {
  syncBusinessFromOnboarding,
  needsProfileBackfillFromOnboarding,
  buildAddressFromOnboarding,
  buildSocialLinksFromOnboarding,
  normalizeMinorityCategories,
};
