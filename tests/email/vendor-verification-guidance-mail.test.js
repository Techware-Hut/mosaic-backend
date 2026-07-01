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
      },
    }),
  };

  const frontendUrlMock = {
    buildFrontendUrl: (route = '/') => `https://mosaicbizhub.com${route.startsWith('/') ? route : `/${route}`}`,
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

test('vendor verification guidance email escapes vendor-visible admin notes', async () => {
  const originalMailUser = process.env.MAIL_USER;
  const originalSupportEmail = process.env.SUPPORT_EMAIL;
  process.env.MAIL_USER = 'mail@example.com';
  process.env.SUPPORT_EMAIL = 'support@example.com';

  const sendMailCalls = [];
  const mailer = loadMailerWithMocks(sendMailCalls);

  await mailer.sendVendorVerificationGuidanceEmail({
    to: 'vendor@example.com',
    vendorName: 'Vendor <User>',
    businessName: 'Test & Co',
    applicationId: 'MBH-APP-EMAIL-001',
    currentStatus: 'submitted',
    outcome: 'failed_validation',
    reason: '<script>alert("x")</script>',
    documentsNeeded: ['Tax <document>'],
    fieldsNeeded: ['businessName'],
    responseWindowDays: 5,
  });

  process.env.MAIL_USER = originalMailUser;
  process.env.SUPPORT_EMAIL = originalSupportEmail;

  assert.equal(sendMailCalls.length, 1);
  const message = sendMailCalls[0];
  assert.equal(message.subject, 'Action Required: Vendor Verification Correction Needed');
  assert.ok(message.html.includes('Current status:</strong> submitted'));
  assert.ok(message.html.includes('Test &amp; Co'));
  assert.ok(message.html.includes('Vendor &lt;User&gt;'));
  assert.ok(message.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(!message.html.includes('<script>alert'));
  assert.ok(message.html.includes('Tax &lt;document&gt;'));
  assert.ok(message.html.includes('businessName'));
  assert.ok(message.html.includes('Please respond within 5 business days.'));
  assert.ok(message.html.includes('support@example.com'));
  assert.ok(message.html.includes('https://mosaicbizhub.com/partners/business/new'));
});

test('vendor rejection email uses missing-document guidance copy', async () => {
  const originalMailUser = process.env.MAIL_USER;
  process.env.MAIL_USER = 'mail@example.com';

  const sendMailCalls = [];
  const mailer = loadMailerWithMocks(sendMailCalls);

  await mailer.sendVendorRejectionEmail({
    to: 'vendor@example.com',
    vendorName: 'Vendor User',
    businessName: 'Missing Docs LLC',
    applicationId: 'MBH-APP-MISSING-001',
    rejectionReason: 'EIN document',
    documentsNeeded: ['EIN document'],
  });

  process.env.MAIL_USER = originalMailUser;

  assert.equal(sendMailCalls.length, 1);
  const message = sendMailCalls[0];
  assert.equal(message.subject, 'Action Required: Vendor Application Documents Needed');
  assert.ok(message.html.includes('Missing Docs LLC'));
  assert.ok(message.html.includes('Current status:</strong> rejected'));
  assert.ok(message.html.includes('EIN document'));
  assert.ok(message.html.includes('Open Vendor Dashboard'));
});
