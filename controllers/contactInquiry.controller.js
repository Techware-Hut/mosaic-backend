const ContactInquiry = require('../models/ContactInquiry');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
});

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
        from: `"Mosaic Biz Hub" <${process.env.MAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `New Contact Inquiry: ${subject}`,
        html: `
          <h2>New Contact Inquiry</h2>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phoneNo}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>How can we help:</strong></p>
          <p>${howCanWeHelp}</p>
          <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
        `,
      };

      await transporter.sendMail(mailOptions);
    } catch (emailError) {
      console.warn('Contact inquiry email sending failed:', emailError.message);
    }

    res.status(201).json({ 
      success: true, 
      message: 'Contact inquiry submitted successfully' 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false, 
      message: 'Failed to submit contact inquiry',
      error: err.message 
    });
  }
};
