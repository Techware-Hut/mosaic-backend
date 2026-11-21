const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveStripeMode,
  getIsolationSelfCheck,
} = require('../../utils/isolationSelfCheck');
const { isLikelySafePublicReleasePayload } = require('../../utils/releaseIdentity');

const jobsOff = () => ({ onboardingReminders: false, inventoryReservationExpiry: false });

function stagingEnv(overrides = {}) {
  return {
    RELEASE_ENVIRONMENT: 'staging',
    STRIPE_SECRET_KEY: 'sk_test_fake_key_value',
    STRIPE_ORDER_WEBHOOK_SECRET: 'whsec_fake',
    STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: '',
    MAIL_USER: 'mailer@example.com',
    MAIL_PASSWORD: 'fake-pass',
    MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com, @example.org',
    SMS_RECIPIENT_ALLOWLIST: '+17575550100',
    TELNYX_API_KEY: 'KEYfake',
    AWS_S3_BUCKET: 'mosaic-staging-uploads',
    ADMIN_EMAIL: 'admin@example.com',
    ...overrides,
  };
}

test('deriveStripeMode maps key prefixes to enums without echoing the key', () => {
  assert.equal(deriveStripeMode(undefined), 'unset');
  assert.equal(deriveStripeMode('   '), 'unset');
  assert.equal(deriveStripeMode('sk_test_abc'), 'test');
  assert.equal(deriveStripeMode('rk_test_abc'), 'test');
  assert.equal(deriveStripeMode('sk_live_abc'), 'live');
  assert.equal(deriveStripeMode('rk_live_abc'), 'live');
  assert.equal(deriveStripeMode('pk_test_abc'), 'unknown');
  assert.equal(deriveStripeMode('garbage'), 'unknown');
});

test('getIsolationSelfCheck returns the documented shape with booleans/enums only', () => {
  const check = getIsolationSelfCheck({
    env: stagingEnv(),
    connection: { name: 'mosaic_staging' },
    getJobs: () => ({ onboardingReminders: true, inventoryReservationExpiry: false }),
  });

  assert.deepEqual(Object.keys(check).sort(), [
    'adminEmailExplicit', 'allowedHostnameCount', 'contactVerification', 'database', 'environment', 'jobs', 'mail', 'sms', 'stagingMarker', 'storage', 'stripe',
  ]);
  assert.equal(check.stagingMarker, true);
  assert.equal(typeof check.environment, 'string');
  assert.deepEqual(check.database, { name: 'mosaic_staging' });
  assert.deepEqual(check.stripe, {
    mode: 'test',
    webhookSigningConfigured: {
      order: true,
      subscription: false,
      businessDraft: false,
      orderPostPayment: false,
      vendorVerification: false,
    },
  });
  assert.deepEqual(check.jobs, { onboardingReminders: true, inventoryReservationExpiry: false });
  assert.deepEqual(check.mail, {
    configured: true,
    recipientAllowlistEnabled: true,
    recipientPolicy: 'enforced',
    allowlistSize: 2,
  });
  assert.deepEqual(check.sms, {
    configured: true,
    recipientAllowlistEnabled: true,
    recipientPolicy: 'enforced',
    allowlistSize: 1,
  });
  assert.deepEqual(check.storage, { bucketConfigured: true, region: 'us-east-1' });
  assert.equal(check.adminEmailExplicit, true);
});

test('self-check never contains key material and passes the public payload guard', () => {
  const env = stagingEnv({
    STRIPE_SECRET_KEY: 'sk_live_supersensitive',
    AWS_ACCESS_KEY_ID: 'AKIAFAKEACCESSKEY',
    AWS_SECRET_ACCESS_KEY: 'fakeSecretAccessKeyValue',
    AWS_REGION: 'us-west-2',
  });
  const check = getIsolationSelfCheck({ env, connection: { name: 'mosaic_staging' }, getJobs: jobsOff });
  const serialized = JSON.stringify(check);

  assert.equal(check.stripe.mode, 'live');
  assert.equal(check.storage.region, 'us-west-2');
  assert.ok(!serialized.includes('supersensitive'));
  assert.ok(!serialized.includes('AKIAFAKEACCESSKEY'));
  assert.ok(!serialized.includes('fakeSecretAccessKeyValue'));
  assert.ok(!serialized.includes('whsec_'));
  assert.ok(!serialized.includes('qa@example.com'));
  assert.ok(!serialized.includes('+17575550100'));
  assert.ok(!serialized.includes('mosaic-staging-uploads'));
  assert.ok(!serialized.includes('admin@example.com'));
  assert.ok(!serialized.includes('mailer@example.com'));
  assert.ok(!serialized.includes('KEYfake'));
  assert.equal(isLikelySafePublicReleasePayload(check), true);
});

