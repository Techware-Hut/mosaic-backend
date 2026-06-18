const Sentry = require('../instrument');
const { isSentryEnabled } = require('../instrument');

/**
 * Reports HTTP 5xx responses to Sentry when controllers return errors
 * without calling next(err). Unhandled throws are covered by setupExpressErrorHandler.
 */
function sentryHttpCapture(req, res, next) {
  if (!isSentryEnabled()) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode >= 500) {
      Sentry.captureMessage(`HTTP ${res.statusCode} ${req.method} ${req.originalUrl}`, {
        level: 'error',
        tags: {
          method: req.method,
          path: req.originalUrl,
          status_code: String(res.statusCode),
        },
      });
    }
  });

  next();
}

module.exports = sentryHttpCapture;
