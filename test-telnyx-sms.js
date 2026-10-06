require('dotenv').config();
const { sendSMS, sendOtpSMS, sendOrderNotificationSMS } = require('./utils/telnyxService');

// Ensure environment variables are loaded
if (!process.env.TELNYX_API_KEY) {
  console.warn('⚠️ TELNYX_API_KEY is not set in environment or .env file');
}

async function runLocalSmsTest() {
  // Pass your phone number as a command line argument, e.g.: node test-telnyx-sms.js +17572607200
  const targetPhone = process.argv[2] || '+17572607200';

  console.log('====================================================');
  console.log(`📱 Sending test SMS to: ${targetPhone}`);
  console.log(`📤 From Telnyx Number: ${process.env.TELNYX_PHONE_NUMBER}`);
  console.log('====================================================');

  console.log('\n1. Testing OTP SMS...');
  const otpResult = await sendOtpSMS({
    to: targetPhone,
    otp: '582914',
    appName: 'Mosaic Biz Hub',
  });
  console.log('OTP SMS Result:', otpResult);

  console.log('\n2. Testing Order Notification SMS...');
  const orderResult = await sendOrderNotificationSMS({
    to: targetPhone,
    orderNumber: 'MBH-9021',
    status: 'delivered',
    customerName: 'Test Customer',
  });
  console.log('Order SMS Result:', orderResult);

  console.log('\n====================================================');
  if (otpResult.success || orderResult.success) {
    console.log('✅ Telnyx SMS test executed successfully!');
  } else {
    console.log('❌ Telnyx SMS test failed. Check the error details above.');
  }
  console.log('====================================================');
}

runLocalSmsTest();