test('self-check reports unset/disabled values outside staging', () => {
  const check = getIsolationSelfCheck({
    env: { MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com', SMS_RECIPIENT_ALLOWLIST: '+17575550100' },
    connection: {},
    getJobs: jobsOff,
  });

  assert.equal(check.stagingMarker, false);
  assert.equal(check.database.name, null);
  assert.equal(check.stripe.mode, 'unset');
  assert.deepEqual(check.mail, {
    configured: false,
    recipientAllowlistEnabled: false,
    recipientPolicy: 'off',
    allowlistSize: 0,
  });
  assert.deepEqual(check.sms, {
    configured: false,
    recipientAllowlistEnabled: false,
    recipientPolicy: 'off',
    allowlistSize: 0,
  });
  assert.deepEqual(check.storage, { bucketConfigured: false, region: 'us-east-1' });
  assert.equal(check.adminEmailExplicit, false);
  assert.equal(isLikelySafePublicReleasePayload(check), true);
});

test('self-check reuses the job modules enabled logic by default', () => {
  const saved = {
    a: process.env.ENABLE_ONBOARDING_REMINDERS,
    b: process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY,
  };
  process.env.ENABLE_ONBOARDING_REMINDERS = 'true';
  process.env.ENABLE_INVENTORY_RESERVATION_EXPIRY = 'false';
  try {
    const check = getIsolationSelfCheck({ env: {}, connection: {} });
    assert.deepEqual(check.jobs, { onboardingReminders: true, inventoryReservationExpiry: false });
  } finally {
    for (const [key, name] of [['a', 'ENABLE_ONBOARDING_REMINDERS'], ['b', 'ENABLE_INVENTORY_RESERVATION_EXPIRY']]) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
  }
});

test('self-check reports the fail-closed staging policy when allowlists are unset or invalid', () => {
  const unset = getIsolationSelfCheck({
    env: stagingEnv({ MAIL_RECIPIENT_ALLOWLIST: undefined, SMS_RECIPIENT_ALLOWLIST: '  ' }),
    connection: { name: 'mosaic_staging' },
    getJobs: jobsOff,
  });
  assert.equal(unset.mail.recipientAllowlistEnabled, true);
  assert.equal(unset.mail.recipientPolicy, 'suppress_all_unset');
  assert.equal(unset.mail.allowlistSize, 0);
  assert.equal(unset.sms.recipientPolicy, 'suppress_all_unset');

  const invalid = getIsolationSelfCheck({
    env: stagingEnv({ MAIL_RECIPIENT_ALLOWLIST: 'nope', SMS_RECIPIENT_ALLOWLIST: '7575550100' }),
    connection: { name: 'mosaic_staging' },
    getJobs: jobsOff,
  });
  assert.equal(invalid.mail.recipientPolicy, 'suppress_all_invalid');
  assert.equal(invalid.sms.recipientPolicy, 'suppress_all_invalid');
  assert.equal(isLikelySafePublicReleasePayload(invalid), true);
});

test('contact verification reports configuration without secrets', () => {
  for (const secret of ['', 'synthetic-secret']) {
    const check = getIsolationSelfCheck({ env: { RECAPTCHA_SECRET_KEY: secret, FRONTEND_URL: 'https://example.com' }, connection: {}, getJobs: jobsOff });
    assert.equal(check.contactVerification, secret ? 'enforced' : 'not_configured');
    assert.equal(check.allowedHostnameCount, 1);
    assert.equal(JSON.stringify(check).includes('synthetic-secret'), false);
    assert.equal(isLikelySafePublicReleasePayload(check), true);
  }
});
