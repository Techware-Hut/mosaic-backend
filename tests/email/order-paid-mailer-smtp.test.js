const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const mailerPath = path.resolve(__dirname, '../../utils/OrderMail.js');

const ENV_KEYS = [
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_SECURE',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'MAIL_FROM',
  'SUPPORT_EMAIL',
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

function loadOrderMailerWithMocks({ createdConfigs, sentMessages }) {
  const nodemailerMock = {
    createTransport(config) {
      createdConfigs.push(config);
      return {
        sendMail: async (message) => {
          sentMessages.push(message);
        },
      };
    },
  };

  const frontendUrlMock = {
    buildFrontendUrl: (route = '/') => `https://mosaicbizhub.com${route.startsWith('/') ? route : `/${route}`}`,
    getFrontendLogoUrl: () => 'https://mosaicbizhub.com/logo.png',
  };

  const invoiceServiceMock = {
    renderInvoicePdfBufferForOrder: async () => Buffer.from('%PDF-1.4 test invoice'),
  };

  const originalLoad = Module._load;
  const originalGlobalMailer = global.__MAILER__;
  delete global.__MAILER__;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') {
      return nodemailerMock;
    }
    if (request === './frontendUrl') {
      return frontendUrlMock;
    }
    if (request === '../services/invoiceService') {
      return invoiceServiceMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[mailerPath];
  const mailer = require(mailerPath);
  Module._load = originalLoad;
  if (originalGlobalMailer === undefined) {
    delete global.__MAILER__;
  } else {
    global.__MAILER__ = originalGlobalMailer;
  }
  return mailer;
}

test('sendOrderPaidEmails uses provider-neutral SMTP config and MAIL_FROM', async () => {
  const savedEnv = snapshotEnv();
  process.env.MAIL_HOST = 'smtp.resend.com';
  process.env.MAIL_PORT = '465';
  process.env.MAIL_SECURE = 'true';
  process.env.MAIL_USER = 'resend';
  process.env.MAIL_PASSWORD = 'smtp-password';
  process.env.MAIL_FROM = 'Mosaic Biz Hub <hello@mosaicbizhub.com>';
  process.env.SUPPORT_EMAIL = 'support@mosaicbizhub.com';

  const createdConfigs = [];
  const sentMessages = [];
  const mailer = loadOrderMailerWithMocks({ createdConfigs, sentMessages });

  const order = {
    _id: '507f1f77bcf86cd799439020',
    groupOrderId: 'MBH-ORDER-001',
    userId: { name: 'Customer User', email: 'customer@example.com' },
    vendorId: { name: 'Vendor User', email: 'vendor@example.com' },
    businessId: {
      businessName: 'Vendor Shop',
      slug: 'vendor-shop',
      email: 'orders@vendor.example',
      owner: { email: 'owner@vendor.example' },
    },
    items: [
      { productId: { title: 'Test Product' }, quantity: 1, price: 20 },
    ],
    totalAmount: 2000,
    currency: 'USD',
    paymentStatus: 'paid',
  };

  try {
    await mailer.sendOrderPaidEmails({
      order,
      currency: 'usd',
      customerEmails: ['customer@example.com'],
      vendorEmails: ['vendor@example.com', 'orders@vendor.example'],
    });
  } finally {
    restoreEnv(savedEnv);
    delete require.cache[mailerPath];
  }

  assert.deepEqual(createdConfigs[0], {
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    auth: {
      user: 'resend',
      pass: 'smtp-password',
    },
  });
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].from, 'Mosaic Biz Hub <hello@mosaicbizhub.com>');
  assert.equal(sentMessages[1].from, 'Mosaic Biz Hub <hello@mosaicbizhub.com>');
  assert.deepEqual(sentMessages[0].to, ['customer@example.com']);
  assert.deepEqual(sentMessages[1].to, ['vendor@example.com', 'orders@vendor.example']);
});
