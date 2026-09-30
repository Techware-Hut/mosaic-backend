function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function getGalleryImageLimit(subscriptionPlan) {
  const rawLimit =
    subscriptionPlan?.limits?.galleryImageLimit ??
    subscriptionPlan?.limits?.imageLimit;

  if (rawLimit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return toNonNegativeInteger(rawLimit) ?? 0;
}

function countGalleryImages(images) {
  return Array.isArray(images) ? images.filter(Boolean).length : 0;
}

function parseCurrentImageCount(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, count: 0, provided: false };
  }

  const count = toNonNegativeInteger(value);
  if (count === null) {
    const message = 'currentImageCount must be a non-negative integer.';
    return {
      ok: false,
      status: 400,
      code: 'INVALID_IMAGE_COUNT',
      error: message,
      message,
    };
  }

  return { ok: true, count, provided: true };
}

function formatListingType(listingType) {
  const normalized = String(listingType || 'listing').trim().toLowerCase();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Listing';
}

function evaluateGalleryImageCount({
  listingType,
  currentCount = 0,
  nextCount,
  limit,
  status = 400,
}) {
  const safeCurrent = toNonNegativeInteger(currentCount) ?? 0;
  const safeNext = toNonNegativeInteger(nextCount) ?? 0;
  const safeLimit =
    limit === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : toNonNegativeInteger(limit) ?? 0;
  const attemptedIncrease = Math.max(safeNext - safeCurrent, 0);

  // A downgrade never forces vendors to delete existing images. Unchanged or
  // reduced galleries remain editable even when they are above the new tier.
  if (
    safeLimit === Number.POSITIVE_INFINITY ||
    safeNext <= safeLimit ||
    safeNext <= safeCurrent
  ) {
    return {
      ok: true,
      limit: safeLimit,
      current: safeCurrent,
      next: safeNext,
      attemptedIncrease,
    };
  }

  const normalizedType = String(listingType || 'listing').trim().toLowerCase() || 'listing';
  const message = `${formatListingType(normalizedType)} gallery image limit reached. Your plan allows ${safeLimit} gallery images.`;

  return {
    ok: false,
    status,
    code: 'IMAGE_LIMIT_REACHED',
    listingType: normalizedType,
    limit: safeLimit,
    current: safeCurrent,
    next: safeNext,
    attemptedIncrease,
    remaining: Math.max(safeLimit - safeCurrent, 0),
    error: message,
    message,
  };
}

function evaluateGalleryImageChange({
  listingType,
  currentImages,
  nextImages,
  limit,
  status = 400,
}) {
  return evaluateGalleryImageCount({
    listingType,
    currentCount: countGalleryImages(currentImages),
    nextCount: countGalleryImages(nextImages),
    limit,
    status,
  });
}

function galleryLimitErrorBody(result) {
  return {
    success: false,
    code: result.code,
    error: result.error,
    message: result.message,
    listingType: result.listingType,
    limit: result.limit,
    current: result.current,
    next: result.next,
    attemptedIncrease: result.attemptedIncrease,
    remaining: result.remaining,
  };
}

module.exports = {
  countGalleryImages,
  evaluateGalleryImageChange,
  evaluateGalleryImageCount,
  galleryLimitErrorBody,
  getGalleryImageLimit,
  parseCurrentImageCount,
};
