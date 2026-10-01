const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('./frontendUrl');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');
const { baseLayout, esc } = require('./emailTemplates/baseLayout');

const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

const escapeHtml = (value = '') =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeMailerList = (value) => {
  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((item) => {
      if (Array.isArray(item)) return item;
      if (typeof item === 'string' && item.includes(',')) {
        return item.split(',');
      }
      return item;
    })
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
};

const vendorGuidanceCopy = Object.freeze({
  missing_documents: {
    subject: 'Action Required: Vendor Application Documents Needed',
    heading: 'We need a few documents before approval',
    defaultReason: 'Some required documents are missing or not verified.',
  },
  failed_validation: {
    subject: 'Action Required: Vendor Verification Correction Needed',
    heading: 'A submitted item did not pass verification',
    defaultReason: 'One or more submitted items could not be verified.',
  },
  discrepancy: {
    subject: 'Action Required: Vendor Application Clarification Needed',
    heading: 'We need clarification on your application',
    defaultReason: 'Some application details need to be clarified before review can continue.',
  },
  under_review: {
    subject: 'Vendor Application Under Review',
    heading: 'Your application is under review',
    defaultReason: 'Our team is still reviewing your submitted application.',
  },
  manual_review: {
    subject: 'Vendor Application Manual Review Update',
    heading: 'Your application needs manual review',
    defaultReason: 'Your application has been routed for manual review by our team.',
  },
});

function buildListHtml(items) {
  if (!items.length) return '';

  return `
    <ul style="margin:8px 0 0 18px; padding:0; color:#475569; line-height:1.6;">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}

exports.sendVendorVerificationGuidanceEmail = async ({
  to,
  vendorName,
  businessName,
  applicationId,
  currentStatus,
  outcome,
  reason,
  reasons,
  documentsNeeded,
  fieldsNeeded,
  responseWindowDays,
  correctionPath = '/partners/business/new',
  supportEmail,
}) => {
  const copy = vendorGuidanceCopy[outcome] || vendorGuidanceCopy.failed_validation;
  const reasonItems = normalizeMailerList(reasons);
  const safeReason = String(reason ?? '').trim();
  if (safeReason) {
    reasonItems.unshift(safeReason);
  }

  const documents = normalizeMailerList(documentsNeeded);
  const fields = normalizeMailerList(fieldsNeeded);
  const responseDays = Number(responseWindowDays);
  const responseWindowText = Number.isFinite(responseDays) && responseDays > 0
    ? `Please respond within ${Math.round(responseDays)} business day${Math.round(responseDays) === 1 ? '' : 's'}.`
    : 'Please respond as soon as you can so our team can continue review.';
  const contactEmail = supportEmail || process.env.SUPPORT_EMAIL || 'info@mosaicbizhub.com';
  const status = currentStatus || 'submitted';
  const displayName = vendorName || 'there';
  const displayBusinessName = businessName || 'your business';
  const correctionUrl = buildFrontendUrl(correctionPath);

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: copy.subject,
    html: `
      <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:28px;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;border:1px solid #e2e8f0;">
          <h2 style="margin:0 0 12px;color:#0f172a;">Hello ${escapeHtml(displayName)},</h2>
          <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
            ${escapeHtml(copy.heading)} for <strong>${escapeHtml(displayBusinessName)}</strong>.
          </p>

          <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:18px 0;">
            <p style="margin:0;color:#334155;"><strong>Application ID:</strong> ${escapeHtml(applicationId || 'N/A')}</p>
            <p style="margin:6px 0 0;color:#334155;"><strong>Current status:</strong> ${escapeHtml(status)}</p>
          </div>

          <p style="color:#475569;line-height:1.6;margin:0 0 8px;">
            <strong>Reason${reasonItems.length > 1 ? 's' : ''}:</strong>
          </p>
          ${buildListHtml(reasonItems.length ? reasonItems : [copy.defaultReason])}

          ${documents.length ? `
            <p style="color:#475569;line-height:1.6;margin:18px 0 8px;">
              <strong>Documents needed:</strong>
            </p>
            ${buildListHtml(documents)}
          ` : ''}

          ${fields.length ? `
            <p style="color:#475569;line-height:1.6;margin:18px 0 8px;">
              <strong>Fields or details needed:</strong>
            </p>
            ${buildListHtml(fields)}
          ` : ''}

          <p style="color:#475569;line-height:1.6;margin:18px 0 0;">
            ${escapeHtml(responseWindowText)}
          </p>

          <div style="margin:24px 0;text-align:center;">
            <a href="${correctionUrl}" style="background:#1d4ed8;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:bold;">
              Open Vendor Dashboard
            </a>
          </div>

          <p style="font-size:13px;color:#64748b;line-height:1.5;margin:24px 0 0;">
            Need help? Contact <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.
          </p>

          <p style="font-size:13px;color:#64748b;margin:18px 0 0;">
            Mosaic Biz Hub Team
          </p>
        </div>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

exports.sendWelcomeEmail = async (to, vendorName) => {
  const {
    resolvePlatformLogoAttachment,
    withOptionalLogoAttachment,
  } = require('./emailLogoAttachment');

  const { attachment: logoAttachment, logoSrcForHtml } =
    await resolvePlatformLogoAttachment();

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: 'Welcome to Mosaic Biz Hub!',
    html: `
      <div style="font-family: Arial, sans-serif; text-align: center; background-color: #f9f9f9; padding: 20px;">
        <img src="${logoSrcForHtml}" alt="Mosaic Biz Hub Logo" style="max-width: 150px; margin-bottom: 20px;">
        <h2 style="color: #333;">Welcome to Mosaic Biz Hub, ${vendorName}!</h2>
        <p style="color: #555; font-size: 16px;">
          We’re excited to have you join our platform. Mosaic Biz Hub is here to help you grow your business and connect with new opportunities.
        </p>
        <p style="color: #555; font-size: 16px;">
          Explore, engage, and make the most out of your journey with us.
        </p>
        <a href="${buildFrontendUrl('/')}" 
           style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #0d6efd; color: #fff; text-decoration: none; border-radius: 5px;">
           Visit Platform
        </a>
        <p style="margin-top: 30px; font-size: 12px; color: #888;">
          &copy; ${new Date().getFullYear()} Mosaic Biz Hub. All rights reserved.
        </p>
      </div>
    `,
    attachments: withOptionalLogoAttachment([], logoAttachment),
  };

  return transporter.sendMail(mailOptions);
};



