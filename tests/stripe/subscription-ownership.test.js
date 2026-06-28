const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/subscriptions.controller.js');

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

function makeStripeSubscription(overrides = {}) {
  return {
    id: 'sub_known',
    customer: 'cus_known',
    status: 'active',
    current_period_end: 1782604800,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: {
            id: 'price_launch',
            nickname: 'Launch Vendor',
            unit_amount: 4900,
            currency: 'usd',
            recurring: { interval: 'month', interval_count: 1 },
            product: { name: 'Launch Vendor' },
          },
        },
      ],
    },
    ...overrides,
  };
}

function loadController({
  business,
  localSubscription = null,
  stripeSubscription = makeStripeSubscription(),
} = {}) {
  const calls = {
    retrieve: [],
    list: [],
    update: [],
    cancel: [],
  };
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'stripe' || request.replace(/\\/g, '/').includes('/stripe/')) {
      return class Stripe {
        constructor() {
          return {
            subscriptions: {
              retrieve: async (id) => {
                calls.retrieve.push(id);
                return { ...stripeSubscription, id };
              },
              list: async (params) => {
                calls.list.push(params);
                return { data: [stripeSubscription] };
              },
              update: async (id, params) => {
                calls.update.push({ id, params });
                return { ...stripeSubscription, id, cancel_at_period_end: !!params.cancel_at_period_end };
              },
              cancel: async (id) => {
                calls.cancel.push(id);
                return { ...stripeSubscription, id, status: 'canceled' };
              },
            },
          };
        }
      };
    }

    if (request.endsWith('models/Business')) {
      return {
        findById: async () => business,
      };
    }

    if (request.endsWith('models/Subscription')) {
      return {
        findById: async () => localSubscription,
        findOne: () => ({
          sort: async () => localSubscription,
        }),
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return {
    controller,
    calls,
  };
}

function baseBusiness(overrides = {}) {
  let saveCalls = 0;
  const business = {
    _id: 'biz_123',
    owner: 'owner_123',
    stripeCustomerId: 'cus_known',
    stripeSubscriptionId: 'sub_known',
    subscriptionId: 'local_sub_id',
    async save() {
      saveCalls += 1;
    },
    ...overrides,
  };
  business.getSaveCalls = () => saveCalls;
  return business;
}

test('getCurrentSubscriptionForBusiness rejects businesses not owned by the requester', async () => {
  const { controller, calls } = loadController({
    business: baseBusiness({ owner: 'owner_else' }),
  });
  const res = mockResponse();

  await controller.getCurrentSubscriptionForBusiness(
    { user: { id: 'owner_123' }, query: { businessId: 'biz_123' } },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Business does not belong to this user');
  assert.deepEqual(calls.retrieve, []);
});

test('cancelSubscriptionForBusiness rejects unlinked Stripe subscription ids when customer is missing', async () => {
  const { controller, calls } = loadController({
    business: baseBusiness({
      stripeCustomerId: undefined,
      stripeSubscriptionId: undefined,
      subscriptionId: undefined,
    }),
    localSubscription: null,
    stripeSubscription: makeStripeSubscription({ customer: 'cus_other' }),
  });
  const res = mockResponse();

  await controller.cancelSubscriptionForBusiness(
    {
      user: { id: 'owner_123' },
      params: { id: 'sub_other' },
      body: { businessId: 'biz_123', atPeriodEnd: true },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Subscription does not belong to this business');
  assert.deepEqual(calls.update, []);
  assert.deepEqual(calls.cancel, []);
});

test('cancelSubscriptionForBusiness accepts local subscription ownership and backfills Stripe pointers', async () => {
  const business = baseBusiness({
    stripeCustomerId: undefined,
    stripeSubscriptionId: undefined,
  });
  const { controller, calls } = loadController({
    business,
    localSubscription: {
      stripeSubscriptionId: 'sub_known',
      stripeCustomerId: undefined,
    },
  });
  const res = mockResponse();

  await controller.cancelSubscriptionForBusiness(
    {
      user: { id: 'owner_123' },
      params: { id: 'sub_known' },
      body: { businessId: 'biz_123', atPeriodEnd: true },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.subscription.id, 'sub_known');
  assert.deepEqual(calls.update, [
    { id: 'sub_known', params: { cancel_at_period_end: true } },
  ]);
  assert.equal(business.stripeCustomerId, 'cus_known');
  assert.equal(business.stripeSubscriptionId, 'sub_known');
  assert.equal(business.getSaveCalls(), 1);
});

test('cancelSubscriptionForBusiness rejects a different subscription even with the same Stripe customer', async () => {
  const { controller, calls } = loadController({
    business: baseBusiness({
      stripeCustomerId: 'cus_known',
      stripeSubscriptionId: 'sub_business',
    }),
    localSubscription: {
      stripeSubscriptionId: 'sub_business',
      stripeCustomerId: 'cus_known',
    },
    stripeSubscription: makeStripeSubscription({ customer: 'cus_known' }),
  });
  const res = mockResponse();

  await controller.cancelSubscriptionForBusiness(
    {
      user: { id: 'owner_123' },
      params: { id: 'sub_other_same_customer' },
      body: { businessId: 'biz_123', atPeriodEnd: true },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Subscription does not belong to this business');
  assert.deepEqual(calls.update, []);
  assert.deepEqual(calls.cancel, []);
});

test('getCurrentSubscriptionForBusiness retrieves Stripe using the local subscription record', async () => {
  const { controller, calls } = loadController({
    business: baseBusiness({
      stripeSubscriptionId: undefined,
    }),
    localSubscription: {
      stripeSubscriptionId: 'sub_local',
      stripeCustomerId: 'cus_known',
    },
  });
  const res = mockResponse();

  await controller.getCurrentSubscriptionForBusiness(
    { user: { id: 'owner_123' }, query: { businessId: 'biz_123' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.subscription.id, 'sub_local');
  assert.deepEqual(calls.retrieve, ['sub_local']);
  assert.deepEqual(calls.list, []);
});
