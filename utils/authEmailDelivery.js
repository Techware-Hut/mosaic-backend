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
    const message = err && err.message ? String(err.message) : 'Unknown email error';
    console.error(`Auth OTP email delivery failed (${context}):`, message);
    return { sent: false, skipped: false, error: message };
  }
}

module.exports = {
  isAuthEmailConfigured,
  deliverAuthOtpEmail,
};
