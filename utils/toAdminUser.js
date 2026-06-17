/**
 * Safe admin user shape for admin panel API responses.
 * Excludes credentials, OTP/reset metadata, provider IDs, and session internals.
 */
function toAdminUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    gender: user.gender,
    mobile: user.mobile,
    provider: user.provider,
    isOtpVerified: user.isOtpVerified,
    isBlocked: user.isBlocked,
    isDeleted: user.isDeleted,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = toAdminUser;
