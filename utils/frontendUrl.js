const DEFAULT_FRONTEND_URL = 'https://mosaicbizhub.com';
// Keep the exported legacy name for production rollback compatibility.
const LEGACY_FRONTEND_URL = 'https://app.mosaicbizhub.com';
const LAUNCH_QA_FRONTEND_URL = 'https://mosaic-biz-frontend-launch.vercel.app';
const APPROVED_FRONTEND_ORIGINS = [
  DEFAULT_FRONTEND_URL,
  LAUNCH_QA_FRONTEND_URL,
];
const GENERATED_FRONTEND_ORIGINS = [...APPROVED_FRONTEND_ORIGINS];
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
const OVERRIDE_KEYS = [
  'CONNECT_RETURN_URL',
  'CONNECT_REFRESH_URL',
  'BILLING_PORTAL_RETURN_URL',
];
const DISALLOWED_FRONTEND_ORIGINS = new Set([
  'https://www.mosaicbizhub.com',
  'https://api.mosaicbizhub.com',
  'https://api-staging.mosaicbizhub.com',
]);
const VERCEL_PREVIEW_PATTERN = /^https:\/\/mosaic-biz-frontend-launch(?:-[a-z0-9-]+)?\.vercel\.app$/i;

function safeText(value) {
  const text = String(value || '');
  if (/[\u0000-\u001f\u007f\\]/.test(text) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(text) || /%(?![0-9a-f]{2})/i.test(text)) return null;
  return text.trim();
}

