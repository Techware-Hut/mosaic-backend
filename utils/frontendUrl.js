const DEFAULT_FRONTEND_URL = 'https://mosaicbizhub.com';
const APPROVED_FRONTEND_ORIGINS = [
  'https://mosaicbizhub.com',
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
];
const DEV_FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const ENV_PRIORITY = [
  'CANONICAL_FRONTEND_URL',
  'PUBLIC_FRONTEND_URL',
  'NEXT_PUBLIC_APP_URL',
  'FRONTEND_URL',
  'APP_URL',
];

const DISALLOWED_FRONTEND_ORIGINS = new Set([
  'https://www.mosaicbizhub.com',
  'https://api.mosaicbizhub.com',
]);

function parseAbsoluteUrl(value) {
  if (!value) return null;

  try {
    return new URL(String(value).trim());
  } catch {
    return null;
  }
}

function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production';
}

function getAllowedFrontendOrigins(env = process.env) {
  const origins = [...APPROVED_FRONTEND_ORIGINS];

  if (!isProductionEnv(env)) {
    origins.push(...DEV_FRONTEND_ORIGINS);
  }

  return [...new Set(origins)];
}

function getOrigin(value) {
  if (!value) return null;

  const parsed = value instanceof URL ? value : parseAbsoluteUrl(value);
  return parsed?.origin || null;
}

function isAllowedFrontendOrigin(value, env = process.env) {
  const origin = getOrigin(value);
  if (!origin || DISALLOWED_FRONTEND_ORIGINS.has(origin)) return false;
  return getAllowedFrontendOrigins(env).includes(origin);
}

function toBaseUrlString(url) {
  const copy = new URL(url.toString());
  copy.search = '';
  copy.hash = '';
  if (copy.pathname === '/') {
    copy.pathname = '';
  } else {
    copy.pathname = copy.pathname.replace(/\/+$/, '');
  }
  return copy.toString().replace(/\/$/, '');
}

function getFrontendBaseUrl(env = process.env) {
  for (const key of ENV_PRIORITY) {
    const parsed = parseAbsoluteUrl(env[key]);
    if (parsed && isAllowedFrontendOrigin(parsed, env)) {
      return toBaseUrlString(parsed);
    }
  }

  return DEFAULT_FRONTEND_URL;
}

function normalizeFrontendUrl(value, env = process.env) {
  const baseUrl = getFrontendBaseUrl(env);
  const rawValue = String(value || '/').trim();
  const parsed =
    parseAbsoluteUrl(rawValue) || new URL(rawValue || '/', `${baseUrl}/`);

  if (isAllowedFrontendOrigin(parsed, env)) {
    return parsed.toString();
  }

  const safe = new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, `${baseUrl}/`);
  return safe.toString();
}

function sanitizeFrontendRedirectUrl(value, env = process.env, fallbackPath = '/') {
  const baseUrl = getFrontendBaseUrl(env);
  const rawValue = String(value || fallbackPath || '/').trim();
  const parsed =
    parseAbsoluteUrl(rawValue) || new URL(rawValue || fallbackPath || '/', `${baseUrl}/`);

  if (isAllowedFrontendOrigin(parsed, env)) {
    return parsed.toString();
  }

  return buildFrontendUrl(fallbackPath || '/', env);
}

function buildFrontendUrl(path = '/', env = process.env) {
  return normalizeFrontendUrl(path, env);
}

function getFrontendLogoUrl(env = process.env) {
  return buildFrontendUrl('/_next/image?url=%2Flogo.png&w=750&q=75', env);
}

module.exports = {
  APPROVED_FRONTEND_ORIGINS,
  DEFAULT_FRONTEND_URL,
  DEV_FRONTEND_ORIGINS,
  buildFrontendUrl,
  getAllowedFrontendOrigins,
  getFrontendBaseUrl,
  getFrontendLogoUrl,
  isAllowedFrontendOrigin,
  normalizeFrontendUrl,
  sanitizeFrontendRedirectUrl,
};
