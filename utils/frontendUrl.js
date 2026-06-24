const DEFAULT_FRONTEND_URL = 'https://mosaicbizhub.com';
const LEGACY_FRONTEND_HOSTS = new Set(['app.mosaicbizhub.com']);

const ENV_PRIORITY = [
  'CANONICAL_FRONTEND_URL',
  'PUBLIC_FRONTEND_URL',
  'NEXT_PUBLIC_APP_URL',
  'FRONTEND_URL',
  'APP_URL',
];

function parseAbsoluteUrl(value) {
  if (!value) return null;

  try {
    return new URL(String(value).trim());
  } catch {
    return null;
  }
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

function isLegacyFrontendHost(url) {
  return LEGACY_FRONTEND_HOSTS.has(url.hostname.toLowerCase());
}

function getFrontendBaseUrl(env = process.env) {
  for (const key of ENV_PRIORITY) {
    const parsed = parseAbsoluteUrl(env[key]);
    if (parsed && !isLegacyFrontendHost(parsed)) {
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

  if (isLegacyFrontendHost(parsed)) {
    const canonical = new URL(`${baseUrl}/`);
    parsed.protocol = canonical.protocol;
    parsed.host = canonical.host;
  }

  return parsed.toString();
}

function buildFrontendUrl(path = '/', env = process.env) {
  return normalizeFrontendUrl(path, env);
}

function getFrontendLogoUrl(env = process.env) {
  return buildFrontendUrl('/_next/image?url=%2Flogo.png&w=750&q=75', env);
}

module.exports = {
  DEFAULT_FRONTEND_URL,
  LEGACY_FRONTEND_HOSTS,
  buildFrontendUrl,
  getFrontendBaseUrl,
  getFrontendLogoUrl,
  normalizeFrontendUrl,
};
