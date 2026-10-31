const { isStagingEnv } = require('./frontendUrl');

const DEFAULT_CREDENTIAL_ORIGINS = [
  'https://mosaicbizhub.com',
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://mosaic-biz-frontend-launch-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
];

const DISALLOWED_CREDENTIAL_ORIGINS = new Set([
  'https://www.mosaicbizhub.com',
  'https://api.mosaicbizhub.com',
]);

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8081',
  'https://app.minorityownedbusiness.info',
  'http://192.168.1.50:3000',
  'exp://192.168.0.104:8081',
  'exp://192.168.0.104:3000',
  'exp://192.168.0.104:3001',
];

const CREDENTIAL_ORIGIN_PATTERNS = [
  /^https:\/\/mosaic-biz-frontend-launch-[a-z0-9-]+\.vercel\.app$/i,
];

const STAGING_CREDENTIAL_ORIGINS = [
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
];

function hasConflictingStagingMarkers() {
  const release = (process.env.RELEASE_ENVIRONMENT || '').trim().toLowerCase();
  const sentry = (process.env.SENTRY_ENVIRONMENT || '').trim().toLowerCase();
  return Boolean(release && sentry && release !== sentry);
}

function parseStagingOrigin(value) {
  // Accept origin tuples only; URL must not repair credentials, paths or schemes.
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const text = value.trim();
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(text)) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  const origin = parsed.origin;
  if (STAGING_CREDENTIAL_ORIGINS.includes(origin)) return origin;
  if (origin === 'https://mosaic-biz-frontend-launch-digital-builders.vercel.app' ||
      /^https:\/\/mosaic-biz-frontend-launch-git-main(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin)) return null;
  if (parsed.hostname.length > 253 || parsed.hostname.split('.').some(label => label.length > 63)) return null;
  // Shape is not trust: additional Previews also require exact configuration
  // below and deployment provenance verified by the operator before deployment.
  return CREDENTIAL_ORIGIN_PATTERNS.some(pattern => pattern.test(origin)) ? origin : null;
}

function getStagingOrigins() {
  if (hasConflictingStagingMarkers()) return [];
  if (process.env.CORS_ORIGINS === undefined) return [...STAGING_CREDENTIAL_ORIGINS];
  // An explicit blank or partially invalid selection fails closed as a whole.
  // Do not widen it with FRONTEND_URL, development or production defaults.
  const origins = process.env.CORS_ORIGINS.split(',').map(parseStagingOrigin);
  return origins.some(origin => origin === null) ? [] : [...new Set(origins)];
}

function parseCorsOrigins(value) {
  return value
    .split(',')
    .map((o) => o.trim())
    .filter((origin) => origin && origin !== '*' && !DISALLOWED_CREDENTIAL_ORIGINS.has(origin));
}

function getAllowedOrigins() {
  // STG-004's server markers select containment even with NODE_ENV=production.
  // Missing markers retain the established non-staging production/local path.
  if (isStagingEnv()) return getStagingOrigins();
  const isProd = process.env.NODE_ENV === 'production';
  let origins;

  if (process.env.CORS_ORIGINS) {
    origins = [
      ...parseCorsOrigins(process.env.CORS_ORIGINS),
      ...DEFAULT_CREDENTIAL_ORIGINS,
    ];
  } else {
    origins = [
      process.env.FRONTEND_URL,
      ...DEFAULT_CREDENTIAL_ORIGINS,
    ].filter(Boolean);
  }

  if (!isProd) {
    origins = [...origins, ...DEV_ORIGINS];
  }

  return [...new Set(origins)];
}

function isAllowedCredentialOrigin(origin, allowedOrigins = getAllowedOrigins()) {
  if (origin === undefined || origin === null) return true;
  if (isStagingEnv()) {
    if (hasConflictingStagingMarkers()) return false;
    const parsed = parseStagingOrigin(origin);
    // Revalidate even a caller-supplied list; no independent regex fallback.
    return parsed !== null && Array.isArray(allowedOrigins) && allowedOrigins.includes(parsed);
  }
  if (!origin) return true;
  if (DISALLOWED_CREDENTIAL_ORIGINS.has(origin)) return false;
  if (allowedOrigins.includes(origin)) return true;
  return CREDENTIAL_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

module.exports = {
  CREDENTIAL_ORIGIN_PATTERNS,
  DEFAULT_CREDENTIAL_ORIGINS,
  DEV_ORIGINS,
  DISALLOWED_CREDENTIAL_ORIGINS,
  isAllowedCredentialOrigin,
  parseCorsOrigins,
  getAllowedOrigins,
};
