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

function parseCorsOrigins(value) {
  return value
    .split(',')
    .map((o) => o.trim())
    .filter((origin) => origin && origin !== '*' && !DISALLOWED_CREDENTIAL_ORIGINS.has(origin));
}

function getAllowedOrigins() {
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
