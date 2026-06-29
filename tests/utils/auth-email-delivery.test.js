const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isAuthEmailConfigured,
  deliverAuthOtpEmail,
} = require('../../utils/authEmailDelivery');

const deliveryPath = path.resolve(__dirname, '../../utils/authEmailDelivery.js');

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

test('isAuthEmailConfigured returns false when MAIL_USER or MAIL_PASSWORD missing', () => {
  process.env.MAIL_USER = '';
  process.env.MAIL_PASSWORD = 'secret';
  assert.equal(isAuthEmailConfigured(), false);

  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = '';
  assert.equal(isAuthEmailConfigured(), false);

  restoreMailEnv();
});

test('isAuthEmailConfigured returns true when both env vars are set', () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';
  assert.equal(isAuthEmailConfigured(), true);
  restoreMailEnv();
});

test('deliverAuthOtpEmail returns email_not_configured when SMTP not configured', async () => {
  process.env.MAIL_USER = '';
  process.env.MAIL_PASSWORD = '';

  const warnLogs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnLogs.push(args.join(' '));

  const result = await deliverAuthOtpEmail({
    context: 'register',
    send: async () => {
      throw new Error('should not run');
    },
  });

  console.warn = originalWarn;
  restoreMailEnv();

  assert.equal(result.sent, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'email_not_configured');
  assert.ok(warnLogs.some((line) => line.includes('register')));
});

test('deliverAuthOtpEmail returns sent on success', async () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';

  const result = await deliverAuthOtpEmail({
    context: 'resend',
    send: async () => {},
  });

  restoreMailEnv();

  assert.equal(result.sent, true);
  assert.equal(result.skipped, false);
});

test('deliverAuthOtpEmail logs message only on failure', async () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';

  const errorLogs = [];
  const originalError = console.error;
  console.error = (...args) => errorLogs.push(args.join(' '));

  const result = await deliverAuthOtpEmail({
    context: 'unverifiedLogin',
    send: async () => {
      throw new Error('EAUTH invalid credentials');
    },
  });

  console.error = originalError;
  restoreMailEnv();

  assert.equal(result.sent, false);
  assert.equal(result.skipped, false);
  assert.equal(result.error, 'EAUTH invalid credentials');
  assert.ok(errorLogs.some((line) => line.includes('unverifiedLogin')));
  assert.ok(!errorLogs.some((line) => line.includes('app-password')));
});

test('authEmailDelivery source avoids logging credential values', () => {
  const source = fs.readFileSync(deliveryPath, 'utf8');
  assert.ok(source.includes('err.message'));
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*MAIL_PASSWORD/));
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*MAIL_USER/));
});
