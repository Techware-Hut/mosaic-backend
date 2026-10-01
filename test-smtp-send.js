// Live preview test — OTP + Welcome email
require('dotenv').config();
const nodemailer = require('nodemailer');
const { buildSmtpTransportConfig, formatMosaicFromHeader } = require('./utils/smtpTransport');
const { baseLayout, esc } = require('./utils/emailTemplates/baseLayout');

// Import the actual mailer functions we just updated
const mailer = require('./utils/mailer');

async function main() {
  console.log('Sending OTP registration email preview...');
  await mailer.sendOtpEmail('doneraosatish@gmail.com', '847291', 'register', 'Satish');
  console.log('✅ OTP email sent!\n');

  console.log('Sending Welcome (customer) email preview...');
  await mailer.sendWelcomeEmail('doneraosatish@gmail.com', 'Satish', 'customer');
  console.log('✅ Welcome (customer) email sent!\n');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
