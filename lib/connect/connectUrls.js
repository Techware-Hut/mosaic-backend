const {
  DEFAULT_FRONTEND_URL,
  buildFrontendUrl,
  getFrontendBaseUrl,
  normalizeFrontendUrl,
} = require('../../utils/frontendUrl');

function resolveConnectBase(explicitUrl, fallbackPath, env = process.env) {
  const baseUrl = getFrontendBaseUrl(env);

  if (explicitUrl) {
    try {
      const parsed = new URL(String(explicitUrl).trim());
      // When the backend is configured for a non-apex staging or preview frontend
      // (e.g. RELEASE_ENVIRONMENT=staging or FRONTEND_URL points to a preview),
      // do not allow an explicit CONNECT_RETURN_URL pointing to the production apex
      // domain to hijack Connect redirects back to production.
      if (baseUrl !== DEFAULT_FRONTEND_URL && parsed.origin === DEFAULT_FRONTEND_URL) {
        return buildFrontendUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`, env);
      }
    } catch {
      // invalid URL will be handled by normalizeFrontendUrl
    }
    return normalizeFrontendUrl(explicitUrl, env);
  }

  return buildFrontendUrl(fallbackPath, env);
}

/** Build RETURN/REFRESH URLs with businessId appended for Stripe Connect onboarding. */
function buildConnectRedirectUrl(base, businessId, env = process.env) {
  const url = new URL(normalizeFrontendUrl(base, env));
  url.searchParams.set('businessId', businessId);
  return url.toString();
}

function getReturnAndRefreshUrls(businessId, env = process.env) {
  const returnPath = env.CONNECT_RETURN_PATH || '/partners/connect/return';
  const refreshPath = env.CONNECT_REFRESH_PATH || '/partners/connect/refresh';

  const returnBase = resolveConnectBase(env.CONNECT_RETURN_URL, returnPath, env);
  const refreshBase = resolveConnectBase(env.CONNECT_REFRESH_URL, refreshPath, env);

  return {
    returnUrl: buildConnectRedirectUrl(returnBase, businessId, env),
    refreshUrl: buildConnectRedirectUrl(refreshBase, businessId, env),
  };
}

module.exports = {
  buildConnectRedirectUrl,
  getReturnAndRefreshUrls,
  resolveConnectBase,
};
