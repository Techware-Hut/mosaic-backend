const PRESIGNED_S3_UPLOAD_METHOD = 'PUT';
const PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS = 300;

const GENERIC_UPLOAD_MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
};

const GENERIC_UPLOAD_EXTENSION_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

const GENERIC_UPLOAD_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

const ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
];

const ALLOWED_IMAGE_S3_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

function buildPresignedS3UploadContract(contentType) {
  return {
    method: PRESIGNED_S3_UPLOAD_METHOD,
    uploadMethod: PRESIGNED_S3_UPLOAD_METHOD,
    requiredHeaders: {
      'Content-Type': contentType,
    },
    expiresIn: PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
  };
}

function sanitizeS3UploadFileName(fileName) {
  const cleanFileName = String(fileName || '')
    .trim()
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);

  return cleanFileName || 'upload';
}

function getFileExtension(fileName) {
  const normalized = String(fileName || '').trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  return lastDot >= 0 ? normalized.slice(lastDot) : '';
}

function normalizeGenericUploadMimeType(mimeType) {
  const normalized = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  return GENERIC_UPLOAD_MIME_ALIASES[normalized] || normalized;
}

function resolveGenericS3UploadMimeType(mimeType, fileName) {
  const normalized = normalizeGenericUploadMimeType(mimeType);

  if (ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES.includes(normalized)) {
    return normalized;
  }

  if (!GENERIC_UPLOAD_MIME_TYPES.has(normalized)) {
    return normalized;
  }

  return GENERIC_UPLOAD_EXTENSION_MIME_TYPES[getFileExtension(fileName)] || normalized;
}

function isAllowedGenericS3UploadMimeType(mimeType, fileName) {
  return ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES.includes(
    resolveGenericS3UploadMimeType(mimeType, fileName)
  );
}

function resolveImageS3UploadMimeType(mimeType, fileName) {
  return resolveGenericS3UploadMimeType(mimeType, fileName);
}

function isAllowedImageS3UploadMimeType(mimeType, fileName) {
  return ALLOWED_IMAGE_S3_UPLOAD_MIME_TYPES.includes(
    resolveImageS3UploadMimeType(mimeType, fileName)
  );
}

module.exports = {
  ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES,
  ALLOWED_IMAGE_S3_UPLOAD_MIME_TYPES,
  PRESIGNED_S3_UPLOAD_EXPIRES_IN_SECONDS,
  PRESIGNED_S3_UPLOAD_METHOD,
  buildPresignedS3UploadContract,
  isAllowedGenericS3UploadMimeType,
  isAllowedImageS3UploadMimeType,
  resolveImageS3UploadMimeType,
  resolveGenericS3UploadMimeType,
  sanitizeS3UploadFileName,
};
