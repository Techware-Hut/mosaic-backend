const {
  getPublicMarketplaceBusinessBlock,
} = require('../lib/marketplace/businessEligibility');

function getBusinessCheckoutBlock(business) {
  const marketplaceBlock = getPublicMarketplaceBusinessBlock(business, {
    ineligibleMessage:
      'This vendor is not approved and active for checkout.',
  });
  if (marketplaceBlock) return marketplaceBlock;

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
