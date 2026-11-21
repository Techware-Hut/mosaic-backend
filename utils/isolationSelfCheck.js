'use strict';

// Hosted-staging isolation self-check. Returns booleans/enums plus the
// database name only — never keys, URIs, bucket names, recipients or secrets.
// The full object is exposed publicly only on staging /api/ready; production
// sees it solely in the startup log.

const { isRecaptchaEnforced, getAllowedHostnames } = require('./recaptcha');
const { isStagingEnv } = require('./frontendUrl');
const { getReleaseEnvironment } = require('./releaseIdentity');
const { getMailAllowlist, getSmsAllowlist } = require('./recipientAllowlist');

const WEBHOOK_SECRET_ENVS = Object.freeze({
  order: 'STRIPE_ORDER_WEBHOOK_SECRET',
  subscription: 'STRIPE_SUBSCRIPTION_WEBHOOK_SECRET',
  businessDraft: 'STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET',
  orderPostPayment: 'STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET',
  vendorVerification: 'STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET',
});

const DEFAULT_AWS_REGION = 'us-east-1';

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isSet(env, name) {
  return trimmed(env[name]) !== '';
}

function deriveStripeMode(key) {
  const value = trimmed(key);
  if (!value) return 'unset';
  if (/^(sk|rk)_live_/.test(value)) return 'live';
  if (/^(sk|rk)_test_/.test(value)) return 'test';
  return 'unknown';
}

function getJobFlags() {
  // Lazy: the job modules pull in models; reuse their own enabled parsing.
  const { getOnboardingReminderConfig } = require('../jobs/onboardingReminders');
  const { getInventoryReservationExpiryConfig } = require('../jobs/inventoryReservationExpiry');
  return {
    onboardingReminders: getOnboardingReminderConfig().enabled === true,
    inventoryReservationExpiry: getInventoryReservationExpiryConfig().enabled === true,
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.env] - defaults to process.env
 * @param {{ name?: string }} [options.connection] - defaults to mongoose.connection
 * @param {() => { onboardingReminders: boolean, inventoryReservationExpiry: boolean }} [options.getJobs]
 */
function getIsolationSelfCheck(options = {}) {
  const env = options.env || process.env;
  const connection = options.connection || require('mongoose').connection;
  const jobs = (options.getJobs || getJobFlags)();
  const mailAllowlist = getMailAllowlist(env);
  const smsAllowlist = getSmsAllowlist(env);

  const webhookSigningConfigured = {};
  for (const [key, name] of Object.entries(WEBHOOK_SECRET_ENVS)) {
    webhookSigningConfigured[key] = isSet(env, name);
  }

  return {
    stagingMarker: isStagingEnv(env),
    environment: getReleaseEnvironment(),
    database: {
      name: (connection && typeof connection.name === 'string' && connection.name) || null,
    },
    stripe: {
      mode: deriveStripeMode(env.STRIPE_SECRET_KEY),
      webhookSigningConfigured,
    },
    jobs: {
      onboardingReminders: Boolean(jobs.onboardingReminders),
      inventoryReservationExpiry: Boolean(jobs.inventoryReservationExpiry),
    },
    mail: {
      configured: isSet(env, 'MAIL_USER') && isSet(env, 'MAIL_PASSWORD'),
      recipientAllowlistEnabled: mailAllowlist.active,
      recipientPolicy: mailAllowlist.policy,
      allowlistSize: mailAllowlist.size,
    },
    sms: {
      configured: isSet(env, 'TELNYX_API_KEY'),
      recipientAllowlistEnabled: smsAllowlist.active,
      recipientPolicy: smsAllowlist.policy,
      allowlistSize: smsAllowlist.size,
    },
    storage: {
      bucketConfigured: isSet(env, 'AWS_S3_BUCKET'),
      region: trimmed(env.AWS_REGION) || DEFAULT_AWS_REGION,
    },
    contactVerification: isRecaptchaEnforced(env) ? 'enforced' : 'not_configured',
    allowedHostnameCount: getAllowedHostnames(env).length,
    adminEmailExplicit: isSet(env, 'ADMIN_EMAIL'),
  };
}

function logIsolationSelfCheckAtStartup() {
  try {
    console.log(`[isolation] ${JSON.stringify(getIsolationSelfCheck())}`);
  } catch (err) {
    console.warn(`[isolation] self-check unavailable: ${err && err.name ? err.name : 'Error'}`);
  }
}

module.exports = {
  WEBHOOK_SECRET_ENVS,
  deriveStripeMode,
  getIsolationSelfCheck,
  logIsolationSelfCheckAtStartup,
};
