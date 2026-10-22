const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboarding.controller.js'
);

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

test('createVerificationPayment reuses existing unpaid PaymentIntent idempotently', async () => {
  const originalRequire = Module.prototype.require;
  let stripeRetrievedId = null;
  let stripeCreated = false;

  const mockStripe = {
    paymentIntents: {
      retrieve: async (id) => {
        stripeRetrievedId = id;
        return {
          id,
          client_secret: `${id}_secret_test`,
          status: 'requires_payment_method',
        };
      },
      create: async () => {
        stripeCreated = true;
        return {
          id: 'pi_new_intent',
          client_secret: 'pi_new_intent_secret',
        };
      },
    },
  };

  const mockOnboarding = {
    userId: '507f1f77bcf86cd799439011',
    applicationId: 'MBH-APP-TEST-001',
    status: 'draft',
    verificationPayment: {
      status: 'pending',
      paymentIntentId: 'pi_existing_12345',
      paidAt: null,
    },
    save: async () => {},
  };

  const mockVendorOnboarding = {
    findOne: async () => mockOnboarding,
  };

  Module.prototype.require = function (id) {
    if (id === 'stripe') {
      return function () {
        return mockStripe;
      };
    }
    if (id === '../models/VendorOnboardingStage1' || id.endsWith('VendorOnboardingStage1')) {
      return mockVendorOnboarding;
    }
    return originalRequire.apply(this, arguments);
  };

  try {
    delete require.cache[controllerPath];
    const controller = require(controllerPath);

    const req = {
      user: { _id: '507f1f77bcf86cd799439011' },
    };
    const res = mockResponse();

    await controller.createVerificationPayment(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.clientSecret, 'pi_existing_12345_secret_test');
    assert.equal(stripeRetrievedId, 'pi_existing_12345');
    assert.equal(stripeCreated, false, 'Should NOT create a new PaymentIntent');
  } finally {
    Module.prototype.require = originalRequire;
    delete require.cache[controllerPath];
  }
});
