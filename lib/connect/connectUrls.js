const { buildFrontendUrl, normalizeFrontendUrl } = require('../../utils/frontendUrl');

/** Build RETURN/REFRESH URLs with businessId appended for Stripe Connect onboarding. */
function buildConnectRedirectUrl(base, businessId, env = process.env) {
  const url = new URL(normalizeFrontendUrl(base, env));
  url.searchParams.set('businessId', businessId);
  return url.toString();
}

function getReturnAndRefreshUrls(businessId, env = process.env) {
  const returnPath = env.CONNECT_RETURN_PATH || '/partners/connect/return';
  const refreshPath = env.CONNECT_REFRESH_PATH || '/partners/connect/refresh';

  const returnBase = env.CONNECT_RETURN_URL || buildFrontendUrl(returnPath, env);
  const refreshBase = env.CONNECT_REFRESH_URL || buildFrontendUrl(refreshPath, env);

  return {
    returnUrl: buildConnectRedirectUrl(returnBase, businessId, env),
    refreshUrl: buildConnectRedirectUrl(refreshBase, businessId, env),
  };
}

module.exports = {
  buildConnectRedirectUrl,
  getReturnAndRefreshUrls,
};
