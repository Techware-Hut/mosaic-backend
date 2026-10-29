const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { clearAuthCookies } = require('../utils/cookieHelper');
const { sendUnauthorized } = require('../utils/apiError');
const {
  resolveSessionPolicy, verifyPolicyToken, readCredentialCookie, readBearerCredential,
} = require('../utils/sessionPolicy');

function deny(req, res, message, { clearCookies = false, code } = {}) {
  if (clearCookies) {
    clearAuthCookies(res);
  }

  return sendUnauthorized(req, res, message, { code });
}

async function authenticateLegacy(req, res, next) {
  const bearerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : undefined;
  const cookieToken = req.cookies?.token;
  const token = bearerToken || cookieToken;

  if (!token) {
    return deny(req, res, 'Authentication required', { code: 'AUTHENTICATION_REQUIRED' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.sub;

    if (!userId) {
      return deny(req, res, 'Invalid authentication token', {
        clearCookies: Boolean(cookieToken),
        code: 'INVALID_AUTH_TOKEN',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return deny(req, res, 'Authenticated user not found', {
        clearCookies: Boolean(cookieToken),
        code: 'AUTH_USER_NOT_FOUND',
      });
    }

    const tokenSessionVersion = Number.isInteger(decoded.sessionVersion)
      ? decoded.sessionVersion
      : 0;
    const currentSessionVersion = user.sessionVersion || 0;

    if (tokenSessionVersion !== currentSessionVersion) {
      return deny(req, res, 'Session expired. Please log in again.', {
        clearCookies: Boolean(cookieToken),
        code: 'SESSION_EXPIRED',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return deny(req, res, 'Invalid or expired authentication token', {
      clearCookies: Boolean(cookieToken),
      code: 'INVALID_OR_EXPIRED_AUTH_TOKEN',
    });
  }
}

async function authenticateStaging(req, res, next, policy) {
  let cookie;
  let bearer;
  try {
    cookie = readCredentialCookie(req, policy.cookieNames.token);
    bearer = readBearerCredential(req);
  } catch {
    return deny(req, res, 'Conflicting authentication credentials', { code: 'AUTH_CREDENTIAL_CONFLICT' });
  }
  if (!cookie.present && !bearer.present) {
    return deny(req, res, 'Authentication required', { code: 'AUTHENTICATION_REQUIRED' });
  }
  const twoCredentials = cookie.present && bearer.present;
  try {
    // Both presented sources must verify; a successful one never masks a failed one.
    const cookieClaims = cookie.present
      ? verifyPolicyToken(cookie.value, process.env.JWT_SECRET) : undefined;
    const bearerClaims = bearer.present
      ? verifyPolicyToken(bearer.value, process.env.JWT_SECRET) : undefined;
    if (twoCredentials && (cookieClaims.sub !== bearerClaims.sub ||
        cookieClaims.sessionVersion !== bearerClaims.sessionVersion)) {
      return deny(req, res, 'Conflicting authentication credentials', { code: 'AUTH_CREDENTIAL_CONFLICT' });
    }
    const decoded = cookieClaims || bearerClaims;
    const user = await User.findById(decoded.sub);
    if (!user) {
      return deny(req, res, 'Authenticated user not found', {
        clearCookies: cookie.present && !twoCredentials, code: 'AUTH_USER_NOT_FOUND',
      });
    }
    if (decoded.sessionVersion !== (user.sessionVersion || 0)) {
      return deny(req, res, 'Session expired. Please log in again.', {
        clearCookies: cookie.present && !twoCredentials, code: 'SESSION_EXPIRED',
      });
    }
    req.user = user;
    return next();
  } catch {
    return deny(req, res, twoCredentials
      ? 'Conflicting authentication credentials' : 'Invalid or expired authentication token', {
      clearCookies: cookie.present && !twoCredentials,
      code: twoCredentials ? 'AUTH_CREDENTIAL_CONFLICT' : 'INVALID_OR_EXPIRED_AUTH_TOKEN',
    });
  }
}

module.exports = async (req, res, next) => {
  let policy;
  try { policy = resolveSessionPolicy(); }
  catch {
    return deny(req, res, 'Invalid authentication session policy configuration', {
      code: 'INVALID_AUTH_SESSION_POLICY',
    });
  }
  return policy.staging
    ? authenticateStaging(req, res, next, policy)
    : authenticateLegacy(req, res, next);
};
