/**
 * Auth OTP email delivery with SMTP preflight.
 * Never logs secrets, OTP values, or full error payloads.
 */

function isAuthEmailConfigured() {
  return Boolean(
    process.env.MAIL_USER && String(process.env.MAIL_USER).trim()
    && process.env.MAIL_PASSWORD && String(process.env.MAIL_PASSWORD).trim()
  );
}

function getSafeAuthEmailError(err) {
  if (!err) {
    return 'unknown';
  }

  const parts = [];
  if (err.code) {
    parts.push(`code=${String(err.code)}`);
  }
  if (err.responseCode) {
    parts.push(`responseCode=${String(err.responseCode)}`);
  }
  if (!parts.length && err.name) {
    parts.push(`type=${String(err.name)}`);
  }

  return parts.length ? parts.join(' ') : 'delivery_failed';
}

/**
 * @param {{ context: string, send: () => Promise<void> }} options
 * @returns {Promise<{ sent: boolean, skipped?: boolean, reason?: string, error?: string }>}
 */
async function deliverAuthOtpEmail({ context, send }) {
  if (!isAuthEmailConfigured()) {
    console.warn(`Auth OTP email skipped (${context}): MAIL_USER/MAIL_PASSWORD not configured`);
    return { sent: false, skipped: true, reason: 'email_not_configured' };
  }

  try {
    await send();
    return { sent: true, skipped: false };
  } catch (err) {
    const safeError = getSafeAuthEmailError(err);
    console.error(`Auth OTP email delivery failed (${context}):`, safeError);
    return { sent: false, skipped: false, error: safeError };
  }
}

module.exports = {
  isAuthEmailConfigured,
  deliverAuthOtpEmail,
  getSafeAuthEmailError,
};
