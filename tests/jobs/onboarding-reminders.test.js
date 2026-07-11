const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const jobPath = path.resolve(__dirname, '../../jobs/onboardingReminders.js');
const mailerPath = path.resolve(__dirname, '../../utils/WellcomeMailer.js');
const emailDeliveryPath = path.resolve(__dirname, '../../utils/vendorOnboardingEmailDelivery.js');

function buildApplication(overrides = {}) {
  const reminderLog = overrides.onboardingReminderLog || [];
  return {
    applicationId: 'MBH-APP-REMINDER-001',
    businessName: 'Reminder Test LLC',
    status: 'payment_pending',
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    verificationPayment: { status: 'pending' },
    userId: {
      _id: '507f1f77bcf86cd799439011',
      name: 'Vendor User',
      email: 'vendor@example.com',
    },
    onboardingReminderLog: reminderLog,
    save: async function save() {
      return this;
    },
    ...overrides,
  };
}

function loadJob({ applications = [], mailerCalls = [], emailConfigured = true } = {}) {
  process.env.MAIL_USER = emailConfigured ? 'mail@example.com' : '';
  process.env.MAIL_PASSWORD = emailConfigured ? 'app-password' : '';
  process.env.ENABLE_ONBOARDING_REMINDERS = 'true';
  process.env.ONBOARDING_REMINDER_MIN_AGE_HOURS = '1';
  process.env.ONBOARDING_REMINDER_COOLDOWN_HOURS = '72';
  process.env.ONBOARDING_REMINDER_BATCH_LIMIT = '10';

  const vendorOnboardingMock = {
    find: (query) => ({
      populate: () => ({
        limit: () => ({
          exec: async () => {
            if (query.status === 'payment_pending') {
              return applications.filter((app) => app.status === 'payment_pending');
            }
            if (query.status === 'draft') {
              return applications.filter((app) => app.status === 'draft');
            }
            return [];
          },
        }),
      }),
    }),
  };

  const mailerMock = {
    sendPaymentReminderEmail: async (payload) => {
      mailerCalls.push(payload);
      return { messageId: `reminder-${mailerCalls.length}` };
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).includes('models/VendorOnboardingStage1')) {
      return vendorOnboardingMock;
    }
    if (String(request).includes('utils/WellcomeMailer')) {
      return mailerMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[jobPath];
  delete require.cache[emailDeliveryPath];
  const job = require(jobPath);
  Module._load = originalLoad;

  return { job, mailerCalls };
}

test('runOnboardingReminderBatch sends payment_pending reminder for stalled application', async () => {
  const application = buildApplication();
  const { job, mailerCalls } = loadJob({ applications: [application] });

  const result = await job.runOnboardingReminderBatch();

  assert.equal(result.enabled, true);
  assert.equal(result.processed, 1);
  assert.equal(mailerCalls.length, 1);
  assert.equal(mailerCalls[0].reminderKind, 'payment_pending');
  assert.equal(application.onboardingReminderLog.length, 1);
  assert.equal(application.onboardingReminderLog[0].kind, 'payment_pending');
  assert.equal(application.onboardingReminderLog[0].deliveryStatus, 'sent');
});

test('runOnboardingReminderBatch sends paid draft reminder', async () => {
  const application = buildApplication({
    status: 'draft',
    verificationPayment: { status: 'paid' },
    submittedAt: undefined,
  });
  const { job, mailerCalls } = loadJob({ applications: [application] });

  const result = await job.runOnboardingReminderBatch();

  assert.equal(result.processed, 1);
  assert.equal(mailerCalls[0].reminderKind, 'paid_draft_unsubmitted');
  assert.equal(application.onboardingReminderLog[0].kind, 'paid_draft_unsubmitted');
});

test('wasRecentlyReminded suppresses duplicate sent reminders inside cooldown', async () => {
  const application = buildApplication({
    onboardingReminderLog: [{
      kind: 'payment_pending',
      sentAt: new Date(),
      deliveryStatus: 'sent',
    }],
  });
  const { job, mailerCalls } = loadJob({ applications: [application] });

  const result = await job.runOnboardingReminderBatch();

  assert.equal(result.processed, 0);
  assert.equal(mailerCalls.length, 0);
});

test('sendPaymentReminderEmail renders onboarding alert CTA', async () => {
  const originalMailUser = process.env.MAIL_USER;
  process.env.MAIL_USER = 'mail@example.com';

  const sendMailCalls = [];
  const nodemailerMock = {
    createTransport: () => ({
      sendMail: async (message) => {
        sendMailCalls.push(message);
        return { messageId: 'message-1' };
      },
    }),
  };

  const frontendUrlMock = {
    buildFrontendUrl: (route = '/') => `https://mosaicbizhub.com${route.startsWith('/') ? route : `/${route}`}`,
    getFrontendLogoUrl: () => 'https://mosaicbizhub.com/logo.png',
  };

  const smtpTransportMock = {
    buildSmtpTransportConfig: () => ({}),
    formatMosaicFromHeader: () => 'Mosaic Biz Hub <mail@example.com>',
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') return nodemailerMock;
    if (request === './frontendUrl') return frontendUrlMock;
    if (request === './smtpTransport') return smtpTransportMock;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[mailerPath];
  const mailer = require(mailerPath);
  Module._load = originalLoad;

  await mailer.sendPaymentReminderEmail({
    to: 'vendor@example.com',
    vendorName: 'Vendor User',
    businessName: 'Reminder LLC',
    applicationId: 'MBH-APP-REMINDER-EMAIL',
    reminderKind: 'payment_pending',
  });

  process.env.MAIL_USER = originalMailUser;

  assert.equal(sendMailCalls.length, 1);
  assert.equal(sendMailCalls[0].subject, 'Action Required: Complete Your Vendor Onboarding');
  assert.ok(sendMailCalls[0].html.includes('Onboarding Alert'));
  assert.ok(sendMailCalls[0].html.includes('Complete Your Payment &amp; Onboarding Setup'));
  assert.ok(sendMailCalls[0].html.includes('MBH-APP-REMINDER-EMAIL'));
});
