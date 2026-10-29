const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/billing.controller.js');
const businessId = '507f1f77bcf86cd799439011';

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

function loadController() {
  const sessionCalls = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || request.replace(/\\/g, '/').includes('/stripe/')) {
      return class Stripe {
        constructor() {
          return {
            billingPortal: {
              sessions: {
                create: async (params) => {
                  sessionCalls.push(params);
                  return { url: 'https://billing.stripe.com/session/test' };
                },
              },
            },
          };
        }
      };
    }

    if (request.endsWith('models/Business')) {
      return {
        findById: async () => ({
          _id: businessId,
          stripeCustomerId: 'cus_test_123',
        }),
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return {
    createBillingPortalSessionForBusiness: controller.createBillingPortalSessionForBusiness,
    getSessionCalls: () => sessionCalls,
  };
}

function baseRequest(returnUrl) {
  return {
    body: {
      businessId,
      ...(returnUrl !== undefined ? { return_url: returnUrl } : {}),
    },
  };
}

test('billing portal defaults return_url to the partner my-account route', async () => {
  const { createBillingPortalSessionForBusiness, getSessionCalls } = loadController();
  const res = mockResponse();

  await createBillingPortalSessionForBusiness(baseRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(
    getSessionCalls()[0].return_url,
    'https://mosaicbizhub.com/partners/507f1f77bcf86cd799439011/my-account'
  );
});

test('billing portal sanitizes unsafe return_url values', async () => {
  const { createBillingPortalSessionForBusiness, getSessionCalls } = loadController();
  const res = mockResponse();

  await createBillingPortalSessionForBusiness(baseRequest('https://evil.example/billing'), res);

  assert.equal(res.statusCode, 200);
  assert.equal(
    getSessionCalls()[0].return_url,
    'https://mosaicbizhub.com/partners/507f1f77bcf86cd799439011/my-account'
  );
});

test('billing portal honors approved return_url values', async () => {
  const { createBillingPortalSessionForBusiness, getSessionCalls } = loadController();
  const res = mockResponse();

  await createBillingPortalSessionForBusiness(
    baseRequest('https://mosaicbizhub.com/partners/507f1f77bcf86cd799439011/my-account?billing=updated'),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    getSessionCalls()[0].return_url,
    'https://mosaicbizhub.com/partners/507f1f77bcf86cd799439011/my-account?billing=updated'
  );
});

for (const frontend of ['https://app.mosaicbizhub.com', 'https://mosaic-biz-frontend-launch.vercel.app']) {
  test('STG004 billing hands the Stripe stub only the selected staging destination ' + frontend, async () => {
    const keys = ['NODE_ENV', 'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'CANONICAL_FRONTEND_URL', 'PUBLIC_FRONTEND_URL', 'NEXT_PUBLIC_APP_URL', 'FRONTEND_URL', 'APP_URL', 'BILLING_PORTAL_RETURN_URL'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      keys.forEach(key => delete process.env[key]);
      process.env.NODE_ENV = 'production'; process.env.RELEASE_ENVIRONMENT = 'staging'; process.env.FRONTEND_URL = frontend;
      process.env.BILLING_PORTAL_RETURN_URL = 'https://mosaicbizhub.com/unsafe-stale';
      const { createBillingPortalSessionForBusiness, getSessionCalls } = loadController();
      for (const input of [undefined, 'https://evil.example/steal', 'https://mosaicbizhub.com/after', frontend + '/partners/' + businessId + '/my-account?billing=updated']) {
        const res = mockResponse();
        await createBillingPortalSessionForBusiness(baseRequest(input), res);
        assert.equal(res.statusCode, 200);
        const url = new URL(getSessionCalls().at(-1).return_url);
        assert.equal(url.origin, frontend);
        assert.equal(url.pathname, '/partners/' + businessId + '/my-account');
        assert.equal(url.searchParams.get('billing'), input?.startsWith(frontend) ? 'updated' : null);
      }
      assert.equal(getSessionCalls().length, 4);
    } finally {
      keys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
      delete require.cache[controllerPath];
    }
  });
}
