const ContactInquiry = require('../models/ContactInquiry');
const nodemailer = require('nodemailer');
const {
  createMosaicTransport,
  formatMosaicFromHeader,
} = require('../utils/smtpTransport');

const transporter = createMosaicTransport(nodemailer);

// Contact form input is untrusted: escape it before it goes into admin email HTML.
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Header values must be single-line.
const toHeaderText = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

exports.createContactInquiry = async (req, res) => {
  try {
    const { firstName, lastName, email, phoneNo, subject, howCanWeHelp } = req.body;

    const contactInquiry = new ContactInquiry({
      firstName,
      lastName,
      email,
      phoneNo,
      subject,
      howCanWeHelp,
    });

    await contactInquiry.save();

    // Try to send email to admin (don't fail if email fails)
    try {
      const mailOptions = {
        from: formatMosaicFromHeader(),
        to: process.env.ADMIN_EMAIL,
        subject: toHeaderText(`New Contact Inquiry: ${subject}`),
        html: `
          <h2>New Contact Inquiry</h2>
          <p><strong>Name:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(phoneNo)}</p>
          <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
          <p><strong>How can we help:</strong></p>
          <p style="white-space:pre-wrap">${escapeHtml(howCanWeHelp)}</p>
          <p><strong>Submitted at:</strong> ${escapeHtml(new Date().toLocaleString())}</p>
        `,
      };

      await transporter.sendMail(mailOptions);
    } catch (emailError) {
      console.warn('Contact inquiry email sending failed');
    }

    res.status(201).json({ 
      success: true, 
      message: 'Contact inquiry submitted successfully' 
    });
  } catch (err) {
    // Never echo internal error text to the client.
    if (err?.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        code: 'CONTACT_INQUIRY_INVALID',
        message: 'Please fill in all required fields.',
      });
    }
    console.error('Contact inquiry save failed');
    return res.status(500).json({
      success: false,
      code: 'CONTACT_INQUIRY_FAILED',
      message: 'Failed to submit contact inquiry. Please try again.',
    });
  }
};
