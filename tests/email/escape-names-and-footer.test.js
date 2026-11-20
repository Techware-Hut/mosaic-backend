const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const INJECT = '<a href="https://phish.example">Click</a><b>Bob</b>';

function loadWithCapture(rel) {
  const modPath = path.resolve(__dirname, '../..', rel);
  const sent = [];
  const originalLoad = Module._load;
  Module._load = function mockLoad(req, parent, isMain) {
    if (req === 'nodemailer') {
      return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } }) };
    }
    if (req === './emailLogoAttachment') {
      return {
        resolvePlatformLogoAttachment: async () => ({ attachment: null, logoSrcForHtml: 'https://example.test/logo.png' }),
        withOptionalLogoAttachment: (o) => o,
      };
    }
    return originalLoad.call(this, req, parent, isMain);
  };
  delete require.cache[modPath];
  try {
    return { mod: require(modPath), sent };
  } finally {
    Module._load = originalLoad;
  }
}

function assertEscaped(html) {
  assert.doesNotMatch(html, /<a href="https:\/\/phish\.example">|<b>Bob<\/b>/);
  assert.match(html, /&lt;a href=&quot;https:\/\/phish\.example&quot;&gt;/);
}

test('business profile review + question emails escape the user name', async () => {
  const { mod, sent } = loadWithCapture('utils/BuisnessprofileMail.js');
  await mod.sendBusinessProfileReviewEmail('vendor@example.test', INJECT, 'profile<1>');
  await mod.sendQuestionVerificationEmail('vendor@example.test', INJECT, 3, 10);
  assert.equal(sent.length, 2);
  assertEscaped(sent[0].html);
  assert.match(sent[0].html, /profile&lt;1&gt;/);
  assertEscaped(sent[1].html);
  assert.match(sent[1].html, /Question Number:<\/strong> 3/);
});

test('vendor welcome email escapes the vendor name', async () => {
  const { mod, sent } = loadWithCapture('utils/WellcomeMailer.js');
  await mod.sendWelcomeEmail('vendor@example.test', INJECT);
  assert.equal(sent.length, 1);
  assertEscaped(sent[0].html);
});

test('email footer "Help & Support" links to /contact, not the missing /help page', () => {
  const { baseLayout } = require('../../utils/emailTemplates/baseLayout');
  const html = baseLayout({ preheader: 'p', bodyHtml: '<p>b</p>', footerReason: 'r' });
  assert.match(html, /href="https:\/\/mosaicbizhub\.com\/contact"[^>]*>Help &amp; Support</);
  assert.doesNotMatch(html, /mosaicbizhub\.com\/help"/);
});
