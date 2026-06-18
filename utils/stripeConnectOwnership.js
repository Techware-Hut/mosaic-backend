const Business = require('../models/Business');

async function assertConnectAccountOwnedByUser(accountId, userId) {
  if (!accountId) {
    return { ok: false, status: 400, message: 'Missing connected account id' };
  }

  const business = await Business.findOne({
    stripeConnectAccountId: accountId,
    owner: userId,
  }).select('_id owner stripeConnectAccountId');

  if (!business) {
    return {
      ok: false,
      status: 403,
      message: 'Not allowed to access this Connect account.',
    };
  }

  return { ok: true, business };
}

module.exports = { assertConnectAccountOwnedByUser };
