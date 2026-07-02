// utils/emails/businessProfileEmails.js
const nodemailer = require('nodemailer');
const {
  buildSmtpTransportConfig,
  formatMosaicFromHeader,
} = require('./smtpTransport');

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
const sendBusinessProfileApprovalEmail = async (userEmail, userName, badge, totalPoints) => {
  try {
    const mailOptions = {
      from: formatMosaicFromHeader(),
      to: userEmail,
      subject: 'Business Profile Approved - Badge Assigned',
      html: `
        <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
          <h2 style="color:#28a745;">Congratulations! Your Business Profile is Approved</h2>
          <p>Dear ${userName},</p>
          
          <p>Your business profile has been successfully reviewed and approved.</p>
          
          <h3>Your Results:</h3>
          <ul>
            <li><strong>Badge Earned:</strong> ${badge}</li>
            <li><strong>Total Points:</strong> ${totalPoints}</li>
          </ul>
          
          <p>You can now access all features available for your tier and start listing your products/services.</p>
          
          <p style="margin-top:30px;font-size:12px;color:#777;">
            Best regards,<br>Mosaic Biz Hub Team
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Business profile approval email sent successfully');
    
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

