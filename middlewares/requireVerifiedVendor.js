const VendorOnboarding = require('../models/VendorOnboardingStage1');

function createRequireVerifiedVendor(options = {}) {
  const { requireStage1Verified = false } = options;

  return async function requireVerifiedVendor(req, res, next) {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (user.role !== 'business_owner') {
      return res.status(403).json({ message: 'Only vendors allowed' });
    }

    if (!user.isOtpVerified) {
      return res.status(403).json({ message: 'OTP verification required' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account is blocked' });
    }

    if (user.isDeleted) {
      return res.status(403).json({ message: 'Account is deleted' });
    }

    if (requireStage1Verified) {
      const onboarding = await VendorOnboarding.findOne({ userId: user._id })
        .select('status')
        .lean();

      if (!onboarding || onboarding.status !== 'verified') {
        return res.status(403).json({
          message: 'Stage 1 vendor verification required',
        });
      }
    }

    next();
  };
}

module.exports = createRequireVerifiedVendor();
module.exports.create = createRequireVerifiedVendor;
