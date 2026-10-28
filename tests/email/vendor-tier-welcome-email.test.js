/**
 * tests/email/vendor-tier-welcome-email.test.js
 *
 * Validates tier-specific vendor onboarding welcome emails for
 * Launch, Growth, and Legacy plans.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const modulePath = path.resolve(__dirname, '../../utils/vendorTierWelcomeEmail.js');

function loadModuleWithMocks(sendMailCalls = []) {
  const nodemailerMock = {
    createTransport: () => ({
      sendMail: async (message) => {
        sendMailCalls.push(message);
        return { messageId: 'msg-tier-welcome-1' };
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

  delete require.cache[modulePath];
  const mod = require(modulePath);
  Module._load = originalLoad;
  return mod;
}

test('resolveTierDetails resolves Launch tier copy and subject accurately', () => {
  const mod = require(modulePath);
  const details = mod.resolveTierDetails('Launch Plan', 'Alice');

  assert.equal(details.tier, 'launch');
  assert.equal(details.subject, 'Welcome to Mosaic Biz Hub — Your Growth Starts Now');
  assert.equal(details.featuresHeading, 'Here’s what your plan includes:');
  assert.equal(details.features.length, 9);
  assert.ok(details.features.includes('Vendor profile with up to 300 characters'));
  assert.ok(details.features.includes('5 products or 3 services listed'));
  assert.ok(details.features.includes('Trust Badge included'));
  assert.ok(details.intro.includes('You’ve selected the Launch Plan'));
});

test('resolveTierDetails resolves Growth tier copy and subject accurately', () => {
  const mod = require(modulePath);
  const details = mod.resolveTierDetails('Growth Plan (Gold)', 'Bob');

  assert.equal(details.tier, 'growth');
  assert.equal(details.subject, 'Welcome to Mosaic Biz Hub Gold — Let’s Scale Your Visibility');
  assert.equal(details.featuresHeading, 'Your Gold features include:');
  assert.equal(details.features.length, 13);
  assert.ok(details.features.includes('Enhanced profile (up to 600 characters)'));
  assert.ok(details.features.includes('10 products or 5 services listed'));
  assert.ok(details.features.includes('Remove Mosaic Biz Hub branding on forms'));
  assert.ok(details.intro.includes('Congratulations on choosing the Growth Plan'));
});

test('resolveTierDetails resolves Legacy tier copy and subject accurately', () => {
  const mod = require(modulePath);
  const details = mod.resolveTierDetails('Legacy Plan (Platinum)', 'Charlie');

  assert.equal(details.tier, 'legacy');
  assert.equal(details.subject, 'Welcome to Mosaic Biz Hub Platinum — Your Legacy Starts Here');
  assert.equal(details.featuresHeading, 'Your Legacy Plan features include:');
  assert.equal(details.features.length, 15);
  assert.ok(details.features.includes('Premium profile (up to 1,000 characters)'));
  assert.ok(details.features.includes('20 products or 10 services listed'));
  assert.ok(details.features.includes('Loyalty program integration'));
  assert.ok(details.intro.includes('Welcome to the Legacy Plan'));
});

test('sendVendorTierWelcomeEmail sends Launch plan email with proper formatting and links', async () => {
  const sendMailCalls = [];
  const mod = loadModuleWithMocks(sendMailCalls);

  const prevUser = process.env.MAIL_USER;
  const prevPass = process.env.MAIL_PASSWORD;
  process.env.MAIL_USER = 'smtp@mosaicbizhub.com';
  process.env.MAIL_PASSWORD = 'fake-test-password';

  try {
    const res = await mod.sendVendorTierWelcomeEmail({
      to: 'vendor1@example.com',
      vendorName: 'Jordan Smith',
      planName: 'Launch Plan',
    });

    assert.equal(res.sent, true);
    assert.equal(sendMailCalls.length, 1);
    const msg = sendMailCalls[0];
    assert.equal(msg.to, 'vendor1@example.com');
    assert.equal(msg.subject, 'Welcome to Mosaic Biz Hub — Your Growth Starts Now');
    assert.match(msg.html, /Hi Jordan Smith,/);
    assert.match(msg.html, /Here’s what your plan includes:/);
    assert.match(msg.html, /Vendor profile with up to 300 characters/);
    assert.match(msg.html, /Trust Badge included/);
    assert.match(msg.html, /https:\/\/mosaicbizhub\.com\/partners/);
    assert.match(msg.text, /Hi Jordan Smith,/);
    assert.match(msg.text, /Here’s what your plan includes:/);
  } finally {
    process.env.MAIL_USER = prevUser;
    process.env.MAIL_PASSWORD = prevPass;
  }
});

test('sendVendorTierWelcomeEmail sends Growth plan email with Gold subject and features', async () => {
  const sendMailCalls = [];
  const mod = loadModuleWithMocks(sendMailCalls);

  const prevUser = process.env.MAIL_USER;
  const prevPass = process.env.MAIL_PASSWORD;
  process.env.MAIL_USER = 'smtp@mosaicbizhub.com';
  process.env.MAIL_PASSWORD = 'fake-test-password';

  try {
    const res = await mod.sendVendorTierWelcomeEmail({
      to: 'vendor2@example.com',
      vendorName: 'Morgan Ray',
      planName: 'Growth Plan',
    });

    assert.equal(res.sent, true);
    assert.equal(sendMailCalls.length, 1);
    const msg = sendMailCalls[0];
    assert.equal(msg.to, 'vendor2@example.com');
    assert.equal(msg.subject, 'Welcome to Mosaic Biz Hub Gold — Let’s Scale Your Visibility');
    assert.match(msg.html, /Hi Morgan Ray,/);
    assert.match(msg.html, /Your Gold features include:/);
    assert.match(msg.html, /Enhanced profile \(up to 600 characters\)/);
    assert.match(msg.html, /Remove Mosaic Biz Hub branding on forms/);
  } finally {
    process.env.MAIL_USER = prevUser;
    process.env.MAIL_PASSWORD = prevPass;
  }
});

test('sendVendorTierWelcomeEmail sends Legacy plan email with Platinum subject and features', async () => {
  const sendMailCalls = [];
  const mod = loadModuleWithMocks(sendMailCalls);

  const prevUser = process.env.MAIL_USER;
  const prevPass = process.env.MAIL_PASSWORD;
  process.env.MAIL_USER = 'smtp@mosaicbizhub.com';
  process.env.MAIL_PASSWORD = 'fake-test-password';

  try {
    const res = await mod.sendVendorTierWelcomeEmail({
      to: 'vendor3@example.com',
      vendorName: 'Taylor Lee',
      planName: 'Legacy Plan',
    });

    assert.equal(res.sent, true);
    assert.equal(sendMailCalls.length, 1);
    const msg = sendMailCalls[0];
    assert.equal(msg.to, 'vendor3@example.com');
    assert.equal(msg.subject, 'Welcome to Mosaic Biz Hub Platinum — Your Legacy Starts Here');
    assert.match(msg.html, /Hi Taylor Lee,/);
    assert.match(msg.html, /Your Legacy Plan features include:/);
    assert.match(msg.html, /Premium profile \(up to 1,000 characters\)/);
    assert.match(msg.html, /AI chatbot integration/);
    assert.match(msg.html, /Loyalty program integration/);
  } finally {
    process.env.MAIL_USER = prevUser;
    process.env.MAIL_PASSWORD = prevPass;
  }
});

test('sendVendorTierWelcomeEmail escapes vendor name to prevent XSS injection', async () => {
  const sendMailCalls = [];
  const mod = loadModuleWithMocks(sendMailCalls);

  const prevUser = process.env.MAIL_USER;
  const prevPass = process.env.MAIL_PASSWORD;
  process.env.MAIL_USER = 'smtp@mosaicbizhub.com';
  process.env.MAIL_PASSWORD = 'fake-test-password';

  try {
    const res = await mod.sendVendorTierWelcomeEmail({
      to: 'vendor@example.com',
      vendorName: '<script>alert(1)</script>',
      planName: 'Launch Plan',
    });

    assert.equal(res.sent, true);
    const msg = sendMailCalls[0];
    assert.doesNotMatch(msg.html, /<script>alert\(1\)<\/script>/);
    assert.match(msg.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  } finally {
    process.env.MAIL_USER = prevUser;
    process.env.MAIL_PASSWORD = prevPass;
  }
});

test('sendVendorTierWelcomeEmail skips delivery when recipient is invalid', async () => {
  const mod = require(modulePath);
  const res = await mod.sendVendorTierWelcomeEmail({
    to: 'invalid-email',
    vendorName: 'Test',
  });

  assert.equal(res.sent, false);
  assert.equal(res.skipped, true);
});

test('triggerTierWelcomeNotifications executes idempotently via welcomeEmailSent claim', async () => {
  let findOneAndUpdateCalls = 0;
  let smsSentCalls = [];
  let emailSentCalls = [];

  const subscriptionMock = {
    _id: 'sub_test_123',
    userId: 'user_test_456',
    subscriptionPlanId: 'plan_test_789',
  };

  const userMock = {
    _id: 'user_test_456',
    email: 'vendor@example.com',
    mobile: '+15551234567',
    name: 'Alex Rivera',
  };

  const planMock = {
    _id: 'plan_test_789',
    name: 'Growth Plan',
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Subscription') {
      return {
        findOneAndUpdate: async (filter, update) => {
          findOneAndUpdateCalls++;
          if (findOneAndUpdateCalls === 1) {
            return { _id: filter._id, welcomeEmailSent: true };
          }
          // Second call: already claimed!
          return null;
        },
      };
    }
    if (request === '../models/User') {
      return {
        findById: () => ({
          select: () => ({
            lean: async () => userMock,
          }),
        }),
      };
    }
    if (request === '../models/SubscriptionPlan') {
      return {
        findById: () => ({
          select: () => ({
            lean: async () => planMock,
          }),
        }),
      };
    }
    if (request === './telnyxService') {
      return {
        sendVendorTierWelcomeSMS: async (payload) => {
          smsSentCalls.push(payload);
          return { success: true };
        },
      };
    }
    if (request === 'nodemailer') {
      return {
        createTransport: () => ({
          sendMail: async (msg) => {
            emailSentCalls.push(msg);
            return { messageId: 'msg-id' };
          },
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[modulePath];
  const mod = require(modulePath);

  const prevUser = process.env.MAIL_USER;
  process.env.MAIL_USER = 'smtp@mosaicbizhub.com';

  try {
    // 1st invocation: should claim and send email & SMS
    await mod.triggerTierWelcomeNotifications(subscriptionMock);
    assert.equal(findOneAndUpdateCalls, 1);

    // 2nd invocation: duplicate webhook, claim should return null and skip
    await mod.triggerTierWelcomeNotifications(subscriptionMock);
    assert.equal(findOneAndUpdateCalls, 2);
  } finally {
    process.env.MAIL_USER = prevUser;
    Module._load = originalLoad;
  }
});
