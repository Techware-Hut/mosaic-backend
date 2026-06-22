const Module = require('module');
const path = require('path');
const { captureOtp } = require('./otpCapture');

let originalLoad = null;
let stripeShouldFail = false;

function setStripeShouldFail(value) {
  stripeShouldFail = Boolean(value);
}

function createStripeClient() {
  const failIfRequested = () => {
    if (stripeShouldFail) {
      const err = new Error('Stripe provider unavailable (integration stub)');
      err.type = 'StripeConnectionError';
      throw err;
    }
  };

  return {
    paymentIntents: {
      create: async (params) => {
        failIfRequested();
        return {
          id: 'pi_integration_test',
          client_secret: 'pi_integration_test_secret',
          status: 'requires_payment_method',
          amount: params?.amount ?? 2000,
          currency: params?.currency || 'usd',
          metadata: params?.metadata || {},
        };
      },
      retrieve: async (id) => {
        failIfRequested();
        return {
          id: id || 'pi_integration_test',
          status: 'succeeded',
          amount: 2000,
          currency: 'usd',
          metadata: { type: 'vendor_verification' },
        };
      },
    },
    accounts: {
      create: async () => {
        failIfRequested();
        return { id: 'acct_integration_test' };
      },
      retrieve: async () => {
        failIfRequested();
        return {
          id: 'acct_integration_test',
          charges_enabled: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
          requirements: { currently_due: [] },
        };
      },
    },
    accountLinks: {
      create: async () => {
        failIfRequested();
        return { url: 'https://connect.stripe.com/setup/test/integration' };
      },
    },
    webhooks: {
      constructEvent: () => ({ type: 'test.event' }),
    },
  };
}

function createMailerStub() {
  return {
    sendOtpEmail: async (email, otp) => {
      captureOtp(email, otp);
    },
    sendWelcomeEmail: async () => {},
    sendPasswordResetOtpEmail: async () => {},
    sendVendorOnboardingAdminNotification: async () => {},
    sendVendorOnboardingVendorConfirmation: async () => {},
  };
}

function installProviderStubs() {
  if (originalLoad) {
    return;
  }

  originalLoad = Module._load;
  const mailerPath = path.normalize(
    path.join(__dirname, '../../../utils/mailer.js')
  );

  Module._load = function integrationMockLoad(request, parent, isMain) {
    if (request === 'stripe') {
      function StripeMock() {
        return createStripeClient();
      }
      StripeMock.Stripe = StripeMock;
      return StripeMock;
    }

    try {
      const resolved = Module._resolveFilename(request, parent);
      if (path.normalize(resolved) === mailerPath) {
        return createMailerStub();
      }
    } catch {
      // fall through
    }

    return originalLoad.call(this, request, parent, isMain);
  };
}

module.exports = {
  installProviderStubs,
  setStripeShouldFail,
  resetStripeStub: () => {
    stripeShouldFail = false;
  },
};
