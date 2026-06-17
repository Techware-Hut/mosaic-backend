const Sentry = require('@sentry/node');

const SENSITIVE_KEYS = [
  'password',
  'otp',
  'token',
  'authorization',
  'cookie',
  'jwt',
  'secret',
  'whsec_',
  'sk_live_',
  'sk_test_',
];

function scrubValue(key, value) {
  if (value == null) return value;
  const lowerKey = String(key).toLowerCase();
  if (SENSITIVE_KEYS.some((part) => lowerKey.includes(part))) {
    return '[Filtered]';
  }
  if (typeof value === 'string' && value.length > 256) {
    return `${value.slice(0, 32)}…[truncated]`;
  }
  return value;
}

function scrubObject(input) {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((item) => scrubObject(item));
  }
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'object' ? scrubObject(value) : scrubValue(key, value),
    ])
  );
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request?.headers) {
        event.request.headers = scrubObject(event.request.headers);
      }
      if (event.request?.data) {
        event.request.data = scrubObject(event.request.data);
      }
      if (event.extra) {
        event.extra = scrubObject(event.extra);
      }
      return event;
    },
  });
}

module.exports = Sentry;
