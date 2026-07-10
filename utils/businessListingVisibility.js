const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Service = require('../models/Service');
const Food = require('../models/Food');
const VendorOnboardingStage1 = require('../models/VendorOnboardingStage1');
const {
  isPublicMarketplaceBusiness,
} = require('../lib/marketplace/businessEligibility');
const {
  filterPublishableListings,
  LISTING_PRICE_REQUIRED_CODE,
  LISTING_PRICE_REQUIRED_MESSAGE,
} = require('../lib/marketplace/listingPricePolicy');

const LISTING_TYPES = new Set(['product', 'service', 'food']);
// Approved 2026-07-07 (#218): Connect/payout setup required only for product vendors
// receiving online payouts. Service and food/restaurant directory flows do not require Connect.
const PAYOUT_REQUIRED_LISTING_TYPES = new Set(['product']);

function normalizeListingType(value) {
  return String(value || '').trim().toLowerCase();
}

function requiresPayoutSetupForBusiness(business) {
  return PAYOUT_REQUIRED_LISTING_TYPES.has(normalizeListingType(business?.listingType));
}

function isPayoutCompleteForBusiness(business) {
  if (!requiresPayoutSetupForBusiness(business)) return true;
  return Boolean(business?.chargesEnabled === true && business?.payoutsEnabled === true);
}

function normalizeId(value) {
  if (!value) return null;
  if (value._id) return String(value._id);
  return String(value);
}

