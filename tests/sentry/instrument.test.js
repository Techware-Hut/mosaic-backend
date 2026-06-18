const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const instrumentPath = path.resolve(__dirname, '../../instrument.js');

function loadInstrumentWithEnv(envOverrides = {}) {
  const saved = {};
  for (const key of [
    'SENTRY_DSN',
    'SENTRY_ENABLED',
    'SENTRY_ENVIRONMENT',
    'SENTRY_RELEASE',
    'SENTRY_TRACES_SAMPLE_RATE',
    'SENTRY_PROFILES_SAMPLE_RATE',
  ]) {
    saved[key] = process.env[key];
  }

  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_ENABLED;
  Object.assign(process.env, envOverrides);

  delete require.cache[instrumentPath];
  const mod = require(instrumentPath);

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  delete require.cache[instrumentPath];
  return mod;
}

test('isSentryEnabled returns false when SENTRY_DSN is unset', () => {
  const { isSentryEnabled } = loadInstrumentWithEnv();
  assert.equal(isSentryEnabled(), false);
});

test('isSentryEnabled returns false when SENTRY_ENABLED is false', () => {
  const { isSentryEnabled } = loadInstrumentWithEnv({
    SENTRY_DSN: 'https://example@sentry.io/1',
    SENTRY_ENABLED: 'false',
  });
  assert.equal(isSentryEnabled(), false);
});

test('isSentryEnabled returns true when DSN is set and not disabled', () => {
  const savedDsn = process.env.SENTRY_DSN;
  const savedEnabled = process.env.SENTRY_ENABLED;
  process.env.SENTRY_DSN = 'https://example@sentry.io/1';
  process.env.SENTRY_ENABLED = 'true';
  delete require.cache[instrumentPath];
  const { isSentryEnabled } = require(instrumentPath);
  assert.equal(isSentryEnabled(), true);
  if (savedDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = savedDsn;
  if (savedEnabled === undefined) delete process.env.SENTRY_ENABLED;
  else process.env.SENTRY_ENABLED = savedEnabled;
  delete require.cache[instrumentPath];
});

test('scrubObject redacts sensitive keys', () => {
  const { scrubObject } = loadInstrumentWithEnv();
  const scrubbed = scrubObject({
    email: 'user@example.com',
    password: 'secret123',
    authorization: 'Bearer token',
    nested: { otp: '123456', note: 'ok' },
  });

  assert.equal(scrubbed.email, 'user@example.com');
  assert.equal(scrubbed.password, '[Filtered]');
  assert.equal(scrubbed.authorization, '[Filtered]');
  assert.equal(scrubbed.nested.otp, '[Filtered]');
  assert.equal(scrubbed.nested.note, 'ok');
});

test('scrubObject truncates long string values', () => {
  const { scrubObject } = loadInstrumentWithEnv();
  const longValue = 'x'.repeat(300);
  const scrubbed = scrubObject({ description: longValue });
  assert.match(scrubbed.description, /\[truncated\]$/);
  assert.ok(scrubbed.description.length < longValue.length);
});
