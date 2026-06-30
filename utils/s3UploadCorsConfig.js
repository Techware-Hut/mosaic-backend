const DEFAULT_S3_UPLOAD_CORS_ORIGINS = [
  'https://mosaicbizhub.com',
  'https://www.mosaicbizhub.com',
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const S3_UPLOAD_CORS_ALLOWED_METHODS = ['PUT', 'GET', 'HEAD'];
const S3_UPLOAD_CORS_ALLOWED_HEADERS = ['Content-Type'];
const S3_UPLOAD_CORS_EXPOSE_HEADERS = ['ETag'];
const S3_UPLOAD_CORS_MAX_AGE_SECONDS = 3000;
const S3_UPLOAD_CORS_RULE_ID = 'MosaicVendorPresignedUploads';

function parseOriginList(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isSafeBrowserOrigin(origin) {
  if (origin === '*' || /\/\*$/.test(origin)) {
    return false;
  }

  if (/^https:\/\/\*\.[a-z0-9.-]+$/i.test(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
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
