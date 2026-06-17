/**
 * Graceful vendor onboarding email delivery.
 * Skips when SMTP env is missing; never logs secrets or full payloads.
 */

function isVendorEmailConfigured() {
  return Boolean(
    process.env.MAIL_USER && String(process.env.MAIL_USER).trim()
    && process.env.MAIL_PASSWORD && String(process.env.MAIL_PASSWORD).trim()
  );
}

/**
 * @param {{ label: string, send: () => Promise<void> }} options
 * @returns {Promise<{ sent: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
async function deliverVendorOnboardingEmail({ label, send }) {
  if (!isVendorEmailConfigured()) {
    console.warn(`Vendor onboarding email skipped (${label}): MAIL_USER/MAIL_PASSWORD not configured`);
    return { sent: false, skipped: true, reason: 'email_not_configured' };
  }

  try {
    await send();
    return { sent: true, skipped: false };
  } catch (err) {
    const message = err && err.message ? String(err.message) : 'Unknown email error';
    console.error(`Vendor onboarding email failed (${label}):`, message);
    return { sent: false, skipped: false, error: message };
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
  isVendorEmailConfigured,
  deliverVendorOnboardingEmail,
  deliverVendorOnboardingEmails,
};
