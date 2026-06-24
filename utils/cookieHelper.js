const isProd = process.env.NODE_ENV === 'production';
const PROD_COOKIE_DOMAIN_DEFAULT = '.mosaicbizhub.com';

function parseBooleanEnv(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function normalizeSameSite(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'none' || normalized === 'lax' || normalized === 'strict') {
    return normalized;
  }
  return normalized;
}

function parseHostnameFromUrl(value) {
  if (!value) return undefined;
  try {
    return new URL(String(value).trim()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeDomainCandidate(domain) {
  return String(domain).trim().replace(/^\./, '').toLowerCase();
}

function isCookieDomainValidForHost(cookieDomain, requestHost) {
  if (!cookieDomain || !requestHost) return true;

  const domain = normalizeDomainCandidate(cookieDomain);
  const host = String(requestHost).trim().toLowerCase();

  return host === domain || host.endsWith(`.${domain}`);
}

function resolveApiHost() {
  return (
    parseHostnameFromUrl(process.env.API_BASE_URL) ||
    (isProd ? 'api.mosaicbizhub.com' : undefined)
  );
}

let loggedInvalidCookieDomain = false;

function resolveCookieDomain() {
  const apiHost = resolveApiHost();

  if (process.env.COOKIE_DOMAIN === undefined) {
    return isProd ? PROD_COOKIE_DOMAIN_DEFAULT : undefined;
  }

  const trimmed = String(process.env.COOKIE_DOMAIN).trim();
  if (trimmed.length === 0) return undefined;

  if (apiHost && !isCookieDomainValidForHost(trimmed, apiHost)) {
    if (!loggedInvalidCookieDomain) {
      console.warn(
        '[cookieHelper] COOKIE_DOMAIN is not valid for the API host; using safe fallback'
      );
      loggedInvalidCookieDomain = true;
    }
    return isProd ? PROD_COOKIE_DOMAIN_DEFAULT : undefined;
  }

  return trimmed;
}

const cookieSecure = parseBooleanEnv(process.env.COOKIE_SECURE, isProd);
const cookieSameSite = normalizeSameSite(
  process.env.COOKIE_SAMESITE || (cookieSecure ? 'none' : 'lax')
);
const cookieDomain = resolveCookieDomain();

function getCookieOptions(maxAge, { httpOnly = true, ...overrides } = {}) {
  const options = {
    httpOnly,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/',
    ...overrides,
  };

  if (maxAge !== undefined) {
    options.maxAge = maxAge;
  }

  if (cookieDomain) {
    options.domain = cookieDomain;
  }

  return options;
}

function setCookie(res, name, value, options = {}) {
  res.cookie(name, value, getCookieOptions(options.maxAge, options));
}

function clearCookie(res, name, options = {}) {
  res.clearCookie(name, {
    ...getCookieOptions(undefined, options),
    maxAge: 0,
    expires: new Date(0),
  });
}

function setAuthCookies(res, token, user, maxAge) {
  setCookie(res, 'token', token, { maxAge });
  setCookie(res, 'user_session', 'true', { maxAge, httpOnly: false });
  setCookie(res, 'user_gender', user.gender || '', { maxAge, httpOnly: false });
}

function clearAuthCookies(res) {
  clearCookie(res, 'token');
  clearCookie(res, 'user_session', { httpOnly: false });
  clearCookie(res, 'user_gender', { httpOnly: false });
}

module.exports = {
  getCookieOptions,
  setCookie,
  clearCookie,
  setAuthCookies,
  clearAuthCookies,
  isCookieDomainValidForHost,
  normalizeDomainCandidate,
};
