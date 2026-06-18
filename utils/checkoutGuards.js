/**
 * Business eligibility checks for customer checkout (Connect destination charge).
 */

function getBusinessCheckoutBlock(business) {
  if (!business) {
    return {
      status: 404,
      message: 'Vendor business not found.',
    };
  }

  if (business.isApproved === false) {
    return {
      status: 403,
      message: 'This vendor is not approved for checkout.',
    };
  }

  if (business.isActive === false) {
    return {
      status: 403,
      message: 'This vendor is temporarily unavailable for checkout.',
    };
  }

  if (!business.stripeConnectAccountId) {
    return {
      status: 400,
      message: 'Vendor is not connected to Stripe.',
    };
  }

  return null;
}

module.exports = {
  getBusinessCheckoutBlock,
};
