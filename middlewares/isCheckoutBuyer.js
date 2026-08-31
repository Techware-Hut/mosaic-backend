const CHECKOUT_BUYER_ROLES = new Set(['customer', 'business_owner']);

module.exports = (req, res, next) => {
  if (!CHECKOUT_BUYER_ROLES.has(req.user?.role)) {
    return res.status(403).json({
      success: false,
      code: 'CHECKOUT_BUYER_REQUIRED',
      message: 'Access denied: Checkout buyers only',
    });
  }

  next();
};
