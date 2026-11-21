const Module = require('module');
const path = require('path');
const { captureOtp } = require('./otpCapture');

let originalLoad = null;
let stripeShouldFail = false;
let stripeRefundErrorCode = null;
let otpEmailFailCount = 0;
// Every stripe.refunds.create call, plus the refunds "Stripe" actually created.
// Like Stripe, a repeated idempotency key with the same params returns the
// original refund instead of creating another one.
let statusEmailCalls = [];
let cancelledSmsCalls = [];
let refundCalls = [];
let refundsByIdempotencyKey = new Map();

function setStripeShouldFail(value) {
  stripeShouldFail = Boolean(value);
}

function setOtpEmailFailCount(count) {
  otpEmailFailCount = Math.max(0, Number(count) || 0);
}

function resetOtpEmailFailCount() {
  otpEmailFailCount = 0;
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
    refunds: {
      create: async (params, options = {}) => {
        failIfRequested();
        if (stripeRefundErrorCode) throw Object.assign(new Error(stripeRefundErrorCode), { code: stripeRefundErrorCode });
        const idempotencyKey = options.idempotencyKey || null;
        refundCalls.push({ params, idempotencyKey });
        if (idempotencyKey && refundsByIdempotencyKey.has(idempotencyKey)) {
          const prior = refundsByIdempotencyKey.get(idempotencyKey);
          if (JSON.stringify(prior.params) !== JSON.stringify(params)) {
            const err = new Error('Keys for idempotent requests can only be used with the same parameters');
            err.type = 'StripeIdempotencyError';
            throw err;
          }
          return prior.refund;
        }
        const refund = {
          id: `re_integration_${refundCalls.length}`,
          object: 'refund',
          payment_intent: params?.payment_intent,
          amount: params?.amount,
          status: 'succeeded',
        };
        if (idempotencyKey) refundsByIdempotencyKey.set(idempotencyKey, { params, refund });
        return refund;
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
      if (otpEmailFailCount > 0) {
        otpEmailFailCount -= 1;
        const err = new Error('SMTP connection failed (integration stub)');
        err.code = 'EMAIL_DELIVERY_FAILED';
        throw err;
      }
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
    if (request.endsWith('utils/telnyxService')) {
      const actual = originalLoad.call(this, request, parent, isMain);
      return { ...actual, sendOrderCancelledCustomerSMS: async (...args) => { cancelledSmsCalls.push(args); } };
    }
    if (request.endsWith('utils/orderPhase')) return { sendOrderStatusEmail: async (...args) => { statusEmailCalls.push(args); return { messageId: 'synthetic' }; } };
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
  setStripeRefundErrorCode: (code) => { stripeRefundErrorCode = code; },
  setOtpEmailFailCount,
  resetOtpEmailFailCount,
  resetStripeStub: () => {
    stripeShouldFail = false;
    stripeRefundErrorCode = null;
    statusEmailCalls = [];
    cancelledSmsCalls = [];
    refundCalls = [];
    refundsByIdempotencyKey = new Map();
  },
  getCancelledSmsCalls: () => cancelledSmsCalls.slice(),
  getStatusEmailCalls: () => statusEmailCalls.slice(),
  getStripeRefundCalls: () => refundCalls.slice(),
  getStripeRefundsCreated: () =>
    new Set(refundCalls.map((c, i) => (c.idempotencyKey ? `key:${c.idempotencyKey}` : `call:${i}`))).size,
};