function parseAbsoluteUrl(value) {
  const text = safeText(value);
  // Do not let URL's forgiving parser repair malformed schemes/authorities.
  if (!text || !/^https?:\/\/[^\s\\/?#@]+(?:[/?#]|$)/i.test(text)) return null;
  try {
    const parsed = new URL(text);
    return parsed.username || parsed.password ? null : parsed;
  } catch {
    return null;
  }
}

function isProductionEnv(env = process.env) {
  // Used only to preserve the existing local-development origin contract.
  return env.NODE_ENV === 'production';
}

function marker(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isStagingEnv(env = process.env) {
  return marker(env.RELEASE_ENVIRONMENT) === 'staging' || marker(env.SENTRY_ENVIRONMENT) === 'staging';
}

function hasConflictingMarkers(env) {
  const release = marker(env.RELEASE_ENVIRONMENT);
  const sentry = marker(env.SENTRY_ENVIRONMENT);
  return isStagingEnv(env) && release && sentry && release !== sentry;
}

function isAllowedPreviewOrigin(origin) {
  // Classification only. Trust additionally requires exact explicit configuration.
  return typeof origin === 'string' && VERCEL_PREVIEW_PATTERN.test(origin);
}

function isConfiguredBaseAllowed(parsed, env) {
  const origin = parsed.origin;
  if (DISALLOWED_FRONTEND_ORIGINS.has(origin)) return false;
  if (isStagingEnv(env)) {
    return origin === LEGACY_FRONTEND_URL || origin === LAUNCH_QA_FRONTEND_URL || isAllowedPreviewOrigin(origin);
  }
  return GENERATED_FRONTEND_ORIGINS.includes(origin) || isAllowedPreviewOrigin(origin) ||
    (!isProductionEnv(env) && DEV_FRONTEND_ORIGINS.includes(origin));
}

function toBaseUrlString(url) {
  const copy = new URL(url.toString());
  copy.search = '';
  copy.hash = '';
  copy.pathname = copy.pathname.replace(/\/+$/, '');
  return copy.toString().replace(/\/$/, '');
}

function getFrontendBaseUrl(env = process.env) {
  const staging = isStagingEnv(env);
  // An established staging fallback avoids new import-time/after-write errors.
  // Contradictory markers never silently become production or activate app.
  if (hasConflictingMarkers(env)) return LAUNCH_QA_FRONTEND_URL;
  for (const key of ENV_PRIORITY) {
    if (typeof env[key] !== 'string' || !env[key].trim()) continue;
    const parsed = parseAbsoluteUrl(env[key]);
    if (parsed && isConfiguredBaseAllowed(parsed, env)) return toBaseUrlString(parsed);
    // A broken higher-priority staging setting must not fall through to production.
    if (staging) return LAUNCH_QA_FRONTEND_URL;
  }
  return staging ? LAUNCH_QA_FRONTEND_URL : DEFAULT_FRONTEND_URL;
}

function getOrigin(value) {
  return parseAbsoluteUrl(value)?.origin || null;
}

function configuredPreviewOrigins(env) {
  return [...ENV_PRIORITY, ...OVERRIDE_KEYS].map(key => getOrigin(env[key])).filter(origin => isAllowedPreviewOrigin(origin));
}

function getGeneratedFrontendOrigins(env = process.env) {
  if (isStagingEnv(env)) return [getOrigin(getFrontendBaseUrl(env))];
  return [...new Set([
    ...GENERATED_FRONTEND_ORIGINS,
    ...(!isProductionEnv(env) ? DEV_FRONTEND_ORIGINS : []),
    ...configuredPreviewOrigins(env),
  ])];
}

function getAllowedFrontendOrigins(env = process.env) {
  const origins = getGeneratedFrontendOrigins(env);
  if (!isStagingEnv(env) && (env.ALLOW_LEGACY_FRONTEND_ORIGIN === 'true' || env.ALLOW_LEGACY_FRONTEND_ORIGIN === '1')) {
    origins.push(LEGACY_FRONTEND_URL);
  }
  return [...new Set(origins)];
}

function isAllowedFrontendOrigin(value, env = process.env) {
  const parsed = parseAbsoluteUrl(value);
  return Boolean(parsed && getAllowedFrontendOrigins(env).includes(parsed.origin));
}

function isAllowedGeneratedFrontendOrigin(value, env = process.env) {
  const parsed = parseAbsoluteUrl(value);
  return Boolean(parsed && getGeneratedFrontendOrigins(env).includes(parsed.origin));
}

function parseDestination(value, baseUrl) {
  const text = safeText(value);
  if (text === null || text.startsWith('//')) return null;
  try {
    const parsed = /^[a-z][a-z\d+.-]*:/i.test(text)
      ? parseAbsoluteUrl(text) : new URL(text || '/', baseUrl + '/');
    if (!parsed) return null;
    // Reject encoded protocol-relative/backslash paths, not ordinary encoded data.
    if (/^\/+%(?:25)*(?:2f|5c)/i.test(parsed.pathname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function rebase(parsed, baseUrl) {
  const safe = new URL('/', baseUrl + '/');
  // Component assignment cannot reinterpret a // path as an external authority.
  safe.pathname = parsed.pathname;
  safe.search = parsed.search;
  safe.hash = parsed.hash;
  return safe.toString();
}

function normalizeFrontendUrl(value, env = process.env) {
  const baseUrl = getFrontendBaseUrl(env);
  const parsed = parseDestination(value, baseUrl);
  if (!parsed) return new URL('/', baseUrl + '/').toString();
  if (isAllowedFrontendOrigin(parsed, env)) return parsed.toString();
  return rebase(parsed, baseUrl);
}

function sanitizeFrontendRedirectUrl(value, env = process.env, fallbackPath = '/') {
  const baseUrl = getFrontendBaseUrl(env);
  const fallback = parseDestination(fallbackPath, baseUrl);
  const safeFallback = fallback && isAllowedFrontendOrigin(fallback, env)
    ? fallback.toString() : new URL('/', baseUrl + '/').toString();
  const parsed = parseDestination(value || fallbackPath, baseUrl);
  return parsed && isAllowedFrontendOrigin(parsed, env) ? parsed.toString() : safeFallback;
}

function buildFrontendUrl(path = '/', env = process.env) {
  return normalizeFrontendUrl(path, env);
}

function getFrontendLogoUrl(env = process.env) {
  // Explicit mail assets have a separate contract from application redirects.
  if (typeof env.MAIL_LOGO_URL === 'string' && env.MAIL_LOGO_URL.trim()) return env.MAIL_LOGO_URL.trim();
  return buildFrontendUrl('/logo.png', env);
}

module.exports = {
  APPROVED_FRONTEND_ORIGINS,
  DEFAULT_FRONTEND_URL,
  DEV_FRONTEND_ORIGINS,
  GENERATED_FRONTEND_ORIGINS,
  LAUNCH_QA_FRONTEND_URL,
  LEGACY_FRONTEND_URL,
  VERCEL_PREVIEW_PATTERN,
  buildFrontendUrl,
  getAllowedFrontendOrigins,
  getFrontendBaseUrl,
  getGeneratedFrontendOrigins,
  getFrontendLogoUrl,
  isAllowedGeneratedFrontendOrigin,
  isAllowedFrontendOrigin,
  isAllowedPreviewOrigin,
  isStagingEnv,
  normalizeFrontendUrl,
  sanitizeFrontendRedirectUrl,
};
