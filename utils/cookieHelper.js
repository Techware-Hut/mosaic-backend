const isProd = process.env.NODE_ENV === 'production';

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

function resolveCookieDomain() {
  if (process.env.COOKIE_DOMAIN === undefined) {
    return isProd ? '.mosaicbizhub.com' : undefined;
  }

  const trimmed = String(process.env.COOKIE_DOMAIN).trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
    maxAge,
    ...overrides,
  };

  if (cookieDomain) {
    options.domain = cookieDomain;
  }

  return options;
}

function setCookie(res, name, value, options = {}) {
  res.cookie(name, value, getCookieOptions(options.maxAge, options));
}

function clearCookie(res, name, options = {}) {
  res.clearCookie(name, getCookieOptions(undefined, options));
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
};