function toPlain(value) {
  if (!value) return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function groupByBusinessId(items = []) {
  const grouped = new Map();
  for (const item of items) {
    const businessId = normalizeId(item.businessId);
    if (!businessId) continue;
    if (!grouped.has(businessId)) grouped.set(businessId, []);
    grouped.get(businessId).push(item);
  }
  return grouped;
}

function groupVariantsByProductId(variants = []) {
  const grouped = new Map();
  for (const variant of variants) {
    const productId = normalizeId(variant.productId);
    if (!productId) continue;
    if (!grouped.has(productId)) grouped.set(productId, []);
    grouped.get(productId).push(variant);
  }
  return grouped;
}

function countPublished(items = []) {
  return items.filter((item) => item.isPublished === true).length;
}

function countDraft(items = []) {
  return items.filter((item) => item.isPublished !== true).length;
}

function getServiceOfferings(service) {
  if (!Array.isArray(service?.services)) return [];
  return service.services.filter((item) => item && (item._id || item.name));
}

function countServiceOfferings(services = []) {
  return services.reduce((sum, service) => sum + getServiceOfferings(service).length, 0);
}

function countPublishedServiceOfferings(services = []) {
  return countServiceOfferings(services.filter((service) => service.isPublished === true));
}

function countDraftServiceOfferings(services = []) {
  return countServiceOfferings(services.filter((service) => service.isPublished !== true));
}

function summarizeCounts(snapshot) {
  const products = snapshot.products || [];
  const services = snapshot.services || [];
  const foods = snapshot.foods || [];
  const productVariants = products.flatMap((product) => product.variants || []);
  const serviceOfferings = countServiceOfferings(services);
  const publishedServiceOfferings = countPublishedServiceOfferings(services);
  const draftServiceOfferings = countDraftServiceOfferings(services);

  return {
    products: products.length,
    publishedProducts: countPublished(products),
    draftProducts: countDraft(products),
    productVariants: productVariants.length,
    publishedProductVariants: countPublished(productVariants),
    draftProductVariants: countDraft(productVariants),
    services: serviceOfferings,
    serviceListings: services.length,
    publishedServices: publishedServiceOfferings,
    draftServices: draftServiceOfferings,
    foods: foods.length,
    publishedFoods: countPublished(foods),
    draftFoods: countDraft(foods),
    total: products.length + serviceOfferings + foods.length,
    statusBreakdown: {
      products: {
        draft: countDraft(products),
        published: countPublished(products),
      },
      services: {
        draft: draftServiceOfferings,
        published: publishedServiceOfferings,
      },
      foods: {
        draft: countDraft(foods),
        published: countPublished(foods),
      },
    },
  };
}

function getEligibleListingsForBusiness(business, snapshot) {
  const listingType = String(business?.listingType || '').trim().toLowerCase();
  let candidateListings = [];

  if (listingType === 'product') {
    candidateListings = snapshot.products || [];
    return {
      type: listingType,
      listings: filterPublishableListings(listingType, candidateListings),
      allListings: candidateListings,
      variantIds: candidateListings
        .flatMap((product) => product.variants || [])
        .map((variant) => variant._id)
        .filter(Boolean),
    };
  }

  if (listingType === 'service') {
    candidateListings = (snapshot.services || []).filter((service) => (
      Array.isArray(service.services) && service.services.length > 0
    ));
    return {
      type: listingType,
      listings: filterPublishableListings(listingType, candidateListings),
      allListings: candidateListings,
    };
  }

  if (listingType === 'food') {
    candidateListings = snapshot.foods || [];
    return {
      type: listingType,
      listings: filterPublishableListings(listingType, candidateListings),
      allListings: candidateListings,
    };
  }

  return { type: listingType, listings: [], allListings: [] };
}

function countRequiredListings(eligible) {
  if (eligible?.type === 'service') {
    return countServiceOfferings(eligible.listings || []);
  }
  return eligible?.listings?.length || 0;
}

function resolveOnboardingForBusiness(business, onboardingRows = []) {
  const businessId = normalizeId(business?._id);
  const matchingBusiness = onboardingRows.find((row) =>
    normalizeId(row.businessId) === businessId
  );
  if (matchingBusiness) return matchingBusiness;

  const legacyWithoutBusinessId = onboardingRows.find((row) => !row.businessId);
  return legacyWithoutBusinessId || onboardingRows[0] || null;
}

async function loadOnboardingRowsByOwnerIds(ownerIds = []) {
  const ids = [...new Set(ownerIds.map(normalizeId).filter(Boolean))];
  const grouped = new Map(ids.map((id) => [id, []]));

  if (!ids.length) return grouped;

  const rows = await VendorOnboardingStage1.find({ userId: { $in: ids } })
    .select('userId businessId status applicationId updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  for (const row of rows) {
    const ownerId = normalizeId(row.userId);
    if (!ownerId) continue;
    if (!grouped.has(ownerId)) grouped.set(ownerId, []);
    grouped.get(ownerId).push(row);
  }

  return grouped;
}

async function loadListingSnapshotsByBusinessIds(businessIds = []) {
  const ids = [...new Set(businessIds.map(normalizeId).filter(Boolean))];
  const emptySnapshot = () => ({ products: [], services: [], foods: [], listingCounts: {} });
  const snapshots = new Map(ids.map((id) => [id, emptySnapshot()]));

  if (!ids.length) return snapshots;

  const [products, services, foods, variants] = await Promise.all([
    Product.find({ businessId: { $in: ids }, isDeleted: false })
      .select('_id title slug businessId ownerId coverImage price isPublished isDeleted createdAt updatedAt')
      .lean(),
    Service.find({ businessId: { $in: ids } })
      .select('_id title slug businessId ownerId coverImage price isPublished services createdAt updatedAt')
      .lean(),
    Food.find({ businessId: { $in: ids } })
      .select('_id title slug businessId ownerId coverImage price isPublished createdAt updatedAt')
      .lean(),
    ProductVariant.find({ businessId: { $in: ids }, isDeleted: false })
      .select('_id productId businessId ownerId sku stock price salePrice isPublished isDeleted createdAt updatedAt')
      .lean(),
  ]);

  const variantsByProductId = groupVariantsByProductId(variants);
  const productsWithVariants = products.map((product) => ({
    ...product,
    variants: variantsByProductId.get(String(product._id)) || [],
  }));

  const groupedProducts = groupByBusinessId(productsWithVariants);
  const groupedServices = groupByBusinessId(services);
  const groupedFoods = groupByBusinessId(foods);

  for (const id of ids) {
    const snapshot = {
      products: groupedProducts.get(id) || [],
      services: groupedServices.get(id) || [],
      foods: groupedFoods.get(id) || [],
    };
    snapshot.listingCounts = summarizeCounts(snapshot);
    snapshots.set(id, snapshot);
  }

  return snapshots;
}

function attachListingSnapshotToBusiness(business, snapshot, onboarding = null) {
  const plain = toPlain(business);
  const listingSnapshot = snapshot || { products: [], services: [], foods: [] };
  const eligible = getEligibleListingsForBusiness(plain, listingSnapshot);
  const requiredListingCount = countRequiredListings(eligible);
  const onboardingReadiness = buildOnboardingReadiness({
    business: plain,
    onboarding,
    snapshot: listingSnapshot,
  });

  return {
    ...plain,
    products: listingSnapshot.products || [],
    services: listingSnapshot.services || [],
    foods: listingSnapshot.foods || [],
    listingCounts: listingSnapshot.listingCounts || summarizeCounts(listingSnapshot),
    publication: {
      listingType: plain?.listingType || null,
      publicMarketplaceEligible: isPublicMarketplaceBusiness(plain),
      hasRequiredListing: eligible.listings.length > 0,
      requiredListingCount,
    },
    onboardingReadiness,
  };
}

async function enrichBusinessesWithListingSnapshots(businesses = []) {
  const plainBusinesses = businesses.map(toPlain);
  const [snapshots, onboardingRowsByOwner] = await Promise.all([
    loadListingSnapshotsByBusinessIds(
      plainBusinesses.map((business) => business?._id)
    ),
    loadOnboardingRowsByOwnerIds(
      plainBusinesses.map((business) => business?.owner)
    ),
  ]);

  return plainBusinesses.map((business) => {
    const onboarding = resolveOnboardingForBusiness(
      business,
      onboardingRowsByOwner.get(normalizeId(business?.owner)) || []
    );

    return attachListingSnapshotToBusiness(
      business,
      snapshots.get(normalizeId(business?._id)),
      onboarding
    );
  });
}

function buildPublicationBlockers({ business, onboarding, snapshot }) {
  const blockers = [];
  const listingType = normalizeListingType(business?.listingType);
  const eligible = getEligibleListingsForBusiness(business, snapshot);

  if (!onboarding || onboarding.status !== 'verified') {
    blockers.push({
      code: 'VENDOR_VERIFICATION_REQUIRED',
      message: 'Vendor application must be approved before publishing.',
    });
  }

  if (business?.isApproved !== true) {
    blockers.push({
      code: 'BUSINESS_APPROVAL_REQUIRED',
      message: 'Business must be approved before publishing.',
    });
  }

  // isActive is no longer a prerequisite blocker — it is SET by publishBusinessListings
  // upon successful completion of Stage 6. Checking it here would create a chicken-and-egg
  // deadlock where a vendor can never launch because they aren't active yet.

  if (requiresPayoutSetupForBusiness(business) && !isPayoutCompleteForBusiness(business)) {
    blockers.push({
      code: 'PAYOUT_SETUP_REQUIRED',
      message: 'Complete payout setup before publishing.',
    });
  }

  if (!LISTING_TYPES.has(listingType)) {
    blockers.push({
      code: 'LISTING_TYPE_REQUIRED',
      message: 'Choose a valid business listing type before publishing.',
    });
  } else if (eligible.allListings?.length > 0 && eligible.listings.length === 0) {
    blockers.push({
      code: LISTING_PRICE_REQUIRED_CODE,
      message: LISTING_PRICE_REQUIRED_MESSAGE,
    });
  } else if (eligible.listings.length === 0) {
    blockers.push({
      code: 'LISTING_REQUIRED',
      message: `Add at least one ${listingType} listing before publishing.`,
    });
  }

  return blockers;
}

function buildOnboardingReadiness({ business, onboarding, snapshot }) {
  const eligible = getEligibleListingsForBusiness(business, snapshot);
  const hasListing = eligible.listings.length > 0;
  const requiredListingCount = countRequiredListings(eligible);
  const payoutRequired = requiresPayoutSetupForBusiness(business);
  const payoutComplete = isPayoutCompleteForBusiness(business);
  const blockers = buildPublicationBlockers({ business, onboarding, snapshot });

  return {
    listingType: business?.listingType || null,
    hasListing,
    requiredListingCount,
    payoutRequired,
    payoutComplete,
    vendorVerificationStatus: onboarding?.status || null,
    canFinalReview: hasListing && payoutComplete,
    canPublish: blockers.length === 0,
    blockers,
  };
}

async function publishBusinessListings({ business, userId }) {
  const businessId = normalizeId(business?._id);
  const snapshots = await loadListingSnapshotsByBusinessIds([businessId]);
  const snapshot = snapshots.get(businessId) || { products: [], services: [], foods: [] };
  const onboarding = await VendorOnboardingStage1.findOne({
    userId,
    status: 'verified',
    $or: [
      { businessId: business._id },
      { businessId: { $exists: false } },
      { businessId: null },
    ],
  }).select('status applicationId businessId').sort({ updatedAt: -1 }).lean();
  const blockers = buildPublicationBlockers({ business, onboarding, snapshot });
  const eligibleBeforePublication = getEligibleListingsForBusiness(business, snapshot);
  const requiredListingCount = countRequiredListings(eligibleBeforePublication);

  if (blockers.length) {
    return {
      ok: false,
      status: 409,
      blockers,
      onboarding,
      snapshot,
      publication: {
        listingType: business.listingType,
        publicMarketplaceEligible: isPublicMarketplaceBusiness(business),
        hasRequiredListing: eligibleBeforePublication.listings.length > 0,
        requiredListingCount,
        payoutRequired: requiresPayoutSetupForBusiness(business),
        payoutComplete: isPayoutCompleteForBusiness(business),
        blockers,
      },
    };
  }

  // Stage 6 is the single launch moment. Flip the business live now that all
  // blockers have passed. This is the ONLY place isActive is set to true for
  // a vendor going through the normal onboarding funnel.
  if (!business.isActive) {
    business.isActive = true;
    await business.save();
  }

  const eligible = eligibleBeforePublication;
  const listingIds = eligible.listings.map((item) => item._id).filter(Boolean);
  const published = {
    products: 0,
    productVariants: 0,
    services: 0,
    serviceListings: 0,
    foods: 0,
  };

  if (eligible.type === 'product') {
    const productResult = await Product.updateMany(
      { _id: { $in: listingIds }, businessId: business._id, ownerId: userId, isDeleted: false },
      { $set: { isPublished: true } }
    );
    const variantResult = await ProductVariant.updateMany(
      {
        businessId: business._id,
        ownerId: userId,
        productId: { $in: listingIds },
        isDeleted: false,
      },
      { $set: { isPublished: true } }
    );

    published.products = productResult.modifiedCount ?? productResult.nModified ?? 0;
    published.productVariants = variantResult.modifiedCount ?? variantResult.nModified ?? 0;
  }

  if (eligible.type === 'service') {
    const serviceResult = await Service.updateMany(
      { _id: { $in: listingIds }, businessId: business._id, ownerId: userId },
      { $set: { isPublished: true } }
    );
    published.services = countRequiredListings(eligible);
    published.serviceListings = serviceResult.modifiedCount ?? serviceResult.nModified ?? 0;
  }

  if (eligible.type === 'food') {
    const foodResult = await Food.updateMany(
      { _id: { $in: listingIds }, businessId: business._id, ownerId: userId },
      { $set: { isPublished: true } }
    );
    published.foods = foodResult.modifiedCount ?? foodResult.nModified ?? 0;
  }

  const refreshedSnapshots = await loadListingSnapshotsByBusinessIds([business._id]);
  const refreshedSnapshot = refreshedSnapshots.get(businessId) || snapshot;

  return {
    ok: true,
    status: 200,
    published,
    onboarding,
    snapshot: refreshedSnapshot,
    publication: {
      listingType: business.listingType,
      publicMarketplaceEligible: isPublicMarketplaceBusiness(business),
      hasRequiredListing: true,
      requiredListingCount: countRequiredListings(eligible),
      payoutRequired: requiresPayoutSetupForBusiness(business),
      payoutComplete: isPayoutCompleteForBusiness(business),
      published,
      blockers: [],
    },
  };
}

module.exports = {
  attachListingSnapshotToBusiness,
  buildPublicationBlockers,
  enrichBusinessesWithListingSnapshots,
  getEligibleListingsForBusiness,
  loadListingSnapshotsByBusinessIds,
  publishBusinessListings,
  requiresPayoutSetupForBusiness,
};
