const cron = require('node-cron');
const VendorOnboarding = require('../models/VendorOnboardingStage1');
const { sendPaymentReminderEmail } = require('../utils/WellcomeMailer');
const { deliverVendorOnboardingEmail } = require('../utils/vendorOnboardingEmailDelivery');

const REMINDER_KINDS = Object.freeze({
  PAYMENT_PENDING: 'payment_pending',
  PAID_DRAFT_UNSUBMITTED: 'paid_draft_unsubmitted',
});

function getOnboardingReminderConfig() {
  const minAgeHours = Number(process.env.ONBOARDING_REMINDER_MIN_AGE_HOURS);
  const cooldownHours = Number(process.env.ONBOARDING_REMINDER_COOLDOWN_HOURS);
  const batchLimit = Number(process.env.ONBOARDING_REMINDER_BATCH_LIMIT);

  return {
    enabled: process.env.ENABLE_ONBOARDING_REMINDERS !== 'false',
    cronExpression: process.env.ONBOARDING_REMINDER_CRON || '0 9 * * *',
    minAgeHours: Number.isFinite(minAgeHours) && minAgeHours > 0 ? minAgeHours : 24,
    cooldownHours: Number.isFinite(cooldownHours) && cooldownHours > 0 ? cooldownHours : 72,
    batchLimit: Number.isFinite(batchLimit) && batchLimit > 0 ? Math.floor(batchLimit) : 50,
  };
}

function getStallCutoff(minAgeHours) {
  return new Date(Date.now() - minAgeHours * 60 * 60 * 1000);
}

function wasRecentlyReminded(application, kind, cooldownHours) {
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
  const log = Array.isArray(application.onboardingReminderLog)
    ? application.onboardingReminderLog
    : [];

  return log.some(
    (entry) =>
      entry?.kind === kind
      && entry?.deliveryStatus === 'sent'
      && entry?.sentAt
      && new Date(entry.sentAt) >= cutoff
  );
}

async function appendReminderLog(application, { kind, delivery }) {
  if (!Array.isArray(application.onboardingReminderLog)) {
    application.onboardingReminderLog = [];
  }

  application.onboardingReminderLog.push({
    kind,
    sentAt: new Date(),
    deliveryStatus: delivery.sent ? 'sent' : delivery.skipped ? 'skipped' : 'failed',
    messageId: delivery.messageId,
    error: delivery.error || delivery.reason,
  });

  await application.save();
}

async function dispatchReminder(application, kind) {
  const vendorEmail = application.userId?.email;

  if (!vendorEmail) {
    console.warn(
      `Onboarding reminder skipped (${kind}): missing vendor email for application ${application.applicationId}`
    );
    return {
      sent: false,
      skipped: false,
      error: 'vendor_email_missing',
    };
  }

  const delivery = await deliverVendorOnboardingEmail({
    label: `onboarding_reminder_${kind}`,
    send: () => sendPaymentReminderEmail({
      to: vendorEmail,
      vendorName: application.userId?.name,
      businessName: application.businessName,
      applicationId: application.applicationId,
      reminderKind: kind,
    }),
  });

  await appendReminderLog(application, { kind, delivery });
  return delivery;
}

async function runOnboardingReminderBatch() {
  const config = getOnboardingReminderConfig();

  if (!config.enabled) {
    return { enabled: false, processed: 0, results: [] };
  }

  const stallCutoff = getStallCutoff(config.minAgeHours);
  const results = [];
  let processed = 0;

  const paymentPendingCandidates = await VendorOnboarding.find({
    status: 'payment_pending',
    updatedAt: { $lte: stallCutoff },
    'verificationPayment.status': { $in: ['pending', 'failed', 'not_started'] },
  })
    .populate('userId', 'name email')
    .limit(config.batchLimit)
    .exec();

  for (const application of paymentPendingCandidates) {
    if (wasRecentlyReminded(application, REMINDER_KINDS.PAYMENT_PENDING, config.cooldownHours)) {
      continue;
    }

    const delivery = await dispatchReminder(application, REMINDER_KINDS.PAYMENT_PENDING);
    results.push({
      applicationId: application.applicationId,
      kind: REMINDER_KINDS.PAYMENT_PENDING,
      ...delivery,
    });
    processed += 1;
  }

  const remainingBatch = Math.max(config.batchLimit - processed, 0);
  if (remainingBatch > 0) {
    const paidDraftCandidates = await VendorOnboarding.find({
      status: 'draft',
      updatedAt: { $lte: stallCutoff },
      'verificationPayment.status': 'paid',
      $or: [{ submittedAt: { $exists: false } }, { submittedAt: null }],
    })
      .populate('userId', 'name email')
      .limit(remainingBatch)
      .exec();

    for (const application of paidDraftCandidates) {
      if (wasRecentlyReminded(application, REMINDER_KINDS.PAID_DRAFT_UNSUBMITTED, config.cooldownHours)) {
        continue;
      }

      const delivery = await dispatchReminder(
        application,
        REMINDER_KINDS.PAID_DRAFT_UNSUBMITTED
      );
      results.push({
        applicationId: application.applicationId,
        kind: REMINDER_KINDS.PAID_DRAFT_UNSUBMITTED,
        ...delivery,
      });
      processed += 1;
    }
  }

  console.log(`Onboarding reminder batch complete: processed=${processed}`);
  return { enabled: true, processed, results };
}

function startOnboardingReminderScheduler() {
  const config = getOnboardingReminderConfig();

  if (!config.enabled) {
    console.log('Onboarding reminder scheduler disabled (ENABLE_ONBOARDING_REMINDERS=false)');
    return null;
  }

  if (!cron.validate(config.cronExpression)) {
    console.error(`Invalid ONBOARDING_REMINDER_CRON expression: ${config.cronExpression}`);
    return null;
  }

  const task = cron.schedule(config.cronExpression, async () => {
    try {
      await runOnboardingReminderBatch();
    } catch (error) {
      const message = error && error.message ? error.message : 'Unknown onboarding reminder error';
      console.error('Onboarding reminder batch failed:', message);
    }
  });

  console.log(`Onboarding reminder scheduler started (cron: ${config.cronExpression})`);
  return task;
}

module.exports = {
  REMINDER_KINDS,
  getOnboardingReminderConfig,
  runOnboardingReminderBatch,
  startOnboardingReminderScheduler,
  wasRecentlyReminded,
};
