const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const mailerPath = path.resolve(__dirname, '../../utils/WellcomeMailer.js');

function loadMailerWithMocks(sendMailCalls) {
  const nodemailerMock = {
    createTransport: () => ({
      sendMail: async (message) => {
        sendMailCalls.push(message);
        return { messageId: 'message-1' };
      },
    }),
  };

  const frontendUrlMock = {
    buildFrontendUrl: (route = '/') =>
      `https://mosaicbizhub.com${route.startsWith('/') ? route : `/${route}`}`,
    getFrontendLogoUrl: () => 'https://mosaicbizhub.com/logo.png',
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') {
      return nodemailerMock;
    }
    if (request === './frontendUrl') {
      return frontendUrlMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[mailerPath];
  const mailer = require(mailerPath);
  Module._load = originalLoad;
  return mailer;
}

test('sendVendorStorefrontPublishedEmail uses congratulations copy and dashboard link', async () => {
  process.env.MAIL_USER = 'mail@example.com';

  const sendMailCalls = [];
  const mailer = loadMailerWithMocks(sendMailCalls);

  await mailer.sendVendorStorefrontPublishedEmail({
    to: 'vendor@example.com',
    vendorName: 'Abhay',
    businessName: 'Abhay Salon',
    listingType: 'service',
    businessSlug: 'abhay-9',
  });

  assert.equal(sendMailCalls.length, 1);
  const message = sendMailCalls[0];
  assert.equal(message.to, 'vendor@example.com');
  assert.match(message.subject, /Congratulations/i);
  assert.match(message.subject, /Storefront Is Live/i);
  assert.match(message.html, /Congratulations, Abhay!/);
  assert.match(message.html, /Abhay Salon/);
  assert.match(message.html, /service storefront and listings are now live/i);
  assert.match(message.html, /https:\/\/mosaicbizhub\.com\/partners\/abhay-9/);
  assert.match(message.html, /Go to Dashboard/);
});

test('sendVendorStorefrontPublishedEmail escapes html in vendor-visible fields', async () => {
  process.env.MAIL_USER = 'mail@example.com';

  const sendMailCalls = [];
  const mailer = loadMailerWithMocks(sendMailCalls);

  await mailer.sendVendorStorefrontPublishedEmail({
    to: 'vendor@example.com',
    vendorName: 'Vendor <script>',
    businessName: 'Biz & Co',
    listingType: 'product',
    businessSlug: 'biz-co',
  });

  const message = sendMailCalls[0];
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /Vendor &lt;script&gt;/);
  assert.match(message.html, /Biz &amp; Co/);
  assert.match(message.html, /product storefront and listings are now live/i);
});
