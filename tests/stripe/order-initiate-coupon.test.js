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
  couponEvaluator = null,
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
        sendOrderLifecycleEmail: async () => {},
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
    if (request.endsWith('utils/couponDiscount')) {
      if (couponEvaluator) {
        return couponEvaluator;
      }
      return originalLoad(request, parent, isMain);
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[orderControllerPath];
  const controller = require(orderControllerPath);
  Module._load = originalLoad;

  return {
    initiateOrder: controller.initiateOrder,
    getPiCreateCalls: () => piCreateCalls,
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
          quantity: overrides.quantity ?? 1,
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

test('initiateOrder rejects coupon below minimum subtotal', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({
    couponEvaluator: {
      evaluateCouponDiscount: async () => ({
        ok: false,
        message: 'Minimum order amount is 50',
      }),
    },
  });
  const res = mockResponse();

  await initiateOrder(
    baseRequest({
      bodyExtra: {
        couponCode: 'MIN50',
        items: [
          {
            productId,
            variantId,
            size: 'M',
            quantity: 1,
            price: 25,
          },
        ],
      },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Minimum order amount is 50/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder applies coupon to PI amount and persisted order total', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.PLATFORM_FEE_CENTS = '0';
  const { initiateOrder, getPiCreateCalls, getSavedOrderPayload } = loadInitiateOrder({
    couponEvaluator: {
      evaluateCouponDiscount: async ({ subtotalAmount }) => ({
        ok: true,
        couponCode: 'SAVE10',
        discountAmount: 5,
        discountedSubtotal: subtotalAmount - 5,
      }),
    },
  });
  const res = mockResponse();

  await initiateOrder(
    baseRequest({
      bodyExtra: {
        couponCode: 'SAVE10',
        items: [
          {
            productId,
            variantId,
            size: 'M',
            quantity: 2,
            price: 25,
          },
        ],
      },
    }),
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.totals.subtotalAmount, 50);
  assert.equal(res.body.totals.discountAmount, 5);
  assert.equal(res.body.totals.discountedSubtotal, 45);
  assert.equal(res.body.totals.totalAmount, 50);

  const [{ params }] = getPiCreateCalls();
  assert.equal(params.amount, 5000);

  const saved = getSavedOrderPayload();
  assert.equal(saved.couponCode, 'SAVE10');
  assert.equal(saved.discountAmount, 5);
  assert.equal(saved.totalAmount, 50);
});

test('initiateOrder rejects client totalAmount tampering', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const { initiateOrder, getPiCreateCalls } = loadInitiateOrder({});
  const res = mockResponse();

  await initiateOrder(
    baseRequest({
      bodyExtra: {
        totalAmount: 1,
      },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Client total does not match server-calculated total/i);
  assert.equal(getPiCreateCalls().length, 0);
});

test('initiateOrder checkout total matches undiscounted subtotal plus shipping', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.PLATFORM_FEE_CENTS = '0';
  const { initiateOrder } = loadInitiateOrder({});
  const res = mockResponse();

  await initiateOrder(baseRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.totals.subtotalAmount, 25);
  assert.equal(res.body.totals.shippingAmount, 5);
  assert.equal(res.body.totals.totalAmount, 30);
});
