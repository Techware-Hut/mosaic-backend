const { sendForbidden } = require('../utils/apiError');

module.exports = (req, res, next) => {
  if (req.user?.role !== 'business_owner') {
    return sendForbidden(req, res, 'Access denied: Business Owner only', {
      code: 'BUSINESS_OWNER_REQUIRED',
    });
  }
  next();
};
