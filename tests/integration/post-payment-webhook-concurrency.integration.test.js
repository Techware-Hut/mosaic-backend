const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const {
  startHarness,
  resetDatabase,
  stopHarness,
} = require('./setup/harness');
const {
  seedApprovedBusiness,
  seedPublishedProduct,
  uniqueEmail,
} = require('./helpers/factories');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/stripePaymentController.js'
);

const sendCalls = [];
const priorMailer = global.__MAILER__;
const priorMailLogoUrl = process.env.MAIL_LOGO_URL;
const priorPostPaymentSecret = process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET;

let User;
let Order;

function roleForMessage(message) {
  const entityRef = String(message?.headers?.['X-Entity-Ref-ID'] || '');
  if (entityRef.includes('-customer-')) return 'customer';
  if (entityRef.includes('-vendor-')) return 'vendor';
  throw new Error(`Unexpected paid-order message header: ${entityRef}`);
}

function loadPostPaymentWebhook(stripeClient) {
  const priorLoad = Module._load;
  const priorControllerModule = require.cache[controllerPath];

  function StripeMock() {
    return stripeClient;
  }
  StripeMock.Stripe = StripeMock;

  Module._load = function loadWithConcurrentStripeStub(request, parent, isMain) {
    if (request === 'stripe') return StripeMock;
    return priorLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[controllerPath];
    return require(controllerPath).stripePaymentWebhook;
  } finally {
    Module._load = priorLoad;
    if (priorControllerModule) {
      require.cache[controllerPath] = priorControllerModule;
    } else {
      delete require.cache[controllerPath];
    }
  }
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
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

test.before(async () => {
  global.__MAILER__ = {
    async sendMail(message) {
      const role = roleForMessage(message);
      sendCalls.push({ role, message });

      // Keep the winning claims open while the other webhook delivery reaches
      // the same persisted role state.
      await new Promise((resolve) => setTimeout(resolve, 75));

      const recipients = Array.isArray(message.to) ? message.to : [message.to];
      return {
        messageId: `<post-payment-${role}-provider-id@example.test>`,
        accepted: recipients,
        rejected: [],
      };
    },
  };
  process.env.MAIL_LOGO_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET =
    'whsec_post_payment_concurrency_test';

  await startHarness();
  User = require('../../models/User');
  Order = require('../../models/Order');
});

test.afterEach(async () => {
  sendCalls.length = 0;
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();

  if (priorMailer === undefined) {
    delete global.__MAILER__;
  } else {
    global.__MAILER__ = priorMailer;
  }

  if (priorMailLogoUrl === undefined) {
    delete process.env.MAIL_LOGO_URL;
  } else {
    process.env.MAIL_LOGO_URL = priorMailLogoUrl;
  }

  if (priorPostPaymentSecret === undefined) {
    delete process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET = priorPostPaymentSecret;
  }
});

test(
  'concurrent /api/stripe/payment/webhook succeeded deliveries reconcile once without VersionError or duplicate role sends',
  { timeout: 15000 },
  async () => {
    const customer = await User.create({
      name: 'Concurrent Webhook Customer',
      email: uniqueEmail('concurrent-webhook-customer'),
      role: 'customer',
      provider: 'google',
      providerId: `concurrent-customer-${Date.now()}`,
      isOtpVerified: true,
    });
    const vendor = await User.create({
      name: 'Concurrent Webhook Vendor',
      email: uniqueEmail('concurrent-webhook-vendor'),
      role: 'business_owner',
      provider: 'google',
      providerId: `concurrent-vendor-${Date.now()}`,
      isOtpVerified: true,
      notificationPreferences: {
        newBookingOrOrder: true,
        paymentReceived: true,
      },
    });
    const business = await seedApprovedBusiness(vendor, {
      businessName: 'Concurrent Webhook Shop',
      email: uniqueEmail('concurrent-webhook-business'),
    });
    const product = await seedPublishedProduct(business, vendor);
    const paymentId = `pi_post_payment_concurrency_${Date.now()}`;

    const order = await Order.create({
      groupOrderId: `post-payment-concurrency-${Date.now()}`,
      userId: customer._id,
      vendorId: vendor._id,
      businessId: business._id,
      items: [
        {
          productId: product._id,
          color: 'Black',
          size: 'M',
          sku: 'POST-PAYMENT-CONCURRENCY-1',
          quantity: 1,
          price: 19.99,
        },
      ],
      subtotalAmount: 19.99,
      totalAmount: 19.99,
      currency: 'USD',
      status: 'created',
      statusHistory: [{ status: 'created' }],
      paymentStatus: 'pending',
      paymentId,
      // Keep this regression focused on the webhook's order reconciliation;
      // inventory idempotency has its own real-Mongo concurrency coverage.
      inventoryDecrementedAt: new Date('2026-08-16T12:00:00.000Z'),
      shippingAddress: {
        fullName: customer.name,
        addressLine1: '100 Concurrency Way',
        city: 'Atlanta',
        state: 'GA',
        country: 'USA',
        pincode: '30301',
      },
    });

    let chargeRetrievals = 0;
    let releaseChargeRetrievals;
    const chargeBarrier = new Promise((resolve) => {
      releaseChargeRetrievals = resolve;
    });
    const paymentIntent = {
      id: paymentId,
      status: 'succeeded',
      latest_charge: 'ch_post_payment_concurrency',
      currency: 'usd',
      metadata: { orderId: String(order._id) },
    };
    const stripeClient = {
      webhooks: {
        constructEvent: () => ({
          type: 'payment_intent.succeeded',
          data: { object: paymentIntent },
        }),
      },
      charges: {
        async retrieve() {
          chargeRetrievals += 1;
          if (chargeRetrievals === 2) releaseChargeRetrievals();
          await chargeBarrier;
          return {
            transfer: 'tr_post_payment_concurrency',
            application_fee: 'fee_post_payment_concurrency',
          };
        },
      },
      paymentIntents: {
        retrieve: async () => paymentIntent,
      },
    };
    const stripePaymentWebhook = loadPostPaymentWebhook(stripeClient);
    const request = {
      headers: { 'stripe-signature': 'sig_post_payment_concurrency' },
      body: Buffer.from('{}'),
    };
    const responses = [createResponse(), createResponse()];

    await Promise.all(
      responses.map((response) => stripePaymentWebhook(request, response))
    );

    assert.equal(chargeRetrievals, 2);
    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [200, 200]
    );
    for (const response of responses) {
      assert.deepEqual(response.body, { received: true });
    }

    const stored = await Order.findById(order._id).lean();
    assert.equal(stored.paymentStatus, 'paid');
    assert.equal(stored.status, 'ordered');
    assert.equal(
      stored.statusHistory.filter((entry) => entry.status === 'ordered').length,
      1,
      'concurrent succeeded deliveries must append ordered history exactly once'
    );
    assert.equal(stored.items[0].chargeId, 'ch_post_payment_concurrency');
    assert.equal(stored.items[0].transferId, 'tr_post_payment_concurrency');
    assert.equal(
      stored.items[0].applicationFeeId,
      'fee_post_payment_concurrency'
    );

    assert.equal(
      sendCalls.filter((call) => call.role === 'customer').length,
      1,
      'customer provider send must occur exactly once'
    );
    assert.equal(
      sendCalls.filter((call) => call.role === 'vendor').length,
      1,
      'vendor provider send must occur exactly once'
    );
    assert.equal(stored.paidOrderEmailDelivery.customer.status, 'sent');
    assert.equal(stored.paidOrderEmailDelivery.vendor.status, 'sent');
    assert.equal(stored.paidOrderEmailDelivery.customer.attemptCount, 1);
    assert.equal(stored.paidOrderEmailDelivery.vendor.attemptCount, 1);
    assert.ok(stored.paidConfirmationEmailSentAt instanceof Date);
  }
);
