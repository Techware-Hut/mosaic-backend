const crypto = require('crypto');

/**
 * Attach a stable request ID for tracing admin actions and audit events.
 * Honors inbound x-request-id when present; otherwise generates one.
 */
function requestIdMiddleware(req, res, next) {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && inbound.trim()
      ? inbound.trim().slice(0, 128)
      : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = requestIdMiddleware;
