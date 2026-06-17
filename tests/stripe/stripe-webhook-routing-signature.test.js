const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const appPath = path.resolve(__dirname, '../../app.js');
const webhookRoutesPath = path.resolve(__dirname, '../../routes/webhookRoutes.js');
const stripeRoutesPath = path.resolve(__dirname, '../../routes/stripeRoutes.js');

const WEBHOOK_ENDPOINTS = [
  {
    label: 'canonical order payment',
    envVar: 'STRIPE_ORDER_WEBHOOK_SECRET',
    controllerPath: path.resolve(__dirname, '../../controllers/webhookController.js'),
    exportName: 'handleStripeWebhook',
    eventType: 'qa.gate.ping',
    modelMocks: {
      '../models/Order': {},
      '../models/Subscription': {},
    },
    expectsRawBodyCheck: true,
  },
  {
    label: 'business draft checkout',
    envVar: 'STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET',
    controllerPath: path.resolve(__dirname, '../../controllers/stripeController.js'),
    exportName: 'handleStripeWebhook',
    eventType: 'qa.gate.ping',
    modelMocks: {
      '../models/BusinessDraft': {},
      '../models/SubscriptionPlan': {},
      '../models/Subscription': {},
      '../models/Business': {},
      '../utils/WellcomeMailer': { sendWelcomeEmail: () => {} },
      '../helpers/stripePlan': { ensurePlanPrice: async () => ({ priceId: 'price_test' }) },
    },
  },
  {
    label: 'subscription billing',
    envVar: 'STRIPE_SUBSCRIPTION_WEBHOOK_SECRET',
    controllerPath: path.resolve(__dirname, '../../controllers/webhookController.js'),
    exportName: 'handleSubscriptionWebhook',
    eventType: 'qa.gate.ping',
    modelMocks: {
      '../models/Order': {},
      '../models/Subscription': {},
    },
  },
  {
    label: 'vendor verification payment',
    envVar: 'STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET',
    controllerPath: path.resolve(__dirname, '../../controllers/vendorOnboarding.controller.js'),
    exportName: 'handleVendorPaymentWebhook',
    eventType: 'qa.gate.ping',
    modelMocks: {
      '../models/VendorOnboardingStage1': {},
      '../models/User': {},
      '../utils/WellcomeMailer': {
        sendAdminOnboardingSubmissionEmail: async () => {},
        sendVendorSubmissionConfirmationEmail: async () => {},
        sendAdminVendorProfileCompletedEmail: async () => {},
      },
      '../utils/vendorOnboardingProfileFields': {
        stripProtectedVendorFields: (body) => body,
        applyVendorBusinessProfileFields: () => {},
        applyVendorDraftField: () => {},
      },
      '../utils/syncBusinessFromOnboarding': { syncBusinessFromOnboarding: async () => {} },
    },
  },
  {
    label: 'order post-payment email',
    envVar: 'STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET',
    controllerPath: path.resolve(__dirname, '../../controllers/stripePaymentController.js'),
    exportName: 'stripePaymentWebhook',
    eventType: 'qa.gate.ping',
    modelMocks: {
      '../models/Order': { find: async () => [] },
      '../utils/OrderMail': { sendOrderPaidEmails: async () => {} },
    },
  },
];

