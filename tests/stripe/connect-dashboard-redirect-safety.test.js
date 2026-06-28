const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/stripe.controller.js');

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadController({ business = { _id: '507f1f77bcf86cd799439011', slug: 'launch-business' } } = {}) {
  const loginLinkCalls = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || request.replace(/\\/g, '/').includes('/stripe/')) {
      return class Stripe {
        constructor() {
          return {
            accounts: {
              createLoginLink: async (account, params) => {
                loginLinkCalls.push({ account, params });
                return { url: 'https://connect.stripe.com/express/test' };
              },
            },
          };
        }
      };
    }

    if (request.endsWith('utils/stripeConnectOwnership')) {
      return {
        assertConnectAccountOwnedByUser: async () => ({ ok: true, business }),
      };
    }

    if (request.endsWith('models/Business')) {
      return {};
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return {
    createExpressLoginLink: controller.createExpressLoginLink,
    getLoginLinkCalls: () => loginLinkCalls,
  };
}

function baseRequest(redirectUrl) {
  return {
    user: { id: '507f1f77bcf86cd799439012' },
    body: {
      account: 'acct_test_123',
      ...(redirectUrl !== undefined ? { redirect_url: redirectUrl } : {}),
    },
  };
}

test('createExpressLoginLink defaults dashboard return to the owned business finance page', async () => {
  const { createExpressLoginLink, getLoginLinkCalls } = loadController();
  const res = mockResponse();

  await createExpressLoginLink(baseRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(getLoginLinkCalls()[0].params.redirect_url, 'https://mosaicbizhub.com/partners/launch-business/finance');
});

test('createExpressLoginLink sanitizes unsafe dashboard redirect URLs', async () => {
  const { createExpressLoginLink, getLoginLinkCalls } = loadController();
  const res = mockResponse();

  await createExpressLoginLink(baseRequest('https://evil.example/steal'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(getLoginLinkCalls()[0].params.redirect_url, 'https://mosaicbizhub.com/partners/launch-business/finance');
});

test('createExpressLoginLink honors approved dashboard redirect URLs', async () => {
  const { createExpressLoginLink, getLoginLinkCalls } = loadController();
  const res = mockResponse();

  await createExpressLoginLink(
    baseRequest('https://mosaicbizhub.com/partners/launch-business/finance?tab=payouts'),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    getLoginLinkCalls()[0].params.redirect_url,
    'https://mosaicbizhub.com/partners/launch-business/finance?tab=payouts'
  );
});

test('createExpressLoginLink does not preserve legacy app redirect URLs by default', async () => {
  const { createExpressLoginLink, getLoginLinkCalls } = loadController();
  const res = mockResponse();

  await createExpressLoginLink(
    baseRequest('https://app.mosaicbizhub.com/partners/dashboard?tab=payout-setup'),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    getLoginLinkCalls()[0].params.redirect_url,
    'https://mosaicbizhub.com/partners/launch-business/finance'
  );
});
