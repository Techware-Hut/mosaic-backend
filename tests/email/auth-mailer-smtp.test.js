const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const mailerPath = path.resolve(__dirname, '../../utils/mailer.js');

const ENV_KEYS = [
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_SECURE',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'MAIL_FROM',
];

function snapshotEnv() {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

function loadMailerWithNodemailer(nodemailerMock) {
  const originalLoad = Module._load;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') {
      return nodemailerMock;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[mailerPath];
  const mailer = require(mailerPath);
  Module._load = originalLoad;
  return mailer;
}

test('sendOtpEmail uses provider-neutral SMTP config and MAIL_FROM for auth mail', async () => {
  const savedEnv = snapshotEnv();
  process.env.MAIL_HOST = 'smtp.resend.com';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_SECURE = 'true';
  process.env.MAIL_USER = 'resend';
  process.env.MAIL_PASSWORD = 'smtp-password';
  process.env.MAIL_FROM = 'Mosaic Biz Hub <hello@mosaicbizhub.com>';

  const createdConfigs = [];
  const sentMessages = [];
  const nodemailerMock = {
    createTransport(config) {
      createdConfigs.push(config);
      return {
        verify: async () => {},
        sendMail: async (message) => {
          sentMessages.push(message);
        },
      };
    },
  };

  const mailer = loadMailerWithNodemailer(nodemailerMock);

  try {
    await mailer.sendOtpEmail('recipient@example.com', '123456', 'register');
  } finally {
    restoreEnv(savedEnv);
    delete require.cache[mailerPath];
  }

  assert.equal(createdConfigs.length, 1);
  assert.deepEqual(createdConfigs[0], {
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    auth: {
      user: 'resend',
      pass: 'smtp-password',
    },
  });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Mosaic Biz Hub <hello@mosaicbizhub.com>');
  assert.equal(sentMessages[0].to, 'recipient@example.com');
});

test('sendWelcomeEmail uses provider-neutral SMTP config and MAIL_FROM', async () => {
  const savedEnv = snapshotEnv();
  process.env.MAIL_HOST = 'smtp.resend.com';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_SECURE = 'true';
  process.env.MAIL_USER = 'resend';
  process.env.MAIL_PASSWORD = 'smtp-password';
  process.env.MAIL_FROM = 'Mosaic Biz Hub <hello@mosaicbizhub.com>';

  const createdConfigs = [];
  const sentMessages = [];
  const nodemailerMock = {
    createTransport(config) {
      createdConfigs.push(config);
      return {
        verify: async () => {},
        sendMail: async (message) => {
          sentMessages.push(message);
        },
      };
    },
  };

  const mailer = loadMailerWithNodemailer(nodemailerMock);

  try {
    await mailer.sendWelcomeEmail('vendor@example.com', 'Vendor', 'business_owner');
  } finally {
    restoreEnv(savedEnv);
    delete require.cache[mailerPath];
  }

  assert.equal(createdConfigs.length, 1);
  assert.deepEqual(createdConfigs[0], {
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    auth: {
      user: 'resend',
      pass: 'smtp-password',
    },
  });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Mosaic Biz Hub <hello@mosaicbizhub.com>');
  assert.equal(sentMessages[0].to, 'vendor@example.com');
});
