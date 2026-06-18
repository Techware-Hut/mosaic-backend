const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const orderControllerPath = path.resolve(__dirname, '../../controllers/orderController.js');

const vendorId = '507f1f77bcf86cd799439011';
const businessId = '507f1f77bcf86cd799439012';
const productId = '507f1f77bcf86cd799439013';
const variantId = '507f1f77bcf86cd799439014';
const userId = '507f1f77bcf86cd799439015';
const connectAccountId = 'acct_test_connect_001';

const defaultShipping = {
  deliverySpeed: 'standard',
  amount: 5,
  method: 'flat_rate',
  freeShippingApplied: false,
  freeShippingThreshold: null,
  matchedTier: null,
};

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

function buildVariant(overrides = {}) {
  const owner = overrides.ownerId || vendorId;
  const biz = overrides.businessId || businessId;
  return {
    _id: variantId,
    ownerId: { toString: () => owner },
    businessId: biz,
    sku: 'SKU-TEST',
    allowBackorder: false,
    sizes: [
      {
        size: 'M',
        stock: 10,
        price: overrides.price ?? 25,
        salePrice: null,
        sku: 'SKU-M',
      },
    ],
    productId: {
      _id: { toString: () => productId },
      title: 'Test Product',
      ...(overrides.productId || {}),
    },
    ...overrides.variantExtra,
  };
}

function buildBusiness(overrides = {}) {
  return {
    _id: businessId,
    email: 'vendor@example.com',
    isApproved: overrides.isApproved ?? true,
    isActive: overrides.isActive ?? true,
    stripeConnectAccountId: overrides.stripeConnectAccountId ?? connectAccountId,
    taxSettings: {},
    shippingSettings: { method: 'flat_rate', flatRate: { standard: 5 } },
    save: async function save() {
      return this;
    },
    ...overrides,
  };
}

function buildStripeAccount(overrides = {}) {
  return {
    charges_enabled: overrides.charges_enabled ?? true,
    payouts_enabled: overrides.payouts_enabled ?? true,
    capabilities: {
      card_payments: 'active',
      transfers: overrides.transfers ?? 'active',
    },
  };
}

function loadInitiateOrder({
  business = buildBusiness(),
  stripeAccount = buildStripeAccount(),
  variants = [buildVariant()],
  variantById = null,
  piCreateError = null,
  shippingResult = defaultShipping,
  taxPricing = { priceExclTax: 25, priceInclTax: 25 },
} = {}) {
  const piCreateCalls = [];
  const accountRetrieveCalls = [];

  const stripeMock = {
    accounts: {
      retrieve: async (accountId) => {
        accountRetrieveCalls.push(accountId);
        return stripeAccount;
      },
    },
    paymentIntents: {
      create: async (params, options) => {
        if (piCreateError) {
          throw piCreateError;
        }
        piCreateCalls.push({ params, options });
        return {
          id: 'pi_test_001',
          client_secret: 'pi_test_001_secret_test',
        };
      },
    },
  };

  let savedOrderPayload = null;
  let orderIdCounter = 0;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || (request.includes('node_modules') && request.replace(/\\/g, '/').includes('/stripe/'))) {
      return class Stripe {
        constructor() {
          return stripeMock;
        }
      };
    }
    if (request === 'uuid') {
      return { v4: () => 'group-order-test-uuid' };
    }
    if (request.endsWith('models/Order')) {
      return class Order {
        constructor(payload) {
          Object.assign(this, payload);
          this._id = { toString: () => `order_${++orderIdCounter}` };
        }
        async save() {
          savedOrderPayload = { ...this };
          return this;
        }
      };
    }
    if (request.endsWith('models/ProductVariant')) {
      return {
        findById: (id) => ({
          populate: async () => {
            if (variantById) {
              return variantById(id);
            }
            const match = variants.find((v) => v._id === id) || variants[0];
            return match;
          },
        }),
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        findById: async () => business,
      };
    }
    if (request.endsWith('models/User')) {
      return {
        findById: () => ({
          select: () => ({
            email: 'customer@example.com',
          }),
        }),
      };
    }
    if (request.endsWith('utils/orderPhase')) {
      return {
        sendOrderStatusEmail: async () => {},
        sendOrderUpdateEmail: async () => {},
        sendVendorNewOrderEmail: async () => {},
        sendCustomerOrderPlacedEmail: async () => {},
      };
    }
    if (request.endsWith('utils/vendorShipping')) {
      return {
        calculateShippingForVendor: () => shippingResult,
        normalizeDeliverySpeed: (value) => value || 'standard',
      };
    }
    if (request.endsWith('utils/vendorTax')) {
      return {
        getResolvedTaxCategory: () => null,
        getTaxRateForCategory: () => 0,
        buildTaxAwareAmounts: () => taxPricing,
        extractTaxFromInclusiveAmount: ({ inclusiveAmount }) => ({
          amountExclTax: inclusiveAmount,
          taxAmount: 0,
          amountInclTax: inclusiveAmount,
        }),
        roundCurrency: (value) => Math.round(Number(value) * 100) / 100,
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[orderControllerPath];
  const controller = require(orderControllerPath);
  Module._load = originalLoad;

  return {
    initiateOrder: controller.initiateOrder,
    getPiCreateCalls: () => piCreateCalls,
    getAccountRetrieveCalls: () => accountRetrieveCalls,
    getSavedOrderPayload: () => savedOrderPayload,
  };
}

function baseRequest(overrides = {}) {
  return {
    user: { id: userId },
    body: {
      items: [
        {
          productId,
          variantId,
          size: 'M',
          quantity: 1,
          price: overrides.price ?? 25,
        },
      ],
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '+15551234567',
        addressLine1: '123 Main St',
      },
      ...overrides.bodyExtra,
    },
  };
}

