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
      isApproved: false,
      isActive: true,
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
};
