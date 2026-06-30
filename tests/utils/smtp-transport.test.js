const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
  getMailFromAddress,
  parseMailPort,
  parseMailSecure,
} = require('../../utils/smtpTransport');

test('buildSmtpTransportConfig keeps Gmail fallback when MAIL_HOST is unset', () => {
  const config = buildSmtpTransportConfig({
    MAIL_USER: 'mail@example.com',
    MAIL_PASSWORD: 'app-password',
  });

  assert.deepEqual(config, {
    service: 'gmail',
    auth: {
      user: 'mail@example.com',
      pass: 'app-password',
    },
  });
});

test('buildSmtpTransportConfig uses provider-neutral SMTP when MAIL_HOST is set', () => {
  const config = buildSmtpTransportConfig({
    MAIL_HOST: 'smtp.resend.com',
    MAIL_PORT: '465',
    MAIL_SECURE: 'true',
    MAIL_USER: 'resend',
    MAIL_PASSWORD: 'smtp-password',
  });

  assert.equal(config.host, 'smtp.resend.com');
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.deepEqual(config.auth, {
    user: 'resend',
    pass: 'smtp-password',
  });
});

test('parseMailPort parses MAIL_PORT=465 as a number', () => {
  assert.equal(parseMailPort('465'), 465);
});

test('parseMailSecure parses MAIL_SECURE=true as boolean true', () => {
  assert.equal(parseMailSecure('true'), true);
  assert.equal(parseMailSecure('TRUE'), true);
  assert.equal(parseMailSecure('false'), false);
});

test('MAIL_FROM is preferred over MAIL_USER for the From header', () => {
  const env = {
    MAIL_FROM: 'Mosaic Biz Hub <hello@mosaicbizhub.com>',
    MAIL_USER: 'smtp-login@example.com',
  };

  assert.equal(getMailFromAddress(env), 'Mosaic Biz Hub <hello@mosaicbizhub.com>');
  assert.equal(formatMosaicFromHeader(env), 'Mosaic Biz Hub <hello@mosaicbizhub.com>');
});

test('MAIL_FROM falls back to MAIL_USER for Gmail compatibility', () => {
  const env = {
    MAIL_USER: 'mail@example.com',
  };

  assert.equal(getMailFromAddress(env), 'mail@example.com');
  assert.equal(formatMosaicFromHeader(env), '"Mosaic Biz Hub" <mail@example.com>');
});