exports.sendAdminOnboardingSubmissionEmail = async ({
  adminEmail,
  applicationId,
  businessName,
  vendorName,
  tierPlan,
}) => {
  const safeAdminEmail = adminEmail || process.env.ADMIN_EMAIL || 'info@mosaicbizhub.com';
  const safeAppId = esc(applicationId || 'N/A');
  const safeBizName = esc(businessName || 'N/A');
  const safeTier = esc(tierPlan || '');
  const submissionDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const ctaUrl = buildFrontendUrl(`/admin/vendor-applications/${applicationId || ''}`);
  const ctaText = 'Open Admin Dashboard';
  const preheader = `A vendor has submitted Step 1 and requires review. Application #${safeAppId}`;
  const footerReason = 'You are receiving this email because you are registered as an administrator for Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.3;">
      Vendor Submission Requires Review
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Hello Admin Team,
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      A vendor has submitted Step 1 and requires review. Please log in to the admin dashboard to approve or block the submission.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Application Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            <tr>
              <td style="padding:4px 0;width:160px;color:#6B7280;">Application Number:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeAppId}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Business Name:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeBizName}</td>
            </tr>
            ${safeTier ? `
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Tier Plan:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeTier}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Submission Date:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${submissionDate}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 24px;line-height:1.6;">
      Please log in to the Admin Dashboard to review the submitted application and proceed with the verification process.
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

    <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0;line-height:1.6;">
      Best regards,<br/>
      <strong>Mosaic Biz Hub System Notification</strong>
    </p>
  `;

  const textContent = [
    'Vendor Submission Requires Review',
    '',
    'Hello Admin Team,',
    '',
    'A vendor has submitted Step 1 and requires review. Please log in to the admin dashboard to approve or block the submission.',
    '',
    'Application Details:',
    `Application Number: ${safeAppId}`,
    `Business Name: ${safeBizName}`,
    safeTier ? `Tier Plan: ${safeTier}` : '',
    `Submission Date: ${submissionDate}`,
    '',
    'Please log in to the Admin Dashboard to review the submitted application and proceed with the verification process.',
    '',
    `Open Admin Dashboard: ${ctaUrl}`,
    '',
    'Best regards,',
    'Mosaic Biz Hub System Notification',
  ].filter(Boolean).join('\n');

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to: safeAdminEmail,
    subject: `Vendor Submission Requires Review – Application #${safeAppId}`,
    text: textContent,
    html: baseLayout({ preheader, bodyHtml, footerReason }),
  };

  return transporter.sendMail(mailOptions);
};


