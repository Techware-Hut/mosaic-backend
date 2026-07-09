const nodemailer = require('nodemailer');
const { buildFrontendUrl, getFrontendLogoUrl } = require('./frontendUrl');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');

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
  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: 'Welcome to Mosaic Biz Hub!',
    html: `
      <div style="font-family: Arial, sans-serif; text-align: center; background-color: #f9f9f9; padding: 20px;">
        <img src="cid:platformLogo" alt="Mosaic Biz Hub Logo" style="max-width: 150px; margin-bottom: 20px;">
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
    attachments: [
      {
        filename: 'logo.png',
        path: getFrontendLogoUrl(),
        cid: 'platformLogo', // same CID as used in the <img src="cid:...">
      }
    ]
  };

  return transporter.sendMail(mailOptions);
};



exports.sendAdminOnboardingSubmissionEmail = async ({
  adminEmail,
  applicationId,
  businessName,
  vendorName,
}) => {
  const submissionDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to: adminEmail,
    subject: `New Vendor Application Submitted – Review Required (Application #${applicationId})`,
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
        <h2 style="color:#333;">Dear Admin,</h2>

        <p>
          A new vendor application has been successfully submitted on <strong>Mosaic Biz Hub</strong> and is awaiting your review.
        </p>

        <p><strong>Application Details:</strong></p>
        <ul>
          <li><strong>Application Number:</strong> ${applicationId}</li>
          <li><strong>Business Name:</strong> ${businessName}</li>
          <li><strong>Submission Date:</strong> ${submissionDate}</li>
        </ul>

        <p>
          Please log in to the Admin Dashboard to review the submitted application and proceed with the verification process.
        </p>

        <a href="${buildFrontendUrl(`/admin/vendor-applications/${applicationId}`)}"
           style="display:inline-block;margin-top:16px;padding:10px 16px;
           background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
           Access Admin Dashboard
        </a>

        <p style="margin-top:30px;font-size:12px;color:#777;">
          Best regards,<br/>
          Mosaic Biz Hub System Notification
        </p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};


exports.sendVendorSubmissionConfirmationEmail = async ({
  to,
  vendorName,
  applicationId,
}) => {
  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Mosaic Biz Hub Application Is Under Review",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
        <h2 style="color:#333;">Hi ${vendorName},</h2>

        <p>
          Thank you for applying to Mosaic Biz Hub. Your information is under review.
          We’ll email next steps within <strong>3–5 business days</strong>.
        </p>

        <p><strong>Application ID:</strong> ${applicationId}</p>

        <p style="margin-top:20px;">
          If you have questions, contact us at
          <a href="mailto:info@mosaicbizhub.com">info@mosaicbizhub.com</a>
        </p>

        <p style="margin-top:30px;font-size:12px;color:#777;">
          Mosaic Biz Hub Team
        </p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};


exports.sendVendorApprovedEmail = async ({
  to,
  vendorName,
  applicationId,
}) => {
  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Business Has Been Successfully Verified 🎉",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
        <h2 style="color:#28a745;">Congratulations, ${vendorName}!</h2>

        <p>
          Your business has successfully passed our initial verification process.
          You’re now eligible to choose your subscription tier and complete
          your profile.
        </p>

        <p><strong>Application ID:</strong> ${applicationId}</p>

        <a href="${buildFrontendUrl('/login?type=vendor')}"
           style="display:inline-block;margin-top:16px;padding:12px 20px;
           background:#28a745;color:#fff;text-decoration:none;border-radius:4px;">
            Continue Onboarding
        </a>

        <p style="margin-top:30px;font-size:12px;color:#777;">
          Welcome to the Mosaic Biz Hub community!
        </p>
      </div>
    `,
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
  currentStatus = 'rejected',
  documentsNeeded,
  responseWindowDays,
}) => {
  return exports.sendVendorVerificationGuidanceEmail({
    to,
    vendorName,
    businessName,
    applicationId,
    currentStatus,
    outcome: 'missing_documents',
    reason: rejectionReason,
    documentsNeeded,
    responseWindowDays,
  });
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
  badgeName,
}) => {
  const dashboardLink = buildFrontendUrl("/login?type=vendor");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to,
    subject: "Your Trust Badge Has Been Verified and Activated",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
        <h2 style="color:#333;">Dear ${vendorName},</h2>

        <p>
          We are pleased to inform you that your submitted documentation has been successfully verified.
        </p>

        <p>
          Your Trust Badge verification process is now complete, and your account has been upgraded to the 
          <strong>“${badgeName} Trust Badge.”</strong>
        </p>

        <p>
          This badge will reflect on your vendor profile immediately, helping buyers identify your business
          as a verified and trusted member of the Mosaic Biz Hub marketplace.
        </p>

        <p>
          Your badge enhances your credibility and visibility within our ecosystem, allowing customers
          to engage with your business with greater confidence.
        </p>

        <p>You can view the update by logging into your vendor dashboard.</p>

        <a href="${dashboardLink}"
           style="display:inline-block;margin-top:16px;padding:12px 20px;
           background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
           Access Your Vendor Account
        </a>

        <p style="margin-top:30px;font-size:12px;color:#777;">
          Thank you for being a valued part of the Mosaic Biz Hub community.
        </p>

        <p style="margin-top:20px;font-size:12px;color:#777;">
          Best regards,<br/>
          Mosaic Biz Hub Team
        </p>
      </div>
    `,
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
  // const safeBusinessName = businessName || "N/A";
  const safeRequestedCategory = requestedCategory || "N/A";

  const dashboardLink = buildFrontendUrl("/admin/category-requests");

  const mailOptions = {
    from: formatMosaicFromHeader(),
    to: safeAdminEmail,
    subject: "New Vendor Category Request Submitted",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
        <h2 style="color:#333;">Dear Admin,</h2>

        <p>
          A vendor has submitted a new category request on <strong>Mosaic Biz Hub</strong>.
          The request requires your review and approval before the category can be added to the platform.
        </p>

        <p><strong>Vendor Request Details:</strong></p>
        <ul>
          <li><strong>Request ID:</strong> ${safeRequestId}</li>
          <li><strong>Business Name:</strong> ${safeBusinessName}</li>
          <li><strong>Requested Category:</strong> ${safeRequestedCategory}</li>
        </ul>

        <p>
          Please log in to the Admin Dashboard to review the request and take appropriate action.
        </p>

        <p><strong>Review Request:</strong></p>
        <a href="${dashboardLink}"
           style="display:inline-block;margin-top:10px;padding:10px 16px;
           background:#0d6efd;color:#fff;text-decoration:none;border-radius:4px;">
           Admin Dashboard Link
        </a>

        <p style="margin-top:20px;">
          Timely review ensures the platform remains organized and vendors can offer their products or services efficiently.
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
