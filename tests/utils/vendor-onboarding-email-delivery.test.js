const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  isVendorEmailConfigured,
  deliverVendorOnboardingEmail,
  deliverVendorOnboardingEmails,
} = require('../../utils/vendorOnboardingEmailDelivery');

const originalMailUser = process.env.MAIL_USER;
const originalMailPassword = process.env.MAIL_PASSWORD;

function restoreMailEnv() {
  if (originalMailUser === undefined) {
    delete process.env.MAIL_USER;
  } else {
    process.env.MAIL_USER = originalMailUser;
  }
  if (originalMailPassword === undefined) {
    delete process.env.MAIL_PASSWORD;
  } else {
    process.env.MAIL_PASSWORD = originalMailPassword;
  }
}

test('isVendorEmailConfigured returns false when MAIL_USER or MAIL_PASSWORD missing', () => {
  process.env.MAIL_USER = '';
  process.env.MAIL_PASSWORD = 'secret';
  assert.equal(isVendorEmailConfigured(), false);

  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = '';
  assert.equal(isVendorEmailConfigured(), false);

  restoreMailEnv();
});

test('isVendorEmailConfigured returns true when both env vars are set', () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';
  assert.equal(isVendorEmailConfigured(), true);
  restoreMailEnv();
});

test('deliverVendorOnboardingEmail skips when SMTP not configured', async () => {
  process.env.MAIL_USER = '';
  process.env.MAIL_PASSWORD = '';

  const warnLogs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnLogs.push(args.join(' '));

  const result = await deliverVendorOnboardingEmail({
    label: 'test_skip',
    send: async () => {
      throw new Error('should not run');
    },
  });

  console.warn = originalWarn;
  restoreMailEnv();

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'email_not_configured');
  assert.ok(warnLogs.some((line) => line.includes('test_skip')));
});

test('deliverVendorOnboardingEmail returns sent on success', async () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';

  const result = await deliverVendorOnboardingEmail({
    label: 'test_success',
    send: async () => {},
  });

  restoreMailEnv();

  assert.equal(result.sent, true);
  assert.equal(result.skipped, false);
});

test('deliverVendorOnboardingEmail logs message only on failure', async () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';

  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const result = await deliverVendorOnboardingEmail({
    label: 'test_fail',
    send: async () => {
      throw new Error('SMTP timeout');
    },
  });

  console.error = originalError;
  restoreMailEnv();

  assert.equal(result.sent, false);
  assert.equal(result.skipped, false);
  assert.equal(result.error, 'SMTP timeout');
  assert.ok(errorLogs.some((line) => line.includes('test_fail')));
  assert.ok(!errorLogs.some((line) => line.includes('app-password')));
});

test('deliverVendorOnboardingEmails aggregates partial success', async () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';

  const delivery = await deliverVendorOnboardingEmails([
    {
      label: 'first',
      send: async () => {},
    },
    {
      label: 'second',
      send: async () => {
        throw new Error('second failed');
      },
    },
  ]);

  restoreMailEnv();

  assert.equal(delivery.emailSent, true);
  assert.equal(delivery.emailSkipped, false);
  assert.equal(delivery.emailFailed, false);
  assert.equal(delivery.results.length, 2);
  assert.equal(delivery.results[0].sent, true);
  assert.equal(delivery.results[1].sent, false);
});
