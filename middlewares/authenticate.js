const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { clearAuthCookies } = require('../utils/cookieHelper');
const { sendUnauthorized } = require('../utils/apiError');

function deny(req, res, message, { clearCookies = false, code } = {}) {
  if (clearCookies) {
    clearAuthCookies(res);
  }

  return sendUnauthorized(req, res, message, { code });
}

module.exports = async (req, res, next) => {
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
};
