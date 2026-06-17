/**
 * Public marketplace listing DTOs — null-safe card/detail shapes for frontend.
 * Additive: preserves legacy keys (_id, coverImage, categoryId, business, etc.).
 */

const SHORT_DESCRIPTION_MAX = 160;

const LISTING_DETAIL_PATHS = {
  product: (item) => (item.slug ? `/products/${item.slug}` : item.id ? `/products/${item.id}` : null),
  service: (item) => (item.slug ? `/services/${item.slug}` : item.id ? `/services/${item.id}` : null),
  food: (item) => (item.slug ? `/food/${item.slug}` : item.id ? `/food/${item.id}` : null),
};

function normalizeId(value) {
  if (value == null) return null;
  if (typeof value === 'object' && value._id != null) return String(value._id);
  if (typeof value === 'object' && value.id != null) return String(value.id);
  return String(value);
}

function normalizePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value.$numberDecimal != null) {
    const parsed = parseFloat(value.$numberDecimal);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePriceLabel(price) {
  if (price == null) return 'Contact for price';
  return `$${price.toFixed(2)}`;
}

function truncateDescription(text, max = SHORT_DESCRIPTION_MAX) {
  if (text == null || text === '') return null;
  const str = String(text);
  if (str.length <= max) return str;
  return `${str.slice(0, max).trim()}…`;
}

function normalizeImages({ coverImage, images, logo } = {}) {
  const collected = [];
  if (coverImage) collected.push(String(coverImage));
  if (Array.isArray(images)) {
    for (const img of images) {
      if (img && !collected.includes(String(img))) collected.push(String(img));
    }
  }
  if (logo && !collected.includes(String(logo))) collected.push(String(logo));

  const primary = collected[0] || null;
  return {
    image: primary,
    imageUrl: primary,
    images: collected,
  };
}

function normalizeTaxonomyRef(ref) {
  if (ref == null) return null;
  if (typeof ref === 'string' || typeof ref === 'number') {
    return { id: String(ref), name: null, slug: null };
  }
  const id = normalizeId(ref);
  return {
    id,
    name: ref.name ?? null,
    slug: ref.slug ?? null,
  };
}

function extractBusinessSource(raw) {
  if (raw.business && typeof raw.business === 'object') return raw.business;
  if (raw.businessDetails && typeof raw.businessDetails === 'object') {
    return {
      _id: raw.businessId,
      businessName: raw.businessDetails.businessName,
      logo: raw.businessDetails.logo,
      email: raw.businessDetails.email,
      phone: raw.businessDetails.phone,
      address: raw.businessDetails.address,
      badge: raw.businessDetails.badge,
      tags: raw.businessDetails.tags,
      socialLinks: raw.businessDetails.socialLinks,
    };
  }
  if (raw.businessId && typeof raw.businessId === 'object') return raw.businessId;
  return null;
}

function normalizeVendor(raw, businessSource) {
  const biz = businessSource || extractBusinessSource(raw);
  const vendorId =
    normalizeId(biz?._id ?? biz?.businessId ?? raw.businessId ?? raw.vendorId) || null;
  const vendorName =
    biz?.businessName ??
    raw.businessDetails?.businessName ??
    raw.vendorName ??
    raw.businessName ??
    null;

  const contactEmail =
    biz?.email ??
    raw.businessDetails?.email ??
    raw.businessDetails?.businessEmail ??
    null;
  const contactPhone =
    biz?.phone ??
    raw.businessDetails?.phone ??
    raw.businessDetails?.businessPhone ??
    null;

  const contact =
    contactEmail || contactPhone
      ? { email: contactEmail ?? null, phone: contactPhone ?? null }
      : null;

  const badge = raw.badge ?? biz?.badge ?? raw.businessDetails?.badge ?? null;

  const business =
    biz || vendorId || vendorName
      ? {
          businessId: vendorId,
          businessName: vendorName,
          logo: biz?.logo ?? null,
          badge: badge ?? null,
          email: contactEmail ?? null,
          phone: contactPhone ?? null,
          address: biz?.address ?? null,
          slug: biz?.slug ?? null,
        }
      : null;

  return { vendorId, vendorName, businessId: vendorId, business, badge, contact };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => t != null && String(t).trim()).map(String);
}

function normalizeRating({ averageRating, totalReviews } = {}) {
  const rating =
    averageRating != null && Number.isFinite(Number(averageRating))
      ? Number(averageRating)
      : null;
  const reviews =
    totalReviews != null && Number.isFinite(Number(totalReviews))
      ? Number(totalReviews)
      : 0;
  return { averageRating: rating, totalReviews: reviews };
}

function normalizeListingStatus(raw) {
  if (raw.isPublished === false) return 'unavailable';
  if (raw.stockQuantity != null && Number(raw.stockQuantity) <= 0) return 'unavailable';
  if (raw.isPublished === true || raw.isPublished == null) return 'available';
  return null;
}