test('initiateOrder blocks checkout when vendor has no stripeConnectAccountId', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    business: buildBusiness({ stripeConnectAccountId: null }),
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /not connected to Stripe/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder blocks checkout when Connect charges_enabled is false', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    stripeAccount: buildStripeAccount({ charges_enabled: false, transfers: 'active' }),
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /onboarding incomplete/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder blocks checkout when transfers capability is inactive', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    stripeAccount: buildStripeAccount({ transfers: 'inactive' }),
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /onboarding incomplete/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder rejects multi-vendor cart', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const otherVendor = '507f1f77bcf86cd799439099';
  const otherProductId = '507f1f77bcf86cd799439098';
  const otherVariantId = '507f1f77bcf86cd799439099';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    variantById: (id) => {
      if (id === variantId) {
        return buildVariant();
      }
      return buildVariant({
        ownerId: otherVendor,
        productId: {
          _id: { toString: () => otherProductId },
          title: 'Other Product',
        },
        variantExtra: { _id: otherVariantId },
      });
    },
  });
  const res = mockResponse();

  await initiateOrder(
    {
      user: { id: userId },
      body: {
        items: [
          { productId, variantId, size: 'M', quantity: 1, price: 25 },
          {
            productId: otherProductId,
            variantId: otherVariantId,
            size: 'M',
            quantity: 1,
            price: 25,
          },
        ],
        shippingAddress: {
          fullName: 'Test Customer',
          phone: '+15551234567',
          addressLine1: '123 Main St',
        },
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Single-vendor checkout only/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder rejects price mismatch', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({});
  const res = mockResponse();

  await initiateOrder(baseRequest({ price: 99.99 }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Price mismatch/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder creates Connect destination PI with platform fee and idempotency key', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.PLATFORM_FEE_CENTS = '100';
  const { initiateOrder, getPiCreateCalls, getAccountRetrieveCalls } = loadInitiateOrder({});
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.clientSecret, 'pi_test_001_secret_test');
  assert.equal(getAccountRetrieveCalls()[0], connectAccountId);

  const [{ params, options }] = getPiCreateCalls();
  assert.equal(params.currency, 'usd');
  assert.equal(params.amount, 3000);
  assert.equal(params.application_fee_amount, 100);
  assert.equal(params.transfer_data.destination, connectAccountId);
  assert.ok(params.metadata.orderId);
  assert.equal(params.metadata.groupOrderId, 'group-order-test-uuid');
  assert.match(options.idempotencyKey, /^pi:order_/);
});

test('initiateOrder rounds total amount to nearest cent for Stripe', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.PLATFORM_FEE_CENTS = '0';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    shippingResult: {
      ...defaultShipping,
      amount: 5.015,
    },
    taxPricing: { priceExclTax: 10.01, priceInclTax: 10.01 },
  });
  const res = mockResponse();

  await initiateOrder(baseRequest({ price: 10.01 }), res);

  assert.equal(res.statusCode, 201);
  const [{ params }] = getPiCreateCalls();
  assert.equal(params.amount, Math.round((10.01 + 5.015) * 100));
});

test('initiateOrder maps insufficient_capabilities_for_transfer to safe client message', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const stripeError = new Error('Transfer capability missing');
  stripeError.code = 'insufficient_capabilities_for_transfer';
  const { initiateOrder } = loadInitiateOrder({ piCreateError: stripeError });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /onboarding incomplete/i);
  assert.doesNotMatch(JSON.stringify(res.body), /sk_test|whsec_/);
});

test('initiateOrder response exposes clientSecret but not secret keys', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.PLATFORM_FEE_CENTS = '0';
  const { initiateOrder } = loadInitiateOrder({});
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.ok(res.body.clientSecret);
  const serialized = JSON.stringify(res.body);
  assert.doesNotMatch(serialized, /sk_test_mock/);
  assert.doesNotMatch(serialized, /whsec_/);
});

test('initiateOrder returns generic 500 on unexpected Stripe errors', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const stripeError = new Error('Internal stripe failure');
  stripeError.type = 'StripeAPIError';
  const { initiateOrder } = loadInitiateOrder({ piCreateError: stripeError });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Server error');
  assert.doesNotMatch(JSON.stringify(res.body), /Internal stripe failure/);
});

test('initiateOrder allows checkout for approved active business with Connect account', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    business: buildBusiness({ isApproved: true, isActive: true }),
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.ok(res.body.clientSecret);
  assert.equal(getPiCreateCalls().length, 1);
});

test('initiateOrder blocks checkout when business is not approved', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    business: buildBusiness({ isApproved: false }),
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /not approved/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder blocks checkout when business is deactivated', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    business: buildBusiness({ isActive: false }),
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /unavailable/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder blocks checkout when business is missing', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    business: null,
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /not found/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder blocks checkout when product variant is missing', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    variants: [],
  });
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /not found/i);
  assert.equal(getPiCreateCalls().length, 0);
});
