const PUBLIC_MARKETPLACE_BUSINESS_FILTER = Object.freeze({
  isApproved: true,
  isActive: true,
});

const PUBLIC_MARKETPLACE_INELIGIBLE_MESSAGE =
  'This vendor is not approved and active for the public marketplace.';

function isPublicMarketplaceBusiness(business) {
  return Boolean(
    business &&
    business.isApproved === true &&
    business.isActive === true
  );
}

function publicMarketplaceBusinessFilter(extra = {}) {
  return {
    ...extra,
    ...PUBLIC_MARKETPLACE_BUSINESS_FILTER,
  };
}

function getPublicMarketplaceBusinessBlock(business, options = {}) {
  if (!business) {
    return {
      status: options.notFoundStatus || 404,
      message: options.notFoundMessage || 'Vendor business not found.',
    };
  }

  if (!isPublicMarketplaceBusiness(business)) {
    return {
      status: options.ineligibleStatus || 403,
      message: options.ineligibleMessage || PUBLIC_MARKETPLACE_INELIGIBLE_MESSAGE,
    };
  }

  return null;
}

module.exports = {
  PUBLIC_MARKETPLACE_BUSINESS_FILTER,
  PUBLIC_MARKETPLACE_INELIGIBLE_MESSAGE,
  isPublicMarketplaceBusiness,
  publicMarketplaceBusinessFilter,
  getPublicMarketplaceBusinessBlock,
};
