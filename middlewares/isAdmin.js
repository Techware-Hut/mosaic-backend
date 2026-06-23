const { sendForbidden } = require('../utils/apiError');

module.exports = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return sendForbidden(req, res, 'Access denied: Admin only', {
      code: 'ADMIN_REQUIRED',
    });
  }
  next();
};
