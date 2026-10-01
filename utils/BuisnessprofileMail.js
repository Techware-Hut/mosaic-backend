// utils/emails/businessProfileEmails.js
const nodemailer = require('nodemailer');
const { buildFrontendUrl } = require('./frontendUrl');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');
const { baseLayout, esc } = require('./emailTemplates/baseLayout');

const transporter = nodemailer.createTransport(buildSmtpTransportConfig());

// Send business profile review notification to admin
const sendBusinessProfileReviewEmail = async (userEmail, userName, profileId) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@mosaicbizhub.com';
    
    const mailOptions = {
      from: formatMosaicFromHeader(),
      to: adminEmail,
      subject: 'New Business Profile Submitted for Review - Step 3',
      html: `
        <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
          <h2 style="color:#333;">Business Profile Review Required</h2>
          <p>A new business profile has been submitted for Step 3 verification.</p>
          
          <h3>Details:</h3>
          <ul>
            <li><strong>User:</strong> ${userName}</li>
            <li><strong>Email:</strong> ${userEmail}</li>
            <li><strong>Profile ID:</strong> ${profileId}</li>
            <li><strong>Submission Time:</strong> ${new Date().toLocaleString()}</li>
          </ul>
          
          <h3>Action Required:</h3>
          <p>Please review the business profile and verify the 7 step questions to allocate points.</p>
          
          <h3>Point Distribution:</h3>
          <ul>
            <li>Questions 1-3: 5 points each</li>
            <li>Questions 4-5: 10 points each</li>
            <li>Questions 6-7: 5 points each</li>
          </ul>
          
          <p style="margin-top:30px;font-size:12px;color:#777;">
            Mosaic Biz Hub System
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Business profile review email sent successfully');
    
  } catch (error) {
    console.error('Failed to send business profile review email:', error);
    throw error;
  }
};

// Send approval notification to user
const sendBusinessProfileApprovalEmail = async (userEmailOrOpts, userNameArg, badgeArg, totalPointsArg) => {
  try {
    const isObject = typeof userEmailOrOpts === 'object' && userEmailOrOpts !== null;
    const to = isObject ? (userEmailOrOpts.to || userEmailOrOpts.userEmail || userEmailOrOpts.email) : userEmailOrOpts;
    const rawName = isObject ? (userEmailOrOpts.firstName || userEmailOrOpts.userName || userEmailOrOpts.vendorName || userEmailOrOpts.name) : userNameArg;
    const badge = isObject ? (userEmailOrOpts.badge || userEmailOrOpts.badgeName) : badgeArg;
    const totalPoints = isObject ? (userEmailOrOpts.totalPoints || userEmailOrOpts.points) : totalPointsArg;

    const safeFirstName = esc(rawName ? rawName.split(' ')[0] : 'there');
    const safeBadgeName = badge ? esc(badge) : '';
    const profileUrl = buildFrontendUrl('/partners/dashboard');
    const ctaText = 'View Your Profile';
    const preheader = 'You’ve earned a new vendor badge on Mosaic Biz Hub!';
    const footerReason = 'You are receiving this email because your business profile and verification details were reviewed and approved on Mosaic Biz Hub.';

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
                <td style="font-weight:700;color:#7C3AED;font-size:16px;">${safeBadgeName}${totalPoints ? ` (${esc(totalPoints)} pts)` : ''}</td>
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
      subject: 'You’ve Earned a New Vendor Badge!',
      html,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Business profile badge approval email sent successfully');
    return result;
  } catch (error) {
    console.error('Failed to send business profile approval email:', error);
    throw error;
  }
};
// Send question verification notification to vendor
const sendQuestionVerificationEmail = async (userEmail, userName, questionNumber, points) => {
  try {
    const mailOptions = {
      from: formatMosaicFromHeader(),
      to: userEmail,
      subject: 'Business Profile Question Verified',
      html: `
        <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
          <h2 style="color:#28a745;">Great News, ${userName}!</h2>
          
          <p>One of your business profile questions has been verified by our admin team.</p>
          
          <h3>Verification Details:</h3>
          <ul>
            <li><strong>Question Number:</strong> ${questionNumber}</li>
            <li><strong>Points Awarded:</strong> ${points}</li>
            <li><strong>Status:</strong> ✅ Verified</li>
          </ul>
          
          <p>Your business profile review is in progress. You'll receive a final notification once all questions are reviewed and your badge is assigned.</p>
          
          <p style="margin-top:30px;font-size:12px;color:#777;">
            Best regards,<br>Mosaic Biz Hub Team
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Question verification email sent successfully');
    
  } catch (error) {
    console.error('Failed to send question verification email:', error);
    throw error;
  }
};

// Add to module.exports
module.exports = {
  sendBusinessProfileReviewEmail,
  sendBusinessProfileApprovalEmail,
  sendQuestionVerificationEmail  // Add this
};

