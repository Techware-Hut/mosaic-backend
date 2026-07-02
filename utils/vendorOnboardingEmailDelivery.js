/**
 * Graceful vendor onboarding email delivery.
 * Skips when required SMTP env is missing; never logs secrets or full payloads.
 */

function getTrimmedEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}

function getVendorEmailProvider(env = process.env) {
  const host = String(getTrimmedEnv(env, 'MAIL_HOST') || '').toLowerCase();
  const user = String(getTrimmedEnv(env, 'MAIL_USER') || '').toLowerCase();

  if (host.includes('resend') || user === 'resend') {
    return 'resend_smtp';
  }

  if (host) {
    return 'smtp';
  }

  return 'legacy_gmail';
}

function getVendorEmailConfigStatus(env = process.env) {
  const missing = [];
  if (!getTrimmedEnv(env, 'MAIL_USER')) missing.push('MAIL_USER');
  if (!getTrimmedEnv(env, 'MAIL_PASSWORD')) missing.push('MAIL_PASSWORD');

  const provider = getVendorEmailProvider(env);
  if (provider === 'resend_smtp' && !getTrimmedEnv(env, 'MAIL_FROM')) {
    missing.push('MAIL_FROM');
  }

  return {
    configured: missing.length === 0,
    missing,
    provider,
  };
}

function isVendorEmailConfigured(env = process.env) {
  return getVendorEmailConfigStatus(env).configured;
}

function normalizeProviderMessageId(info) {
  const raw = info && typeof info === 'object' ? info.messageId : undefined;
  if (!raw) return undefined;

  return String(raw).trim().slice(0, 180) || undefined;
}

/**
 * @param {{ label: string, send: () => Promise<void> }} options
 * @returns {Promise<{ sent: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
async function deliverVendorOnboardingEmail({ label, send }) {
  const configStatus = getVendorEmailConfigStatus();

  if (!configStatus.configured) {
    console.warn(
      `Vendor onboarding email skipped (${label}): email not configured; missing env names: ${configStatus.missing.join(', ')}`
    );
    return {
      sent: false,
      skipped: true,
      reason: 'email_not_configured',
      provider: configStatus.provider,
      missingEnvNames: configStatus.missing,
    };
  }

  try {
    const info = await send();
    return {
      sent: true,
      skipped: false,
      provider: configStatus.provider,
      messageId: normalizeProviderMessageId(info),
    };
  } catch (err) {
    const message = err && err.message ? String(err.message) : 'Unknown email error';
    console.error(`Vendor onboarding email failed (${label}):`, message);
    return {
      sent: false,
      skipped: false,
      provider: configStatus.provider,
      error: message,
    };
  }
}

/**
 * Run multiple email deliveries; aggregate results for API responses.
 * @param {Array<{ label: string, send: () => Promise<void> }>} jobs
 */
async function deliverVendorOnboardingEmails(jobs = []) {
  const results = [];

  for (const job of jobs) {
    results.push({
      label: job.label,
      ...(await deliverVendorOnboardingEmail(job)),
    });
  }

  const sent = results.some((r) => r.sent);
  const skipped = results.length > 0 && results.every((r) => r.skipped);
  const anyFailed = results.some((r) => !r.sent && !r.skipped);

  return {
    results,
    emailSent: sent,
    emailSkipped: skipped && !sent,
    emailFailed: anyFailed && !sent,
  };
}

module.exports = {
  getVendorEmailConfigStatus,
  getVendorEmailProvider,
  isVendorEmailConfigured,
  deliverVendorOnboardingEmail,
  deliverVendorOnboardingEmails,
  normalizeProviderMessageId,
};