function normalizeLocation(raw, businessSource) {
  const location =
    raw.location ??
    raw.contact?.address ??
    businessSource?.address ??
    raw.businessDetails?.address ??
    null;

  if (location == null) {
    return { location: null, city: null, state: null };
  }

  if (typeof location === 'string') {
    return { location, city: null, state: null };
  }

  const city = location.city ?? null;
  const state = location.state ?? null;
  return { location, city, state };
}

function resolveVerified(raw, options = {}) {
  if (options.verified != null) return options.verified;
  if (raw.vendorDetails?.status === 'verified') return true;
  if (raw.vendorDetails?.status && raw.vendorDetails.status !== 'verified') return false;
  return null;
}

function buildDetailPath(listingType, item) {
  const builder = LISTING_DETAIL_PATHS[listingType];
  if (!builder) return null;
  return builder(item);
}

function omitUndefined(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function toPublicListingCard(raw, options = {}) {
  const listingType = options.listingType || 'product';
  const doc = raw && typeof raw.toObject === 'function' ? raw.toObject() : { ...raw };
  const id = normalizeId(doc._id ?? doc.id);
  const businessSource = extractBusinessSource(doc);
  const vendor = normalizeVendor(doc, businessSource);
  const images = normalizeImages({
    coverImage: doc.coverImage,
    images: doc.images,
    logo: businessSource?.logo,
  });
  const price = normalizePrice(doc.price);
  const category = normalizeTaxonomyRef(doc.category ?? doc.categoryId);
  const subcategory = normalizeTaxonomyRef(doc.subcategory ?? doc.subcategoryId);
  const { averageRating, totalReviews } = normalizeRating(doc);
  const status = normalizeListingStatus(doc);
  const tags = normalizeTags(doc.tags ?? businessSource?.tags);
  const verified = resolveVerified(doc, options);
  const { location, city, state } = normalizeLocation(doc, businessSource);
  const priceLabel = normalizePriceLabel(price);
  const vendorLogo = businessSource?.logo ?? vendor.business?.logo ?? null;

  const cardBase = {
    ...doc,
    id,
    listingType,
    title: doc.title ?? null,
    name: doc.title ?? doc.businessName ?? null,
    description: doc.description ?? null,
    shortDescription: truncateDescription(doc.description ?? doc.shortDescription),
    slug: doc.slug ?? null,
    ...images,
    price,
    priceLabel,
    displayPrice: priceLabel,
    vendorId: vendor.vendorId,
    vendorName: vendor.vendorName,
    vendorLogo,
    businessId: vendor.businessId,
    business: vendor.business ?? doc.business ?? null,
    category,
    subcategory,
    location,
    city,
    state,
    tags,
    status,
    availability: status,
    averageRating,
    totalReviews,
    badge: vendor.badge,
    verified,
    contact: vendor.contact,
    detailPath: null,
  };

  cardBase.detailPath = buildDetailPath(listingType, cardBase);

  if (doc.businessDetails) {
    cardBase.businessDetails = doc.businessDetails;
  }

  return omitUndefined(cardBase);
}

function toPublicListingDetail(raw, options = {}) {
  const card = toPublicListingCard(raw, options);
  const extras = options.extras && typeof options.extras === 'object' ? options.extras : {};
  return omitUndefined({
    ...card,
    ...extras,
  });
}

function toPublicBusinessCard(raw) {
  const doc = raw && typeof raw.toObject === 'function' ? raw.toObject() : { ...raw };
  const id = normalizeId(doc._id ?? doc.id);
  const images = normalizeImages({
    coverImage: doc.coverImage,
    logo: doc.logo,
    images: doc.images,
  });
  const slug = doc.slug ?? null;
  const { location, city, state } = normalizeLocation(doc, doc);

  const card = {
    ...doc,
    id,
    listingType: doc.listingType ?? 'business',
    title: doc.businessName ?? null,
    name: doc.businessName ?? null,
    businessName: doc.businessName ?? null,
    description: doc.description ?? null,
    shortDescription: truncateDescription(doc.description),
    slug,
    ...images,
    price: null,
    priceLabel: null,
    displayPrice: null,
    vendorId: id,
    vendorName: doc.businessName ?? null,
    vendorLogo: doc.logo ?? null,
    businessId: id,
    location,
    city,
    state,
    tags: normalizeTags(doc.tags),
    status: doc.isActive === false ? 'unavailable' : 'available',
    availability: doc.isActive === false ? 'unavailable' : 'available',
    averageRating: null,
    totalReviews: 0,
    badge: doc.badge ?? null,
    verified: doc.onboardingStatus === 'verified' ? true : null,
    contact:
      doc.email || doc.phone
        ? { email: doc.email ?? null, phone: doc.phone ?? null }
        : null,
    detailPath: slug ? `/business/${slug}` : id ? `/business/${id}` : null,
  };

  return omitUndefined(card);
}

module.exports = {
  normalizeId,
  normalizePrice,
  normalizePriceLabel,
  normalizeImages,
  normalizeTaxonomyRef,
  normalizeVendor,
  normalizeTags,
  normalizeRating,
  normalizeListingStatus,
  normalizeLocation,
  toPublicListingCard,
  toPublicListingDetail,
  toPublicBusinessCard,
  truncateDescription,
};
