const ALLOWED_VENDOR_ONBOARDING_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

function normalizeMimeType(mimeType) {
  if (typeof mimeType !== 'string') {
    return '';
  }

  return mimeType.split(';')[0].trim().toLowerCase();
}

function isAllowedVendorOnboardingMime(mimeType) {
  return ALLOWED_VENDOR_ONBOARDING_MIME_TYPES.includes(normalizeMimeType(mimeType));
}

module.exports = {
  ALLOWED_VENDOR_ONBOARDING_MIME_TYPES,
  normalizeMimeType,
  isAllowedVendorOnboardingMime,
};
