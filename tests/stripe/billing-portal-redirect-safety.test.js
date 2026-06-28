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
