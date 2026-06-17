/**
 * Safe public user shape for auth JSON responses.
 * Excludes passwordHash, OTP, reset fields, session metadata, and provider IDs.
 */
function toPublicAuthUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    gender: user.gender,
    mobile: user.mobile,
    isOtpVerified: user.isOtpVerified,
  };
}

module.exports = toPublicAuthUser;
