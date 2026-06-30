const ALLOWED_VENDOR_ONBOARDING_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const VENDOR_ONBOARDING_MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'application/x-pdf': 'application/pdf',
};

const VENDOR_ONBOARDING_EXTENSION_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const GENERIC_UPLOAD_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

const MAX_VENDOR_ONBOARDING_UPLOAD_BYTES = 5 * 1024 * 1024;

function normalizeMimeType(mimeType) {
  if (typeof mimeType !== 'string') {
    return '';
  }

  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  return VENDOR_ONBOARDING_MIME_ALIASES[normalized] || normalized;
}

function getFileExtension(fileName) {
  if (typeof fileName !== 'string') {
    return '';
  }

  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot < 0) {
    return '';
  }

  return normalized.slice(lastDot);
}

function resolveVendorOnboardingMimeType(mimeType, fileName) {
  const normalized = normalizeMimeType(mimeType);
  if (ALLOWED_VENDOR_ONBOARDING_MIME_TYPES.includes(normalized)) {
    return normalized;
  }

  if (!GENERIC_UPLOAD_MIME_TYPES.has(normalized)) {
    return normalized;
  }

  return VENDOR_ONBOARDING_EXTENSION_MIME_TYPES[getFileExtension(fileName)] || normalized;
}

function isAllowedVendorOnboardingMime(mimeType, fileName) {
  return ALLOWED_VENDOR_ONBOARDING_MIME_TYPES.includes(
    resolveVendorOnboardingMimeType(mimeType, fileName)
  );
}

function parseUploadSizeBytes(fileSize) {
  if (fileSize === undefined || fileSize === null || fileSize === '') {
    return null;
  }

  const parsed = Number(fileSize);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Number.NaN;
  }

  return parsed;
}

module.exports = {
  ALLOWED_VENDOR_ONBOARDING_MIME_TYPES,
  MAX_VENDOR_ONBOARDING_UPLOAD_BYTES,
  VENDOR_ONBOARDING_EXTENSION_MIME_TYPES,
  getFileExtension,
  isAllowedVendorOnboardingMime,
  normalizeMimeType,
  parseUploadSizeBytes,
  resolveVendorOnboardingMimeType,
};