const SECRETS = {
  STRIPE_ORDER_WEBHOOK_SECRET: 'whsec_order_test',
  STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET: 'whsec_business_draft_test',
  STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: 'whsec_subscription_test',
  STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET: 'whsec_vendor_verification_test',
  STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET: 'whsec_order_post_payment_test',
};

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createStripeMock(expectedSecret, eventType = 'qa.gate.ping', options = {}) {
  const constructCalls = [];

  const stripeMock = {
    constructCalls,
    webhooks: {
      constructEvent(payload, sig, secret) {
        constructCalls.push({ payload, sig, secret });
        if (options.throwOnConstruct) {
          throw new Error('Unable to extract timestamp and signatures from header');
        }
        if (!sig) {
          throw new Error('No stripe-signature header value was provided.');
        }
        if (secret !== expectedSecret) {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return { type: eventType, data: { object: {} } };
      },
    },
  };

  return stripeMock;
}

function createStripeModuleExport(stripeMock) {
  function StripeClient() {
    return stripeMock;
  }
  return StripeClient;
}

function loadWebhookHandler(endpoint, stripeMock) {
  const stripeExport = createStripeModuleExport(stripeMock);
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'stripe') {
      return stripeExport;
    }

    for (const [modelPath, mock] of Object.entries(endpoint.modelMocks)) {
      if (request === modelPath) {
        return mock;
      }
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[endpoint.controllerPath];
  const loaded = require(endpoint.controllerPath);
  Module._load = originalLoad;
  return loaded[endpoint.exportName];
}

function setWebhookSecrets() {
  for (const [key, value] of Object.entries(SECRETS)) {
    process.env[key] = value;
  }
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
}

test('app.js mounts Stripe webhook routes before express.json()', () => {
  const appSource = fs.readFileSync(appPath, 'utf8');
  const jsonMiddlewareIndex = appSource.indexOf('app.use(express.json())');
  const webhookMounts = [
    "app.use('/api/stripe'",
    "app.use('/api/webhooks'",
    "app.use('/api/vendor-onboarding/webhook/payment'",
    "app.use('/api/subscription/webhook'",
  ];

  assert.ok(jsonMiddlewareIndex > -1, 'express.json middleware must exist in app.js');

  for (const mount of webhookMounts) {
    const mountIndex = appSource.indexOf(mount);
    assert.ok(mountIndex > -1, `missing webhook mount: ${mount}`);
    assert.ok(
      mountIndex < jsonMiddlewareIndex,
      `${mount} must be registered before express.json()`
    );
  }
});

test('webhook route modules apply express.raw middleware on POST webhook paths', () => {
  const webhookRoutesSource = fs.readFileSync(webhookRoutesPath, 'utf8');
  const stripeRoutesSource = fs.readFileSync(stripeRoutesPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');

  assert.match(
    webhookRoutesSource,
    /webhookRouter\.post\(\s*['"]\/stripe['"][\s\S]*express\.raw/
  );
  assert.match(
    stripeRoutesSource,
    /router\.post\(\s*['"]\/webhook['"][\s\S]*express\.raw/
  );
  assert.match(
    stripeRoutesSource,
    /router\.post\(\s*['"]\/payment\/webhook['"][\s\S]*express\.raw/
  );
  assert.match(
    appSource,
    /app\.use\(\s*['"]\/api\/vendor-onboarding\/webhook\/payment['"][\s\S]*express\.raw/
  );
  assert.match(
    appSource,
    /app\.use\(\s*['"]\/api\/subscription\/webhook['"][\s\S]*express\.raw/
  );
});

test('each Stripe webhook handler uses its own signing secret env var', async () => {
  setWebhookSecrets();

  for (const endpoint of WEBHOOK_ENDPOINTS) {
    const stripeMock = createStripeMock(SECRETS[endpoint.envVar], endpoint.eventType);
    const handler = loadWebhookHandler(endpoint, stripeMock);
    const payload = Buffer.from('{"id":"evt_test"}', 'utf8');
    const res = mockResponse();

    await handler(
      {
        headers: { 'stripe-signature': 'sig_test' },
        body: payload,
      },
      res
    );

    assert.equal(stripeMock.constructCalls.length, 1, `${endpoint.label} should verify signature once`);
    assert.equal(
      stripeMock.constructCalls[0].secret,
      SECRETS[endpoint.envVar],
      `${endpoint.label} must use ${endpoint.envVar}`
    );
  }
});

test('Stripe webhook handlers reject missing stripe-signature header', async () => {
  setWebhookSecrets();

  for (const endpoint of WEBHOOK_ENDPOINTS) {
  if (endpoint.label === 'vendor verification payment') {
      continue;
    }

    const stripeMock = createStripeMock(SECRETS[endpoint.envVar], endpoint.eventType);
    const handler = loadWebhookHandler(endpoint, stripeMock);
    const res = mockResponse();

    await handler(
      {
        headers: {},
        body: Buffer.from('{"id":"evt_test"}', 'utf8'),
      },
      res
    );

    assert.equal(res.statusCode, 400, `${endpoint.label} should reject missing signature`);
    assert.match(String(res.body), /stripe-signature|Webhook Error/i);
  }
});

test('vendor verification webhook rejects missing signature outside development', async () => {
  setWebhookSecrets();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const stripeMock = createStripeMock(
    SECRETS.STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET,
    'qa.gate.ping'
  );
  const handler = loadWebhookHandler(
    WEBHOOK_ENDPOINTS.find((endpoint) => endpoint.label === 'vendor verification payment'),
    stripeMock
  );
  const res = mockResponse();

  await handler(
    {
      headers: {},
      body: Buffer.from('{"id":"evt_test"}', 'utf8'),
    },
    res
  );

  process.env.NODE_ENV = previousNodeEnv;

  assert.equal(res.statusCode, 400);
  assert.match(String(res.body), /stripe-signature/i);
});

test('Stripe webhook handlers reject invalid signatures', async () => {
  setWebhookSecrets();

  for (const endpoint of WEBHOOK_ENDPOINTS) {
    const stripeMock = createStripeMock(SECRETS[endpoint.envVar], endpoint.eventType, {
      throwOnConstruct: true,
    });
    const handler = loadWebhookHandler(endpoint, stripeMock);
    const res = mockResponse();

    await handler(
      {
        headers: { 'stripe-signature': 'sig_invalid' },
        body: Buffer.from('{"id":"evt_test"}', 'utf8'),
      },
      res
    );

    assert.equal(res.statusCode, 400, `${endpoint.label} should reject invalid signature`);
    assert.match(String(res.body), /Webhook Error/i);
  }
});

test('Stripe webhook handlers reject wrong signing secret for the route', async () => {
  setWebhookSecrets();

  for (const endpoint of WEBHOOK_ENDPOINTS) {
    const wrongSecret = 'whsec_wrong_secret_for_route';
    const stripeMock = createStripeMock(wrongSecret, endpoint.eventType);
    const handler = loadWebhookHandler(endpoint, stripeMock);
    const res = mockResponse();

    await handler(
      {
        headers: { 'stripe-signature': 'sig_test' },
        body: Buffer.from('{"id":"evt_test"}', 'utf8'),
      },
      res
    );

    assert.equal(res.statusCode, 400, `${endpoint.label} should reject mismatched secret`);
    assert.match(String(res.body), /Webhook Error/i);
  }
});

test('canonical order webhook rejects parsed JSON body instead of raw payload', async () => {
  setWebhookSecrets();
  const endpoint = WEBHOOK_ENDPOINTS.find((item) => item.label === 'canonical order payment');
  const stripeMock = createStripeMock(SECRETS[endpoint.envVar], endpoint.eventType);
  const handler = loadWebhookHandler(endpoint, stripeMock);
  const res = mockResponse();

  await handler(
    {
      headers: { 'stripe-signature': 'sig_test' },
      body: { id: 'evt_test' },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(String(res.body), /raw request body/i);
  assert.equal(stripeMock.constructCalls.length, 0);
});

test('Stripe webhook signing secrets are distinct per endpoint', () => {
  const secretValues = Object.values(SECRETS);
  const uniqueValues = new Set(secretValues);
  assert.equal(uniqueValues.size, secretValues.length);
  assert.equal(Object.keys(SECRETS).length, WEBHOOK_ENDPOINTS.length);
});
