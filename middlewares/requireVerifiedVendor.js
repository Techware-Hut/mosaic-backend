const VendorOnboarding = require('../models/VendorOnboardingStage1');
const { sendForbidden, sendUnauthorized } = require('../utils/apiError');

function createRequireVerifiedVendor(options = {}) {
  const { requireStage1Verified = false } = options;

  return async function requireVerifiedVendor(req, res, next) {
    const user = req.user;

    if (!user) {
      return sendUnauthorized(req, res, 'Unauthorized', {
        code: 'AUTHENTICATION_REQUIRED',
      });
    }

    if (user.role !== 'business_owner') {
      return sendForbidden(req, res, 'Only vendors allowed', {
        code: 'VENDOR_REQUIRED',
      });
    }

    if (!user.isOtpVerified) {
      return sendForbidden(req, res, 'OTP verification required', {
        code: 'OTP_VERIFICATION_REQUIRED',
      });
    }

    if (user.isBlocked) {
      return sendForbidden(req, res, 'Account is blocked', {
        code: 'ACCOUNT_BLOCKED',
      });
    }

    if (user.isDeleted) {
      return sendForbidden(req, res, 'Account is deleted', {
        code: 'ACCOUNT_DELETED',
      });
    }

    if (requireStage1Verified) {
      const onboarding = await VendorOnboarding.findOne({ userId: user._id })
        .select('status')
        .lean();

      if (!onboarding || onboarding.status !== 'verified') {
        return sendForbidden(req, res, 'Stage 1 vendor verification required', {
          code: 'STAGE1_VERIFICATION_REQUIRED',
        });
      }
    }

    next();
  };
}

module.exports = createRequireVerifiedVendor();
module.exports.create = createRequireVerifiedVendor;
