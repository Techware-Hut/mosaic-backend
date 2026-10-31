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
  'NODE_ENV',
  'RELEASE_ENVIRONMENT',
  'SENTRY_ENVIRONMENT',
  'CANONICAL_FRONTEND_URL',
  'PUBLIC_FRONTEND_URL',
  'NEXT_PUBLIC_APP_URL',
  'FRONTEND_URL',
  'APP_URL',
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

  try {
    delete require.cache[mailerPath];
    return require(mailerPath);
  } finally {
    Module._load = originalLoad;
  }
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

const STAGING_HOME = 'https://mosaic-biz-frontend-launch.vercel.app/';
const APP_HOME = 'https://app.mosaicbizhub.com/';
const PRODUCTION_HOME = 'https://mosaicbizhub.com/';
const stagingEnv = { NODE_ENV: 'production', RELEASE_ENVIRONMENT: 'staging' };

const homepageCases = [
  ['configured stable staging', { ...stagingEnv, FRONTEND_URL: STAGING_HOME }, STAGING_HOME],
  ['configured future app staging', { ...stagingEnv, FRONTEND_URL: APP_HOME }, APP_HOME],
  ['production canonical homepage', { NODE_ENV: 'production', FRONTEND_URL: PRODUCTION_HOME }, PRODUCTION_HOME],
  ['missing staging configuration', stagingEnv, STAGING_HOME],
  ['invalid staging configuration', { ...stagingEnv, FRONTEND_URL: 'https://untrusted.example.test' }, STAGING_HOME],
  ['invalid higher-priority staging configuration', {
    ...stagingEnv, CANONICAL_FRONTEND_URL: PRODUCTION_HOME, FRONTEND_URL: APP_HOME,
  }, STAGING_HOME],
  ['conflicting staging markers', {
    ...stagingEnv, SENTRY_ENVIRONMENT: 'production', FRONTEND_URL: APP_HOME,
  }, STAGING_HOME],
  ['approved higher-priority staging configuration', {
    ...stagingEnv, CANONICAL_FRONTEND_URL: APP_HOME, FRONTEND_URL: STAGING_HOME,
  }, APP_HOME],
  ['supported local configuration', {
    NODE_ENV: 'development', FRONTEND_URL: 'http://localhost:3000',
  }, 'http://localhost:3000/'],
];

for (const [label, urlEnv, expectedHome] of homepageCases) {
  test(`auth plaintext homepage follows ${label} without changing message contracts`, async () => {
    const savedEnv = snapshotEnv();
    const recipient = 'auth+fixture@example.test';
    const sender = 'Mosaic QA <sender@example.test>';
    const messages = [];
    let created = 0;
    let verified = 0;

    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, urlEnv, {
      MAIL_HOST: 'smtp.example.test', MAIL_PORT: '465', MAIL_SECURE: 'true',
      MAIL_USER: 'synthetic-user', MAIL_PASSWORD: 'synthetic-password', MAIL_FROM: sender,
    });

    try {
      // Capture only transport; keep the actual mailer and reviewed URL helper.
      const mailer = loadMailerWithNodemailer({
        createTransport() {
          created += 1;
          return {
            async verify() { verified += 1; },
            async sendMail(message) { messages.push(message); },
          };
        },
      });
      assert.equal(created, 0, 'import must not initialize a mail transport');

      const variants = [
        { context: 'register', role: 'customer', subject: 'Verify Your Mosaic Biz Hub Account', type: 'customer' },
        { context: 'register', role: 'business_owner', subject: 'Activate Your Vendor Account', type: 'vendor' },
        { context: 'login', role: 'customer', subject: 'Your Mosaic Biz Hub Login Code' },
        { context: 'resend', role: 'customer', subject: 'Verify Your Mosaic Biz Hub Account', type: 'customer' },
        { context: 'passwordReset', subject: 'Reset Your Mosaic Biz Hub Password', type: 'reset' },
      ];

      for (const variant of variants) {
        if (variant.context === 'passwordReset') {
          await mailer.sendPasswordResetOtpEmail(recipient, '654321', 'Local QA');
        } else {
          await mailer.sendOtpEmail(recipient, '654321', variant.context, 'Local QA', variant.role);
        }
        const message = messages.at(-1);
        assert.equal(message.to, recipient);
        assert.equal(message.from, sender);
        assert.equal(message.subject, variant.subject);
        assert.ok(message.text.includes('Hi Local QA,'));
        assert.ok(message.text.includes('654321'));
        assert.ok(message.html.includes('654321'));
        assert.ok(message.text.includes('Connecting businesses, customers, and community.'));

        const footer = message.text.split('\n').at(-1);
        assert.ok(footer.startsWith('support@mosaicbizhub.com | '));
        assert.equal(new URL(footer.split(' | ')[1]).href, expectedHome);

        const ctaText = message.text.split('\n').find(line => line.startsWith('Verify Link: '));
        const cta = new URL(ctaText.slice('Verify Link: '.length));
        assert.equal(cta.origin, new URL(expectedHome).origin);
        assert.equal(cta.pathname, variant.type ? '/verify-otp' : '/dashboard');
        if (variant.type) {
          assert.equal(cta.searchParams.get('type'), variant.type);
          assert.equal(cta.searchParams.get('email'), recipient);
        }
        const htmlTargets = [...message.html.matchAll(/href="([^"]+)"/g)]
          .map(([, href]) => href.replaceAll('&amp;', '&'));
        assert.ok(htmlTargets.includes(cta.href));
        for (const legalPath of ['/terms', '/privacy', '/help']) {
          assert.ok(message.html.includes(`href="https://mosaicbizhub.com${legalPath}"`));
        }
      }
      assert.equal(created, 1);
      assert.equal(verified, 1, 'SMTP verification is an in-memory stub');
      assert.equal(messages.length, variants.length, 'only in-memory capture is used');
    } finally {
      restoreEnv(savedEnv);
      delete require.cache[mailerPath];
    }
  });
}
