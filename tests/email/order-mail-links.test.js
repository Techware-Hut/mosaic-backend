const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '../..');
const orderMailPath = path.join(root, 'utils/OrderMail.js');
const invoiceServicePath = path.join(root, 'services/invoiceService.js');

const ENV_KEYS = [
  'APP_URL',
  'CANONICAL_FRONTEND_URL',
  'FRONTEND_URL',
  'MAIL_USER',
  'NEXT_PUBLIC_APP_URL',
  'NODE_ENV',
  'PUBLIC_FRONTEND_URL',
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

function loadOrderMail(sentMessages) {
  const originalLoad = Module._load;

  global.__MAILER__ = {
    sendMail: async (message) => {
      sentMessages.push(message);
      return { messageId: `test-${sentMessages.length}` };
    },
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('services/invoiceService')) {
      return {
        renderInvoicePdfBufferForOrder: async () => Buffer.from('invoice-pdf'),
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[orderMailPath];
  delete require.cache[invoiceServicePath];
  const orderMail = require(orderMailPath);
  Module._load = originalLoad;
  return orderMail;
}

function cleanupOrderMail() {
  delete global.__MAILER__;
  delete require.cache[orderMailPath];
  delete require.cache[invoiceServicePath];
}

function buildPaidOrder(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439020',
    groupOrderId: 'MBH-ORDER-001',
    userId: { name: 'Customer User', email: 'customer@example.com' },
    businessId: {
      businessName: 'The Digital Builders',
      slug: 'the-digital-builders',
      email: 'vendor@example.com',
      owner: { email: 'owner@example.com' },
    },
    items: [{ quantity: 1 }],
    ...overrides,
  };
}

test.afterEach(() => {
  cleanupOrderMail();
});

test('order paid emails link customers and vendors to live frontend order routes', async () => {
  const savedEnv = snapshotEnv();
  process.env.NODE_ENV = 'production';
  process.env.CANONICAL_FRONTEND_URL = 'https://mosaicbizhub.com';
  process.env.MAIL_USER = 'mail@example.com';

  const sentMessages = [];
  const { sendOrderPaidEmails } = loadOrderMail(sentMessages);

  try {
    await sendOrderPaidEmails({
      order: buildPaidOrder(),
      currency: 'usd',
      customerEmails: ['customer@example.com'],
      vendorEmails: ['vendor@example.com'],
    });
  } finally {
    restoreEnv(savedEnv);
  }

  assert.equal(sentMessages.length, 2);

  const customerMessage = sentMessages.find((message) => message.to.includes('customer@example.com'));
  const vendorMessage = sentMessages.find((message) => message.to.includes('vendor@example.com'));

  assert.ok(customerMessage.html.includes('https://mosaicbizhub.com/customer/order'));
  assert.ok(customerMessage.text.includes('https://mosaicbizhub.com/customer/order'));
  assert.ok(!customerMessage.html.includes('/customer/orders'));
  assert.ok(!customerMessage.text.includes('/orders/507f1f77bcf86cd799439020'));

  assert.ok(vendorMessage.html.includes('https://mosaicbizhub.com/partners/the-digital-builders/orders'));
  assert.ok(vendorMessage.text.includes('https://mosaicbizhub.com/partners/the-digital-builders/orders'));
  assert.ok(!vendorMessage.text.includes('/orders/507f1f77bcf86cd799439020'));
});

test('vendor order email falls back to partners dashboard when business slug is missing', async () => {
  const savedEnv = snapshotEnv();
  process.env.NODE_ENV = 'production';
  process.env.CANONICAL_FRONTEND_URL = 'https://mosaicbizhub.com';
  process.env.MAIL_USER = 'mail@example.com';

  const sentMessages = [];
  const { sendOrderPaidEmails } = loadOrderMail(sentMessages);

  try {
    await sendOrderPaidEmails({
      order: buildPaidOrder({ businessId: { businessName: 'Vendor' } }),
      currency: 'usd',
      customerEmails: [],
      vendorEmails: ['vendor@example.com'],
    });
  } finally {
    restoreEnv(savedEnv);
  }

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].html.includes('https://mosaicbizhub.com/partners/dashboard'));
  assert.ok(sentMessages[0].text.includes('https://mosaicbizhub.com/partners/dashboard'));
});

for (const frontend of ['https://app.mosaicbizhub.com', 'https://mosaic-biz-frontend-launch.vercel.app', undefined]) {
  test('STG004 real-helper order emails keep application CTAs in staging for ' + frontend, async () => {
    const keys = [...ENV_KEYS, 'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const sentMessages = [];
    const expected = frontend || 'https://mosaic-biz-frontend-launch.vercel.app';
    try {
      keys.forEach(key => delete process.env[key]);
      process.env.NODE_ENV = 'production'; process.env.RELEASE_ENVIRONMENT = 'staging'; process.env.MAIL_USER = 'synthetic-sender@example.test';
      if (frontend) process.env.FRONTEND_URL = frontend;
      const { sendOrderPaidEmails } = loadOrderMail(sentMessages);
      await sendOrderPaidEmails({ order: buildPaidOrder(), currency: 'usd', customerEmails: ['customer@example.test'], vendorEmails: ['vendor@example.test'] });
      assert.equal(sentMessages.length, 2);
      const paths = ['/customer/order', '/partners/the-digital-builders/orders'];
      for (let index = 0; index < paths.length; index++) {
        const hrefs = [...sentMessages[index].html.matchAll(/href=["']([^"']+)["']/gi)]
          .map(match => match[1].replace(/&amp;/g, '&'));
        const textUrls = sentMessages[index].text.match(/https?:\/\/[^\s<>]+/g) || [];
        for (const urls of [hrefs, textUrls]) {
          const actualCtas = urls.map(value => new URL(value))
            .filter(url => url.pathname === paths[index]);
          assert.ok(actualCtas.length > 0, 'captured mail must contain the actual CTA');
          for (const actual of actualCtas) {
            assert.equal(actual.origin, expected);
            assert.equal(actual.pathname, paths[index]);
            assert.equal(actual.username, '');
            assert.equal(actual.password, '');
          }
        }
      }
      // Separate static email footer links are outside this helper's CTA contract.
    } finally {
      keys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
      cleanupOrderMail();
    }
  });
}

test('STG004 module-level orderPhase URL construction is safe with missing known-staging configuration', () => {
  const phasePath = path.join(root, 'utils/orderPhase.js');
  const keys = [...ENV_KEYS, 'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const cached = require.cache[phasePath];
  const originalLoad = Module._load;
  let transportCreations = 0;
  try {
    keys.forEach(key => delete process.env[key]);
    process.env.NODE_ENV = 'production'; process.env.RELEASE_ENVIRONMENT = 'staging';
    Module._load = function (request, parent, isMain) {
      if (request === 'nodemailer') return { createTransport: () => { transportCreations++; return { sendMail: () => { throw new Error('No mail operation expected during import'); } }; } };
      return originalLoad(request, parent, isMain);
    };
    delete require.cache[phasePath];
    assert.doesNotThrow(() => require(phasePath));
    assert.equal(transportCreations, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[phasePath];
    if (cached) require.cache[phasePath] = cached;
    keys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  }
});
