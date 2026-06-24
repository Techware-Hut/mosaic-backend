const DEFAULT_CREDENTIAL_ORIGINS = [
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8081',
  'https://app.minorityownedbusiness.info',
  'http://192.168.1.50:3000',
  'exp://192.168.0.104:8081',
  'exp://192.168.0.104:3000',
  'exp://192.168.0.104:3001',
];

function parseCorsOrigins(value) {
  return value.split(',').map((o) => o.trim()).filter(Boolean);
}

function getAllowedOrigins() {
  const isProd = process.env.NODE_ENV === 'production';
  let origins;

  if (process.env.CORS_ORIGINS) {
    origins = parseCorsOrigins(process.env.CORS_ORIGINS);
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

module.exports = {
  DEFAULT_CREDENTIAL_ORIGINS,
  DEV_ORIGINS,
  parseCorsOrigins,
  getAllowedOrigins,
};
