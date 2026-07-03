const DEFAULT_S3_UPLOAD_CORS_ORIGINS = [
  'https://mosaicbizhub.com',
  'https://www.mosaicbizhub.com',
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://mosaic-biz-frontend-launch-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-*.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const S3_UPLOAD_CORS_ALLOWED_METHODS = ['GET', 'HEAD', 'PUT', 'POST'];
const S3_UPLOAD_CORS_ALLOWED_HEADERS = ['*'];
const S3_UPLOAD_CORS_EXPOSE_HEADERS = ['ETag', 'x-amz-request-id', 'x-amz-id-2'];
const S3_UPLOAD_CORS_MAX_AGE_SECONDS = 3000;
const S3_UPLOAD_CORS_RULE_ID = 'MosaicVendorPresignedUploads';

function parseOriginList(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map(normalizeCorsOrigin)
    .filter(Boolean);
}

function normalizeCorsOrigin(origin) {
  const trimmed = String(origin || '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return parsed.origin;
    }
  } catch (_error) {
    // Wildcard S3 origins are not valid URL hostnames; validate them separately.
  }

  return trimmed.replace(/\/+$/, '');
}

function isSafeBrowserOrigin(origin) {
  const normalizedOrigin = normalizeCorsOrigin(origin);

  if (normalizedOrigin === '*' || /\/\*$/.test(normalizedOrigin)) {
    return false;
  }

  const wildcardMatch = normalizedOrigin.match(/^https:\/\/([^/\s]*\*[^/\s]*)$/i);
  if (wildcardMatch) {
    const wildcardHost = wildcardMatch[1].toLowerCase();
    return wildcardHost !== '*' && wildcardHost.endsWith('.vercel.app');
  }

  try {
    const parsed = new URL(normalizedOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    if (parsed.origin !== normalizedOrigin || parsed.search || parsed.hash) {
      return false;
    }

    return parsed.hostname !== 'api.mosaicbizhub.com';
  } catch (_error) {
    return false;
  }
}

function dedupe(values) {
  return [...new Set(values)];
}

function getS3UploadCorsOrigins(env = process.env) {
  const configuredOrigins = parseOriginList(
    env.S3_UPLOAD_CORS_ORIGINS || env.CORS_ORIGINS
  );
  const frontendUrlOrigins = parseOriginList(env.FRONTEND_URL);

  return dedupe([
    ...configuredOrigins,
    ...frontendUrlOrigins,
    ...DEFAULT_S3_UPLOAD_CORS_ORIGINS,
  ]).filter(isSafeBrowserOrigin);
}

function buildS3UploadCorsConfiguration(env = process.env) {
  return {
    CORSRules: [
      {
        ID: S3_UPLOAD_CORS_RULE_ID,
        AllowedOrigins: getS3UploadCorsOrigins(env),
        AllowedMethods: S3_UPLOAD_CORS_ALLOWED_METHODS,
        AllowedHeaders: S3_UPLOAD_CORS_ALLOWED_HEADERS,
        ExposeHeaders: S3_UPLOAD_CORS_EXPOSE_HEADERS,
        MaxAgeSeconds: S3_UPLOAD_CORS_MAX_AGE_SECONDS,
      },
    ],
  };
}

module.exports = {
  DEFAULT_S3_UPLOAD_CORS_ORIGINS,
  S3_UPLOAD_CORS_ALLOWED_HEADERS,
  S3_UPLOAD_CORS_ALLOWED_METHODS,
  S3_UPLOAD_CORS_EXPOSE_HEADERS,
  S3_UPLOAD_CORS_MAX_AGE_SECONDS,
  S3_UPLOAD_CORS_RULE_ID,
  buildS3UploadCorsConfiguration,
  getS3UploadCorsOrigins,
  isSafeBrowserOrigin,
  parseOriginList,
};
