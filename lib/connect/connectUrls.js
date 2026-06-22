/** Build RETURN/REFRESH URLs with businessId appended for Stripe Connect onboarding. */
function buildConnectRedirectUrl(base, businessId) {
  const url = new URL(base);
  url.searchParams.set('businessId', businessId);
  return url.toString();
}

function getReturnAndRefreshUrls(businessId, env = process.env) {
  const frontend = env.FRONTEND_URL;
  const returnPath = env.CONNECT_RETURN_PATH || '/partners/connect/return';
  const refreshPath = env.CONNECT_REFRESH_PATH || '/partners/connect/refresh';

  const returnBase = env.CONNECT_RETURN_URL || `${frontend}${returnPath}`;
  const refreshBase = env.CONNECT_REFRESH_URL || `${frontend}${refreshPath}`;

  return {
    returnUrl: buildConnectRedirectUrl(returnBase, businessId),
    refreshUrl: buildConnectRedirectUrl(refreshBase, businessId),
  };
}

module.exports = {
  buildConnectRedirectUrl,
  getReturnAndRefreshUrls,
};