exports.sendVendorSubmissionConfirmationEmail = async ({
  to,
  vendorName,
  applicationId,
}) => {
  const safeName = esc(vendorName || 'there');
  const safeAppId = esc(applicationId || '');
  const preheader = 'Thank you for applying to Mosaic Biz Hub. Your information is under review.';
  const footerReason = 'You are receiving this email because you submitted a vendor application on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.3;">
      Your Application Is Under Review
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Thank you for applying to Mosaic Biz Hub. Your information is under review.
      We’ll email next steps within <strong>3–5 business days</strong>.
    </p>

    ${safeAppId ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px 18px;">
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0;">
            <strong style="color:#374151;">Application ID:</strong> ${safeAppId}
          </p>
        </td>
      </tr>
    </table>` : ''}

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 24px;line-height:1.6;">
      If you have questions, contact us at
      <a href="mailto:info@mosaicbizhub.com" style="color:#2563EB;text-decoration:none;font-weight:600;">info@mosaicbizhub.com</a>
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Warm regards,<br/>
      <strong>The Mosaic Biz Hub Team</strong>
    </p>
  `;

  const textContent = [
    'Your Mosaic Biz Hub Application Is Under Review',
    '',
    `Hi ${vendorName || 'there'},`,
    '',
    'Thank you for applying to Mosaic Biz Hub. Your information is under review.',
    'We’ll email next steps within 3–5 business days.',
    '',
    safeAppId ? `Application ID: ${safeAppId}` : '',
    '',
    'If you have questions, contact us at info@mosaicbizhub.com',
    '',
    'Mosaic Biz Hub Team',
  ].filter(Boolean).join('\n');

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Mosaic Biz Hub Application Is Under Review",
    text: textContent,
    html: baseLayout({ preheader, bodyHtml, footerReason }),
  };

  return transporter.sendMail(mailOptions);
};

const onboardingPaymentReminderCopy = Object.freeze({
  payment_pending: {
    headline: 'Your verification payment is still pending',
    detail:
      'We noticed you started your Mosaic Biz Hub vendor application but have not completed the one-time verification fee yet.',
    ctaPath: '/partners/business/payment',
  },
  paid_draft_unsubmitted: {
    headline: 'Your application is ready to submit',
    detail:
      'Your verification payment is complete. Finish your application details and submit for admin review to keep onboarding moving.',
    ctaPath: '/partners/business/payment',
  },
});

exports.sendPaymentReminderEmail = async (vendorData = {}) => {
  const {
    to,
    vendorName,
    businessName,
    applicationId,
    reminderKind = 'payment_pending',
    supportEmail,
  } = vendorData;

  const copy = onboardingPaymentReminderCopy[reminderKind]
    || onboardingPaymentReminderCopy.payment_pending;
  const displayName = vendorName || 'there';
  const displayBusinessName = businessName || 'your business';
  const contactEmail = supportEmail || process.env.SUPPORT_EMAIL || 'info@mosaicbizhub.com';
  const actionUrl = buildFrontendUrl(copy.ctaPath);

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: 'Action Required: Complete Your Vendor Onboarding',
    html: `
      <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:28px;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;border:1px solid #e2e8f0;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#b45309;">
            Onboarding Alert
          </p>
          <h2 style="margin:0 0 12px;color:#0f172a;">Hello ${escapeHtml(displayName)},</h2>
          <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
            ${escapeHtml(copy.detail)} for <strong>${escapeHtml(displayBusinessName)}</strong>.
          </p>

          <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:16px;margin:18px 0;">
            <p style="margin:0 0 8px;color:#9a3412;font-weight:bold;">${escapeHtml(copy.headline)}</p>
            <p style="margin:0;color:#7c2d12;line-height:1.6;">
              Pick up where you left off to unlock vendor verification, storefront setup, and marketplace listings.
            </p>
          </div>

          <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:18px 0;">
            <p style="margin:0;color:#334155;"><strong>Application ID:</strong> ${escapeHtml(applicationId || 'N/A')}</p>
          </div>

          <div style="margin:24px 0;text-align:center;">
            <a href="${actionUrl}" style="background:#1d4ed8;color:#fff;padding:14px 22px;text-decoration:none;border-radius:6px;font-size:15px;font-weight:bold;display:inline-block;">
              Complete Your Payment &amp; Onboarding Setup
            </a>
          </div>

          <p style="font-size:13px;color:#64748b;line-height:1.5;margin:24px 0 0;">
            Need help? Contact <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.
          </p>

          <p style="font-size:13px;color:#64748b;margin:18px 0 0;">
            Mosaic Biz Hub Team
          </p>
        </div>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};


exports.sendVendorApprovedEmail = async ({
  to,
  vendorName,
  firstName,
  businessName,
  applicationId,
  submissionDate,
}) => {
  const safeFirstName = esc(firstName || (vendorName ? vendorName.split(' ')[0] : 'there'));
  const safeAppId = esc(applicationId || 'N/A');
  const safeBizName = esc(businessName || 'Your Business');
  const formattedDate = submissionDate
    ? new Date(submissionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const continueOnboardingUrl = buildFrontendUrl('/login?type=vendor');
  const ctaUrl = buildFrontendUrl('/partners/dashboard');
  const ctaText = 'Add Your First Listing';
  const preheader = `Congratulations ${safeFirstName}! Your business has passed initial verification.`;
  const footerReason = 'You are receiving this email because your vendor application was approved on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Your Business Has Been Approved!
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Congratulations, ${safeFirstName}!
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Your business has successfully passed our initial verification process. You’re now eligible to choose your subscription tier plan and complete your profile.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 12px;line-height:1.6;">
      <strong>Application ID:</strong> ${safeAppId}
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      <a href="${continueOnboardingUrl}" style="color:#2563EB;font-weight:600;text-decoration:none;">Continue Onboarding</a>. Let's keep the momentum going.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Application Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            <tr>
              <td style="padding:4px 0;width:160px;color:#6B7280;">Application Number:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeAppId}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Business Name:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeBizName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Submission Date:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${formattedDate}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td style="background:#F0FDF4;border-left:4px solid #22C55E;border-radius:0 8px 8px 0;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#15803D;margin:0 0 10px;">Next steps:</p>
          <ul style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0;padding-left:18px;line-height:1.8;">
            <li>Complete any remaining onboarding questions</li>
            <li>Add product/service listings</li>
            <li>Customize your vendor profile</li>
          </ul>
        </td>
      </tr>
    </table>

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

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.<br/>
      <strong>The Mosaic Biz Hub Team</strong>
    </p>
  `;

  const textContent = [
    'Your Business Has Been Approved!',
    '',
    `Congratulations, ${safeFirstName}!`,
    '',
    'Your business has successfully passed our initial verification process. You’re now eligible to choose your subscription tier plan and complete your profile.',
    '',
    `Application ID: ${safeAppId}`,
    `Continue Onboarding: ${continueOnboardingUrl} - Let's keep the momentum going`,
    '',
    'Application Details:',
    `Application Number: ${safeAppId}`,
    `Business Name: ${safeBizName}`,
    `Submission Date: ${formattedDate}`,
    '',
    'Next steps:',
    '• Complete any remaining onboarding questions',
    '• Add product/service listings',
    '• Customize your vendor profile',
    '',
    `Add Your First Listing: ${ctaUrl}`,
    '',
    'Thank you for being part of the Mosaic Biz Hub community.',
    '— The Mosaic Biz Hub Team',
  ].join('\n');

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Business Has Been Approved!",
    text: textContent,
    html: baseLayout({ preheader, bodyHtml, footerReason }),
  };

  return transporter.sendMail(mailOptions);
};

