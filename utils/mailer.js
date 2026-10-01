'use strict';

const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('./frontendUrl');
const { deliverAuthOtpEmail } = require('./authEmailDelivery');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');
const { baseLayout, esc } = require('./emailTemplates/baseLayout');

let transporter = null;
let authTransporter = null;
let authVerifyPromise = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(buildSmtpTransportConfig());
  }
  return transporter;
}

function getAuthTransporter() {
  if (!authTransporter) {
    authTransporter = nodemailer.createTransport(buildSmtpTransportConfig());
  }
  return authTransporter;
}

function verifyAuthTransporterOnce() {
  if (!authVerifyPromise) {
    authVerifyPromise = getAuthTransporter().verify().catch((err) => {
      authVerifyPromise = null;
      throw err;
    });
  }
  return authVerifyPromise;
}

async function sendMailWithAuthDelivery(context, mailOptions) {
  const delivery = await deliverAuthOtpEmail({
    context,
    send: async () => {
      await verifyAuthTransporterOnce();
      await getAuthTransporter().sendMail(mailOptions);
    },
  });

  if (delivery.skipped) {
    const err = new Error('Auth email not configured');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  if (!delivery.sent) {
    const err = new Error(delivery.error || 'Auth email delivery failed');
    err.code = 'EMAIL_DELIVERY_FAILED';
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP EMAIL  (register | login | passwordReset | resend | unverifiedLogin)
// ─────────────────────────────────────────────────────────────────────────────
function buildOtpHtml({ to, firstName, otp, context, role }) {
  const isReset = context === 'passwordReset';
  const isLogin = context === 'login';
  const isVendor = role === 'business_owner' || role === 'vendor' || role === 'partner';
  const safeName = esc(firstName || 'there');
  const safeOtp  = esc(String(otp || ''));
  const safeEmail = encodeURIComponent(to || '');

  let headline;
  let openingLine;
  let securityLine;
  let ignoreNote;
  let ctaText;
  let ctaUrl;
  let footerReason;
  let codeLabel = 'Your Verification Code';

  if (isReset) {
    headline = 'Reset Your Password';
    openingLine = 'To reset your password, use the one-time code below.';
    securityLine = "This code confirms it's really you before allowing a password change.";
    ignoreNote = "If you didn't request a password reset, you can safely ignore this message. Your password will not change.";
    ctaText = 'Reset My Password';
    ctaUrl = buildFrontendUrl(`/verify-otp?email=${safeEmail}&type=reset`);
    footerReason = 'You are receiving this email because a password reset was requested for your Mosaic Biz Hub account.';
  } else if (isLogin) {
    headline = 'Your Login Verification Code';
    openingLine = 'To securely log in to your account, use the one-time code below.';
    securityLine = 'This code keeps your account secure and confirms your identity.';
    ignoreNote = "If you didn't attempt to log in, please secure your account immediately.";
    ctaText = 'Go to Dashboard';
    ctaUrl = buildFrontendUrl('/dashboard');
    footerReason = 'You are receiving this email because a login attempt was made on your Mosaic Biz Hub account.';
  } else if (isVendor) {
    // 1B. Vendor OTP Verification
    headline = 'Activate Your Vendor Account';
    openingLine = 'Welcome to Mosaic Biz Hub! Use the one-time verification code below to activate your vendor account.';
    codeLabel = 'Your Vendor Verification Code';
    securityLine = 'Once verified, you’ll be able to begin onboarding and preparing your business for customers.';
    ignoreNote = 'If you didn’t request this code, please ignore this message.';
    ctaText = 'Activate Vendor Account';
    ctaUrl = buildFrontendUrl(`/verify-otp?email=${safeEmail}&type=vendor`);
    footerReason = 'You are receiving this email because you registered as a vendor on Mosaic Biz Hub.';
  } else {
    // 1A. Customer OTP Verification
    headline = 'Verify Your Mosaic Biz Hub Account';
    openingLine = 'To complete your registration, please use the one-time verification code below.';
    codeLabel = 'Your Verification Code';
    securityLine = 'This helps us keep your account secure and ensures you can access all Mosaic Biz Hub features.';
    ignoreNote = 'If you didn’t request this code, you can safely ignore this message.';
    ctaText = 'Complete Registration';
    ctaUrl = buildFrontendUrl(`/verify-otp?email=${safeEmail}&type=customer`);
    footerReason = 'You are receiving this email because you registered for a Mosaic Biz Hub account.';
  }

  const preheader = `Your verification code is ${safeOtp}. It expires in 10 minutes.`;

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.3;">
      ${esc(headline)}
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 28px;line-height:1.6;">
      ${esc(openingLine)}
    </p>

    <!-- OTP Code Box -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background:linear-gradient(135deg,#EEF2FF 0%,#F5F3FF 100%);border:2px dashed #A5B4FC;border-radius:14px;padding:24px 48px;">
            <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.12em;color:#6366F1;text-transform:uppercase;margin:0 0 8px;">
              ${esc(codeLabel)}
            </p>
            <p style="font-family:'Courier New',Courier,monospace;font-size:44px;font-weight:700;letter-spacing:0.25em;color:#111827;margin:0;line-height:1.1;">
              ${safeOtp}
            </p>
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#9CA3AF;margin:10px 0 0;">
              &#128336;&nbsp;Expires in <strong>10 minutes</strong>
            </p>
          </div>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 24px;line-height:1.6;">
      ${esc(securityLine)} It will expire in <strong>10 minutes</strong>.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${ctaUrl}"
            style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.01em;line-height:1;">
            ${esc(ctaText)}
          </a>
        </td>
      </tr>
    </table>

    <!-- Ignore note -->
    <p style="font-family:Arial,sans-serif;font-size:13px;color:#9CA3AF;margin:0;line-height:1.6;border-left:3px solid #E5E7EB;padding-left:12px;">
      ${esc(ignoreNote)}
    </p>
  `;

  return baseLayout({ preheader, bodyHtml, footerReason });
}

function buildOtpText({ to, firstName, otp, context, role }) {
  const isReset = context === 'passwordReset';
  const isLogin = context === 'login';
  const isVendor = role === 'business_owner' || role === 'vendor' || role === 'partner';
  const safeName = String(firstName || 'there').trim();
  const safeOtp  = String(otp || '').trim();
  const safeEmail = encodeURIComponent(to || '');

  let headline;
  let openingLine;
  let securityLine;
  let ignoreNote;
  let ctaUrl;
  let label = 'Your Verification Code';

  if (isReset) {
    headline = 'Reset Your Password';
    openingLine = 'To reset your password, use the one-time code below.';
    securityLine = "This code confirms it's really you before allowing a password change.";
    ignoreNote = "If you didn't request a password reset, you can safely ignore this message.";
    ctaUrl = buildFrontendUrl(`/verify-otp?email=${safeEmail}&type=reset`);
  } else if (isLogin) {
    headline = 'Your Login Verification Code';
    openingLine = 'To securely log in, use the one-time code below.';
    securityLine = 'This code keeps your account secure and confirms your identity.';
    ignoreNote = "If you didn't attempt to log in, please secure your account immediately.";
    ctaUrl = buildFrontendUrl('/dashboard');
  } else if (isVendor) {
    headline = 'Activate Your Vendor Account';
    openingLine = 'Welcome to Mosaic Biz Hub! Use the one-time verification code below to activate your vendor account.';
    label = 'Your Vendor Verification Code';
    securityLine = "Once verified, you'll be able to begin onboarding and preparing your business for customers.";
    ignoreNote = 'If you didn’t request this code, please ignore this message.';
    ctaUrl = buildFrontendUrl(`/verify-otp?email=${safeEmail}&type=vendor`);
  } else {
    headline = 'Verify Your Mosaic Biz Hub Account';
    openingLine = 'To complete your registration, please use the one-time verification code below.';
    label = 'Your Verification Code';
    securityLine = 'This helps us keep your account secure and ensures you can access all Mosaic Biz Hub features.';
    ignoreNote = 'If you didn’t request this code, you can safely ignore this message.';
    ctaUrl = buildFrontendUrl(`/verify-otp?email=${safeEmail}&type=customer`);
  }

  return [
    headline,
    '',
    `Hi ${safeName},`,
    '',
    openingLine,
    '',
    `${label}: ${safeOtp}`,
    '',
    `${securityLine} It will expire in 10 minutes.`,
    '',
    `Verify Link: ${ctaUrl}`,
    '',
    ignoreNote,
    '',
    '—',
    'Mosaic Biz Hub',
    'Connecting businesses, customers, and community.',
    'support@mosaicbizhub.com | https://mosaicbizhub.com',
  ].join('\n');
}

exports.sendOtpEmail = async (to, otp, context = 'register', firstName, role = 'customer') => {
  const isReset = context === 'passwordReset';
  const isLogin = context === 'login';
  const isVendor = role === 'business_owner' || role === 'vendor' || role === 'partner';
  const subject = isReset
    ? 'Reset Your Mosaic Biz Hub Password'
    : isLogin
      ? 'Your Mosaic Biz Hub Login Code'
      : isVendor
        ? 'Activate Your Vendor Account'
        : 'Verify Your Mosaic Biz Hub Account';

  await sendMailWithAuthDelivery(context, {
    from: formatMosaicFromHeader(),
    to,
    subject,
    text: buildOtpText({ to, firstName, otp, context, role }),
    html: buildOtpHtml({ to, firstName, otp, context, role }),
  });
};

exports.sendPasswordResetOtpEmail = async (to, otp, firstName) => {
  await sendMailWithAuthDelivery('passwordReset', {
    from: formatMosaicFromHeader(),
    to,
    subject: 'Reset Your Mosaic Biz Hub Password',
    text: buildOtpText({ to, firstName, otp, context: 'passwordReset' }),
    html: buildOtpHtml({ to, firstName, otp, context: 'passwordReset' }),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// WELCOME EMAIL  (customer | business_owner)
// ─────────────────────────────────────────────────────────────────────────────
exports.sendWelcomeEmail = async (to, firstName, role) => {
  try {
    const safeName = esc(firstName || 'there');
    const isVendor = role === 'business_owner';

    const subject = isVendor
      ? 'Welcome — Let’s Build Together'
      : 'Welcome to Mosaic Biz Hub';

    const ctaUrl  = isVendor
      ? buildFrontendUrl('/partners/dashboard')
      : buildFrontendUrl('/');

    const ctaText = isVendor ? 'Start Vendor Onboarding' : 'Visit Mosaic Biz Hub';

    const preheader = isVendor
      ? 'Your vendor account is active! You’re now ready to begin onboarding and preparing your business for customers.'
      : 'Your account is officially active. Welcome to the Mosaic Biz Hub community!';

    const footerReason = isVendor
      ? 'You are receiving this email because you created a Mosaic Biz Hub vendor account.'
      : 'You are receiving this email because you created a Mosaic Biz Hub account.';

    const bodyHtml = isVendor ? `
      <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.3;">
        Welcome — Let’s Build Together
      </h1>
      <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
        Hi ${safeName},
      </p>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
        Welcome to Mosaic Biz Hub; we're glad you joined. You didn't just create an account; you joined a purpose-driven marketplace built to help businesses like yours gain visibility, attract loyal customers, and scale confidently. No hidden fees or commissions.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
        <tr>
          <td style="background:#F0FDF4;border-left:4px solid #22C55E;border-radius:0 8px 8px 0;padding:20px 24px;">
            <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#15803D;margin:0 0 12px;">How Mosaic will help your business grow</p>
            <ul style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding-left:18px;line-height:1.8;">
              <li><strong>Get discovered</strong> — curated placement and searchable profiles.</li>
              <li><strong>Sell smarter</strong> — conversion-focused storefront tools and analytics.</li>
              <li><strong>Build credibility</strong> — verified badges and peer reviews.</li>
              <li><strong>Access resources</strong> — mentorship, partnerships, and funding opportunities (future).</li>
              <li><strong>Track progress</strong> — dashboard with key performance metrics.</li>
            </ul>
          </td>
        </tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
        <tr>
          <td style="background:#EFF6FF;border-left:4px solid #3B82F6;border-radius:0 8px 8px 0;padding:20px 24px;">
            <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#1D4ED8;margin:0 0 12px;">Quick next steps</p>
            <ol style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding-left:18px;line-height:1.8;">
              <li>Complete your profile; we want to learn more about your business</li>
              <li>Submit the one-time business verification fee $24.99</li>
              <li>Select a Tier Plan that suits your business</li>
              <li>Upload your product/service offerings.</li>
              <li>Set up your Stripe account</li>
              <li>Explore your vendor dashboard.</li>
            </ol>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 12px;line-height:1.6;">
        Welcome to the movement — let's build something that lasts.
      </p>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 12px;line-height:1.6;">
        Your vendor account is active! You’re now ready to begin onboarding and preparing your business for customers.
      </p>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 28px;line-height:1.6;">
        We’re honored to support your growth.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
        <tr>
          <td>
            <a href="${ctaUrl}"
              style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.01em;line-height:1;">
              ${esc(ctaText)}
            </a>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
        Thank you for being part of the Mosaic Biz Hub community.<br/>
        <strong>The Mosaic Biz Hub Team</strong>
      </p>
    ` : `
      <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 8px;line-height:1.3;">
        Welcome to Mosaic Biz Hub
      </h1>
      <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
        Hi ${safeName},
      </p>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
        Your account is officially active. Welcome to the Mosaic Biz Hub community! You now have access to diverse vendors, unique products, and services nationwide.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;border-collapse:collapse;">
        <tr>
          <td style="background:#F5F3FF;border-left:4px solid #7C3AED;border-radius:0 8px 8px 0;padding:20px 24px;">
            <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#6D28D9;margin:0 0 12px;">Here’s what you can do next:</p>
            <ul style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding-left:18px;line-height:1.8;">
              <li>Explore categories and discover new businesses</li>
              <li>Save your favorite vendors</li>
              <li>Reserve a table at your favorite restaurant</li>
              <li>Book professional services</li>
              <li>Place orders and track everything in your dashboard</li>
            </ul>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 28px;line-height:1.6;">
        We’re excited to have you with us.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
        <tr>
          <td>
            <a href="${ctaUrl}"
              style="display:inline-block;background:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.01em;line-height:1;">
              ${esc(ctaText)}
            </a>
          </td>
        </tr>
      </table>

      <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
        Thank you for being part of the Mosaic Biz Hub community.<br/>
        <strong>The Mosaic Biz Hub Team</strong>
      </p>
    `;

    console.log(`Sending ${role || 'customer'} welcome email`);

    const textContent = isVendor
      ? [
          'Welcome — Let’s Build Together',
          '',
          `Hi ${firstName || 'there'},`,
          '',
          "Welcome to Mosaic Biz Hub; we're glad you joined. You didn't just create an account; you joined a purpose-driven marketplace built to help businesses like yours gain visibility, attract loyal customers, and scale confidently. No hidden fees or commissions.",
          '',
          'How Mosaic will help your business grow:',
          '• Get discovered — curated placement and searchable profiles.',
          '• Sell smarter — conversion-focused storefront tools and analytics.',
          '• Build credibility — verified badges and peer reviews.',
          '• Access resources — mentorship, partnerships, and funding opportunities (future).',
          '• Track progress — dashboard with key performance metrics.',
          '',
          'Quick next steps:',
          '1. Complete your profile; we want to learn more about your business',
          '2. Submit the one-time business verification fee $24.99',
          '3. Select a Tier Plan that suits your business',
          '4. Upload your product/service offerings.',
          '5. Set up your Stripe account',
          '6. Explore your vendor dashboard.',
          '',
          "Welcome to the movement — let's build something that lasts.",
          'Your vendor account is active! You’re now ready to begin onboarding and preparing your business for customers.',
          'We’re honored to support your growth.',
          '',
          `Start Vendor Onboarding: ${ctaUrl}`,
          '',
          'Thank you for being part of the Mosaic Biz Hub community.',
          '— The Mosaic Biz Hub Team',
        ].join('\n')
      : [
          'Welcome to Mosaic Biz Hub',
          '',
          `Hi ${firstName || 'there'},`,
          '',
          'Your account is officially active. Welcome to the Mosaic Biz Hub community! You now have access to diverse vendors, unique products, and services nationwide.',
          '',
          'Here’s what you can do next:',
          '• Explore categories and discover new businesses',
          '• Save your favorite vendors',
          '• Reserve a table at your favorite restaurant',
          '• Book professional services',
          '• Place orders and track everything in your dashboard',
          '',
          'We’re excited to have you with us.',
          '',
          `Visit Mosaic Biz Hub: ${ctaUrl}`,
          '',
          'Thank you for being part of the Mosaic Biz Hub community.',
          '— Mosaic Biz Hub Team',
        ].join('\n');

    await getTransporter().sendMail({
      from: formatMosaicFromHeader(),
      to,
      subject,
      text: textContent,
      html: baseLayout({ preheader, bodyHtml, footerReason }),
    });

  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};
