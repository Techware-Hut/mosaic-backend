const otpByEmail = new Map();

function captureOtp(email, otp) {
  otpByEmail.set(String(email).toLowerCase(), String(otp));
}

function getCapturedOtp(email) {
  return otpByEmail.get(String(email).toLowerCase());
}

function resetOtpCapture() {
  otpByEmail.clear();
}

module.exports = { captureOtp, getCapturedOtp, resetOtpCapture };