const storefrontListingCopy = Object.freeze({
  product: {
    label: 'product',
    summary:
      'Your product storefront and listings are now live on Mosaic Biz Hub.',
  },
  service: {
    label: 'service',
    summary:
      'Your service storefront and listings are now live on Mosaic Biz Hub.',
  },
  food: {
    label: 'food',
    summary:
      'Your food storefront and listings are now live on Mosaic Biz Hub.',
  },
});

exports.sendVendorStorefrontPublishedEmail = async ({
  to,
  vendorName,
  businessName,
  listingType = 'product',
  businessSlug,
}) => {
  const normalizedType = String(listingType || 'product').trim().toLowerCase();
  const copy =
    storefrontListingCopy[normalizedType] || storefrontListingCopy.product;
  const displayName = vendorName || businessName || 'there';
  const displayBusinessName = businessName || 'your business';
  const dashboardPath = businessSlug ? `/partners/${businessSlug}` : '/partners';
  const dashboardUrl = buildFrontendUrl(dashboardPath);

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: 'Congratulations — Your Mosaic Biz Hub Storefront Is Live 🎉',
    html: `
      <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:28px;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;border:1px solid #e2e8f0;">
          <h2 style="margin:0 0 12px;color:#28a745;">Congratulations, ${escapeHtml(displayName)}!</h2>
          <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
            <strong>${escapeHtml(displayBusinessName)}</strong> has completed onboarding and your storefront is live.
          </p>
          <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
            ${escapeHtml(copy.summary)} Customers can now discover your ${escapeHtml(copy.label)} business on the marketplace.
          </p>
          <p style="color:#475569;line-height:1.6;margin:0 0 8px;">
            <strong>What you can do next:</strong>
          </p>
          <ul style="margin:8px 0 0 18px;padding:0;color:#475569;line-height:1.6;">
            <li>Open your vendor dashboard to manage bookings, orders, and inventory</li>
            <li>Review your public storefront and keep listings up to date</li>
            <li>Share your business profile with customers</li>
          </ul>
          <div style="margin:24px 0;text-align:center;">
            <a href="${dashboardUrl}" style="background:#c9a227;color:#111827;padding:12px 20px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:bold;">
              Go to Dashboard
            </a>
          </div>
          <p style="font-size:13px;color:#64748b;line-height:1.5;margin:24px 0 0;">
            Welcome to the Mosaic Biz Hub community — we're excited to see your business grow.
          </p>
          <p style="font-size:13px;color:#64748b;margin:18px 0 0;">
            Mosaic Biz Hub Team
          </p>
        </div>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};


exports.sendVendorRejectionEmail = async ({
  to,
  vendorName,
  applicationId,
  rejectionReason,
  businessName,
  requiredNextAction,
  documentsNeeded,
  responseWindowDays,
}) => {
  const safeRejectionReason = String(rejectionReason ?? '').trim()
    || 'Your application did not meet the current verification requirements.';
  const safeNextAction = String(requiredNextAction ?? '').trim()
    || 'Update your application and resubmit for review.';
  const documents = normalizeMailerList(documentsNeeded);
  const displayName = vendorName || 'there';
  const displayBusinessName = businessName || 'your business';
  const correctionUrl = buildFrontendUrl('/partners/business/new');
  const contactEmail = process.env.SUPPORT_EMAIL || 'info@mosaicbizhub.com';

  const responseDays = Number(responseWindowDays);
  const responseWindowText = Number.isFinite(responseDays) && responseDays > 0
    ? `Please complete the next steps within ${Math.round(responseDays)} business day${Math.round(responseDays) === 1 ? '' : 's'}.`
    : 'Please complete the next steps as soon as you can so our team can continue review.';

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: 'Action Required: Vendor Application Changes Requested',
    html: `
      <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:28px;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;border:1px solid #e2e8f0;">
          <h2 style="margin:0 0 12px;color:#0f172a;">Hello ${escapeHtml(displayName)},</h2>
          <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
            Thank you for applying to <strong>Mosaic Biz Hub</strong>. After reviewing your application for
            <strong>${escapeHtml(displayBusinessName)}</strong>, our team needs a few updates before we can approve your vendor profile.
          </p>

          <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:18px 0;">
            <p style="margin:0;color:#334155;"><strong>Application ID:</strong> ${escapeHtml(applicationId || 'N/A')}</p>
            <p style="margin:6px 0 0;color:#334155;"><strong>Current status:</strong> Changes requested</p>
          </div>

          <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:16px;margin:18px 0;">
            <p style="margin:0 0 8px;color:#9a3412;font-weight:bold;">Reason for this decision</p>
            <p style="margin:0;color:#7c2d12;line-height:1.6;">${escapeHtml(safeRejectionReason)}</p>
          </div>

          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:16px;margin:18px 0;">
            <p style="margin:0 0 8px;color:#1e3a8a;font-weight:bold;">What you need to do next</p>
            <p style="margin:0;color:#1e40af;line-height:1.6;">${escapeHtml(safeNextAction)}</p>
          </div>

          ${documents.length ? `
            <p style="color:#475569;line-height:1.6;margin:18px 0 8px;">
              <strong>Documents still needed:</strong>
            </p>
            ${buildListHtml(documents)}
          ` : ''}

          <p style="color:#475569;line-height:1.6;margin:18px 0 0;">
            ${escapeHtml(responseWindowText)}
          </p>

          <div style="margin:24px 0;text-align:center;">
            <a href="${correctionUrl}" style="background:#1d4ed8;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:bold;">
              Open Vendor Dashboard
            </a>
          </div>

          <p style="font-size:13px;color:#64748b;line-height:1.5;margin:24px 0 0;">
            Need help? Contact <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.
          </p>

          <p style="font-size:13px;color:#64748b;margin:18px 0 0;">
            Mosaic Biz Hub Team
          </p>
        </div>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

// exports.sendVendorRejectionEmail = async ({
//   to,
//   vendorName,
//   applicationId,
//   points,
//   rejectionReason
// }) => {
//   const safeRejectionReason = rejectionReason || 'Your application did not meet the current verification requirements.';

//   const mailOptions = {
//     from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
//     to,
//     subject: "Action Required: Vendor Application Update",
//     html: `
//       <div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:30px;">
//         <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:8px; padding:30px; box-shadow:0 2px 8px rgba(0,0,0,0.05);">
          
//           <h2 style="color:#2c3e50; margin-bottom:10px;">Hello ${vendorName},</h2>
          
//           <p style="color:#555; line-height:1.6;">
//             Thank you for your interest in joining <strong>Mosaic Biz Hub</strong>. We appreciate the time and effort you’ve put into your application.
//           </p>
          
//           <p style="color:#555; line-height:1.6;">
//             After an initial review, we found that some additional information or clarification is required before we can proceed with your verification.
//           </p>

//           <div style="background:#fff3f3; border:1px solid #f5c6cb; padding:15px; border-radius:6px; margin:20px 0;">
//             <p style="margin:0; color:#a94442;">
//               <strong>Reason for Rejection:</strong><br/>
//               ${safeRejectionReason}
//             </p>
//           </div>

//           <p style="color:#555; line-height:1.6;">
//             <strong>Application ID:</strong> ${applicationId}<br/>
//             <strong>Verification Score:</strong> ${points}
//           </p>

//           <p style="color:#555; line-height:1.6;">
//             Our team is here to support you. A community growth representative will reach out to you within 
//             <strong>2–3 business days</strong> to guide you through the next steps and help complete your onboarding.
//           </p>

//           <p style="color:#555; line-height:1.6;">
//             In the meantime, you may review your submitted details and prepare any necessary documents to speed up the process.
//           </p>

//           <p style="color:#555; line-height:1.6;">
//             We look forward to helping you successfully join our platform.
//           </p>

//           <hr style="border:none; border-top:1px solid #eee; margin:30px 0;" />

//           <p style="font-size:13px; color:#888;">
//             If you have any questions, feel free to reply to this email. Our support team will be happy to assist you.
//           </p>

//           <p style="font-size:13px; color:#888;">
//             Best regards,<br/>
//             <strong>Mosaic Biz Hub Team</strong>
//           </p>
//         </div>
//       </div>
//     `,
//   };

//   await transporter.sendMail(mailOptions);
// };












// exports.sendVendorRejectionEmail = async ({
//   to,
//   vendorName,
//   applicationId,
//   points,
//   rejectionReason
// }) => {
//   const safeRejectionReason = rejectionReason || 'Your application did not meet the current verification requirements.';

//   const mailOptions = {
//     from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
//     to,
//     subject: "Vendor Application Update Required",
//     html: `
//       <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
//         <h2 style="color:#333;">Hello ${vendorName},</h2>
        
//         <p>Thank you for your interest in joining Mosaic Biz Hub.</p>
        
//         <p>After reviewing your application, we currently need additional information to complete your onboarding process. 

//         <p><strong>Reason for rejection:</strong> ${safeRejectionReason}</p>
        
//         <p><strong>Application ID:</strong> ${applicationId}</p>
        
//         <p>One of our community growth representatives will be in touch within 2-3 business days to help you complete the verification process.</p>
        
//         <p>Thank you for your patience.</p>
        
//         <p style="margin-top:30px;font-size:12px;color:#777;">
//           Best regards,<br>Mosaic Biz Hub Team
//         </p>
//       </div>
//     `,
//   };

//   await transporter.sendMail(mailOptions);
// };


exports.sendAdminVendorProfileCompletedEmail = async ({
  adminEmail,
  applicationId,
  businessName,
}) => {
  const safeAdminEmail = adminEmail || process.env.ADMIN_EMAIL;
  if (!safeAdminEmail) {
    throw new Error("ADMIN_EMAIL is not configured");
  }

  const safeApplicationId = applicationId || "N/A";
  const safeBusinessName = businessName || "N/A";
  const dashboardLink = buildFrontendUrl(`/admin/vendor-applications/${applicationId}`);

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to: safeAdminEmail,
    subject:
      "Vendor Profile Completed - Documentation Ready for Trust Badge Verification",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
        <h2 style="color:#333;">Dear Admin,</h2>

        <p>
          A vendor has completed their profile and documentation submission on <strong>Mosaic Biz Hub</strong>
          and is now ready for the Trust Badge verification process.
        </p>

        <p>
          The vendor has provided additional documentation and information required to validate their business credentials.
        </p>

        <p><strong>Vendor Details:</strong></p>
        <ul>
          <li><strong>Application Number:</strong> ${safeApplicationId}</li>
          <li><strong>Business Name:</strong> ${safeBusinessName}</li>
        </ul>

        <p>
          Please log in to the Admin Dashboard to review the submitted materials and complete the verification process.
          Once verified, the appropriate Trust Badge level can be assigned to the vendor.
        </p>

        <p><strong>Review Submission:</strong></p>
        <a href="${dashboardLink}"
           style="display:inline-block;margin-top:10px;padding:10px 16px;
           background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
           Admin Dashboard Link
        </a>

        <p style="margin-top:20px;">
          Maintaining timely verification helps ensure the integrity and reliability of the Mosaic Biz Hub marketplace.
        </p>

        <p style="margin-top:30px;font-size:12px;color:#777;">
          Best regards,<br/>
          Mosaic Biz Hub System Notification
        </p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};


exports.sendVendorTrustBadgeAssignedEmail = async ({
  to,
  vendorName,
  firstName,
  badgeName,
  badge,
}) => {
  const safeName = firstName || (vendorName ? vendorName.split(' ')[0] : 'there');
  const safeFirstName = esc(safeName);
  const badgeLabel = badgeName || badge;
  const safeBadgeName = badgeLabel ? esc(badgeLabel) : '';
  const profileUrl = buildFrontendUrl('/partners/dashboard');
  const ctaText = 'View Your Profile';
  const preheader = 'You’ve earned a new vendor badge on Mosaic Biz Hub!';
  const footerReason = 'You are receiving this email because a vendor badge was assigned to your profile on Mosaic Biz Hub.';

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      You’ve Earned a New Vendor Badge!
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Congratulations! You’ve earned a new vendor badge based on your verified information. It will appear on your profile, highlighting your strengths and attributes while building customer trust.
    </p>
    ${safeBadgeName ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-left:4px solid #7C3AED;border-radius:4px 8px 8px 4px;padding:16px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">
            <tr>
              <td style="width:120px;color:#6B7280;font-weight:500;">Badge Earned:</td>
              <td style="font-weight:700;color:#7C3AED;font-size:16px;">${safeBadgeName}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : ''}

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${profileUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            ${ctaText} &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "You’ve Earned a New Vendor Badge!",
    html,
  };

  return transporter.sendMail(mailOptions);
};


exports.sendAdminVendorCategoryRequestEmail = async ({
  adminEmail,
  requestId,
  businessName,
  requestedCategory,
}) => {
  const safeAdminEmail = adminEmail || process.env.ADMIN_EMAIL;
  if (!safeAdminEmail) {
    throw new Error("ADMIN_EMAIL is not configured");
  }

  const safeRequestId = requestId || "N/A";
  const safeBusinessName = businessName || "N/A";
  const safeRequestedCategory = requestedCategory || "N/A";

  const dashboardLink = buildFrontendUrl("/admin/category-requests");

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      New Vendor Category Request Submitted
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Dear Admin,
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      A vendor has submitted a new category request on <strong>Mosaic Biz Hub</strong>. The request requires your review and approval before the category can be added to the platform.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Vendor Request Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Request ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${esc(safeRequestId)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Business Name:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${esc(safeBusinessName)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Requested Category:</td>
              <td style="padding:4px 0;font-weight:600;color:#2563EB;">${esc(safeRequestedCategory)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${dashboardLink}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Review in Admin Dashboard &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub System Notification
    </p>
  `;

  const html = baseLayout({
    preheader: `New category request submitted: ${safeRequestedCategory}`,
    bodyHtml,
    footerReason: "You are receiving this notification as an administrator of Mosaic Biz Hub.",
  });

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to: safeAdminEmail,
    subject: "New Vendor Category Request Submitted",
    html,
  };

  return transporter.sendMail(mailOptions);
};

exports.sendVendorCategoryRequestSubmittedEmail = async ({
  to,
  firstName,
  vendorName,
  categoryName,
  subcategoryName,
  requestId,
}) => {
  const rawFirstName = firstName || (vendorName ? String(vendorName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const statusUrl = buildFrontendUrl("/partners/category-requests");
  const preheader = "We’ve received your category request. Our admin team will review it shortly.";
  const footerReason = "You are receiving this email because you submitted a category request on Mosaic Biz Hub.";

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Category Request Received
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      We’ve received your category request. Our admin team will review it shortly.
    </p>

    ${(categoryName || requestId) ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Request Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            ${requestId ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Request ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${esc(String(requestId))}</td>
            </tr>` : ''}
            ${categoryName ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Requested Category:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${esc(categoryName)}${subcategoryName ? ` / ${esc(subcategoryName)}` : ''}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Status:</td>
              <td style="padding:4px 0;font-weight:600;color:#D97706;">Pending Review</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : ''}

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${statusUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            View Request Status &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `We’ve received your category request. Our admin team will review it shortly.`,
    ``,
    `View Request Status: ${statusUrl}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].join("\n");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Category Request Received",
    html,
    text,
  };

  return transporter.sendMail(mailOptions);
};

exports.sendCustomerNewCategoryNotificationEmail = async ({
  to,
  firstName,
  customerName,
  categoryName,
  categorySlug,
}) => {
  const rawFirstName = firstName || (customerName ? String(customerName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeCategoryName = esc(categoryName || '');
  const exploreUrl = categorySlug
    ? buildFrontendUrl(`/category/${encodeURIComponent(categorySlug)}`)
    : buildFrontendUrl('/explore');
  const preheader = "A new category has been added to Mosaic Biz Hub! Explore fresh listings and discover new vendors today.";
  const footerReason = "You are receiving this email because you are a registered customer on Mosaic Biz Hub.";

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      New Category Now Available!
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      A new category has been added to Mosaic Biz Hub! Explore fresh listings and discover new vendors today.
    </p>

    ${safeCategoryName ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0 0 6px;">
            Newly Added Category:
          </p>
          <p style="font-family:Arial,sans-serif;font-size:18px;font-weight:700;color:#111827;margin:0;">
            ${safeCategoryName}
          </p>
        </td>
      </tr>
    </table>` : ''}

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${exploreUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Explore New Category &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `A new category has been added to Mosaic Biz Hub! Explore fresh listings and discover new vendors today.`,
    ``,
    `Explore New Category: ${exploreUrl}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].join("\n");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "New Category Now Available!",
    html,
    text,
  };

  return transporter.sendMail(mailOptions);
};

exports.sendVendorCategoryRequestRejectedEmail = async ({
  to,
  firstName,
  vendorName,
  categoryName,
  subcategoryName,
  adminReason,
  requestId,
}) => {
  const rawFirstName = firstName || (vendorName ? String(vendorName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeAdminReason = esc(adminReason || 'The requested category does not meet our current platform catalog guidelines.');
  const resubmitUrl = buildFrontendUrl("/partners/category-requests");
  const preheader = "Your category request was reviewed but could not be approved.";
  const footerReason = "You are receiving this email regarding your category request on Mosaic Biz Hub.";

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Your Category Request Was Not Approved
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Your category request was reviewed but could not be approved.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;border-collapse:collapse;">
      <tr>
        <td style="background:#FEF2F2;border:1px solid #FCA5A5;border-left:4px solid #DC2626;border-radius:6px;padding:16px 20px;">
          ${(categoryName || requestId) ? `
          <p style="font-family:Arial,sans-serif;font-size:13px;color:#6B7280;margin:0 0 8px;">
            ${categoryName ? `<strong>Category:</strong> ${esc(categoryName)}${subcategoryName ? ` / ${esc(subcategoryName)}` : ''}` : ''}
            ${requestId ? ` &bull; <strong>ID:</strong> ${esc(String(requestId))}` : ''}
          </p>` : ''}
          <p style="font-family:Arial,sans-serif;font-size:14px;color:#991B1B;margin:0;line-height:1.5;">
            <strong>Reason:</strong> ${safeAdminReason}
          </p>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.6;">
      If you’d like to revise and resubmit, we’re here to help.
    </p>

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${resubmitUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Resubmit Request &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `Your category request was reviewed but could not be approved.`,
    `Reason: ${adminReason || 'The requested category does not meet our current platform catalog guidelines.'}`,
    ``,
    `If you’d like to revise and resubmit, we’re here to help.`,
    ``,
    `Resubmit Request: ${resubmitUrl}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].join("\n");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Category Request Was Not Approved",
    html,
    text,
  };

  return transporter.sendMail(mailOptions);
};

exports.sendVendorCategoryRequestApprovedEmail = async ({
  to,
  firstName,
  vendorName,
  categoryName,
  subcategoryName,
  requestId,
}) => {
  const rawFirstName = firstName || (vendorName ? String(vendorName).split(' ')[0] : 'there');
  const safeFirstName = esc(rawFirstName);
  const safeCategoryName = esc(categoryName || '');
  const createListingUrl = buildFrontendUrl("/partners/dashboard");
  const preheader = "Great news — your category request has been approved and added to the marketplace.";
  const footerReason = "You are receiving this email regarding your category request on Mosaic Biz Hub.";

  const bodyHtml = `
    <h1 style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#111827;margin:0 0 12px;line-height:1.3;">
      Your Category Request Has Been Approved
    </h1>

    <p style="font-family:Arial,sans-serif;font-size:16px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Hi ${safeFirstName},
    </p>

    <p style="font-family:Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 20px;line-height:1.6;">
      Great news &mdash; your category request has been approved and added to the marketplace. You may now create listings under this new category.
    </p>

    ${(safeCategoryName || requestId) ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-collapse:collapse;">
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:20px 24px;">
          <p style="font-family:Arial,sans-serif;font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">
            Approved Category Details:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.8;">
            ${requestId ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Request ID:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${esc(String(requestId))}</td>
            </tr>` : ''}
            ${safeCategoryName ? `
            <tr>
              <td style="padding:4px 0;width:150px;color:#6B7280;">Approved Category:</td>
              <td style="padding:4px 0;font-weight:600;color:#111827;">${safeCategoryName}${subcategoryName ? ` / ${esc(subcategoryName)}` : ''}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;color:#6B7280;">Status:</td>
              <td style="padding:4px 0;font-weight:600;color:#15803D;">Approved &bull; Live in Marketplace</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : ''}

    <!-- CTA Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-collapse:collapse;">
      <tr>
        <td>
          <a href="${createListingUrl}"
             style="display:inline-block;background:#2563EB;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;">
            Create New Listing &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
      Thank you for being part of the Mosaic Biz Hub community.
    </p>

    <p style="font-family:Arial,sans-serif;font-size:14px;color:#6B7280;margin:0;line-height:1.6;">
      Mosaic Biz Hub
    </p>
  `;

  const html = baseLayout({
    preheader,
    bodyHtml,
    footerReason,
  });

  const text = [
    `Hi ${safeFirstName},`,
    ``,
    `Great news — your category request has been approved and added to the marketplace. You may now create listings under this new category.`,
    ``,
    `Create New Listing: ${createListingUrl}`,
    ``,
    `Thank you for being part of the Mosaic Biz Hub community.`,
    `Mosaic Biz Hub`,
  ].join("\n");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Category Request Has Been Approved",
    html,
    text,
  };

  return transporter.sendMail(mailOptions);
};
