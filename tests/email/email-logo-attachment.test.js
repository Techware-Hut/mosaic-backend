const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const helperPath = path.resolve(__dirname, '../../utils/emailLogoAttachment.js');
const mailerPath = path.resolve(__dirname, '../../utils/OrderMail.js');

function loadHelperWithFetch(fetchImpl) {
  const originalFetch = global.fetch;
  global.fetch = fetchImpl;

  delete require.cache[helperPath];
  // Also clear frontendUrl so MAIL_LOGO_URL / env changes are picked up where needed
  const helper = require(helperPath);

  return {
    helper,
    restore() {
      global.fetch = originalFetch;
      delete require.cache[helperPath];
    },
  };
}

test('resolvePlatformLogoAttachment attaches buffer when logo URL is reachable', async () => {
  const { helper, restore } = loadHelperWithFetch(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
  }));

  try {
    const result = await helper.resolvePlatformLogoAttachment({
      FRONTEND_URL: 'https://mosaicbizhub.com',
    });
    assert.equal(result.logoSrcForHtml, 'cid:platformLogo');
    assert.ok(Buffer.isBuffer(result.attachment.content));
    assert.equal(result.attachment.cid, 'platformLogo');
  } finally {
    restore();
  }
});

test('resolvePlatformLogoAttachment soft-fails on 404 without throwing', async () => {
  const { helper, restore } = loadHelperWithFetch(async () => ({
    ok: false,
    status: 404,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));

  try {
    const result = await helper.resolvePlatformLogoAttachment({
      FRONTEND_URL: 'https://mosaicbizhub.com',
    });
    assert.equal(result.attachment, null);
    assert.equal(result.logoSrcForHtml, 'https://mosaicbizhub.com/logo.png');
  } finally {
    restore();
  }
});

test('sendOrderPaidEmails still sends when logo endpoint returns 404', async () => {
  const sentMessages = [];
  const nodemailerMock = {
    createTransport() {
      return {
        sendMail: async (message) => {
          sentMessages.push(message);
        },
      };
    },
  };

  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalGlobalMailer = global.__MAILER__;
  delete global.__MAILER__;

  global.fetch = async () => ({
    ok: false,
    status: 404,
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') return nodemailerMock;
    if (request === './frontendUrl') {
      return {
        buildFrontendUrl: (route = '/') =>
          `https://mosaicbizhub.com${route.startsWith('/') ? route : `/${route}`}`,
        getFrontendLogoUrl: () => 'https://mosaicbizhub.com/logo.png',
      };
    }
    if (request === '../services/invoiceService') {
      return {
        renderInvoicePdfBufferForOrder: async () => Buffer.from('%PDF-1.4 test'),
      };
    }
    if (request === './notificationPreferenceGate') {
      return {
        filterOrderPaidVendorEmails: async (_order, vendorEmails = []) => vendorEmails,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[mailerPath];
  delete require.cache[helperPath];
  const mailer = require(mailerPath);

  try {
    await mailer.sendOrderPaidEmails({
      order: {
        _id: '507f1f77bcf86cd799439020',
        groupOrderId: 'MBH-1',
        userId: { name: 'Casey', email: 'customer@example.com' },
        businessId: { businessName: 'Shop', slug: 'shop' },
        items: [],
      },
      currency: 'usd',
      customerEmails: ['customer@example.com'],
      vendorEmails: [],
    });
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    if (originalGlobalMailer === undefined) delete global.__MAILER__;
    else global.__MAILER__ = originalGlobalMailer;
    delete require.cache[mailerPath];
    delete require.cache[helperPath];
  }

  assert.equal(sentMessages.length, 1);
  assert.ok(!sentMessages[0].attachments.some((part) => part.cid === 'platformLogo'));
  assert.ok(sentMessages[0].attachments.some((part) => part.filename.startsWith('invoice-')));
  assert.match(sentMessages[0].html, /https:\/\/mosaicbizhub\.com\/logo\.png/);
});
