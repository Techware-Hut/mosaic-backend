const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { startHarness, resetDatabase, stopHarness } = require('./setup/harness');
const { seedVendorOnboarding, validStage1Draft } = require('./helpers/factories');
const User = require('../../models/User');
const VendorOnboarding = require('../../models/VendorOnboardingStage1');

const PI = 'pi_webhook_conditional';
const controllerPath = require.resolve('../../controllers/vendorOnboarding.controller');

test.before(() => startHarness());
test.afterEach(() => resetDatabase());
test.after(() => stopHarness());

// Load the real controller with synthetic Stripe + mailer (no network).
function loadController(user, mail) {
  const originalLoad = Module._load;
  const cached = require.cache[controllerPath];
  Module._load = function(request, parent, isMain) {
    if (request === 'stripe') return () => ({
      webhooks: { constructEvent: payload => JSON.parse(payload.toString()) },
      paymentIntents: { retrieve: async id => ({ id, status: 'succeeded', metadata: { type: 'vendor_verification', userId: String(user._id) } }) },
    });
    if (request === '../utils/WellcomeMailer') return {
      sendAdminOnboardingSubmissionEmail: async () => { mail.admin++; },
      sendVendorSubmissionConfirmationEmail: async () => { mail.receipt++; },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[controllerPath];
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[controllerPath] = cached; else delete require.cache[controllerPath];
  }
}

function webhookReq(user, paymentIntentId = PI, type = 'payment_intent.succeeded') {
  const event = { type, data: { object: { id: paymentIntentId, metadata: { type: 'vendor_verification', userId: String(user._id) } } } };
  return { headers: { 'stripe-signature': 't=1,v1=synthetic' }, body: Buffer.from(JSON.stringify(event)) };
}

function response() {
  return { status(code) { this.code = code; return this; }, send(body) { this.body = body; this.code ??= 200; return this; }, json(body) { this.body = body; return this; } };
}

async function seed(overrides = {}) {
  const user = await User.create({ name: 'Webhook Vendor', mobile: '+14045550199', email: 'webhook@example.com', password: 'TestPassword123!', role: 'business_owner' });
  const onboarding = await seedVendorOnboarding(user, {
    ...validStage1Draft, status: 'payment_pending', hasBusinessLicense: false, noLicenseComplianceConfirmed: true,
    verificationPayment: { status: 'pending', paymentIntentId: PI },
    ...overrides,
  });
  // Bypass the validate hook so the stored badge is still legacy 'Bronze'.
  await VendorOnboarding.collection.updateOne({ _id: onboarding._id }, { $set: { badge: 'Bronze' } });
  return { user, onboarding };
}

test.beforeEach(() => {
  process.env.STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET = 'whsec_synthetic_vendor_verification';
});

test('webhook moves payment_pending to draft, marks paid and normalizes badge', async () => {
  const { user, onboarding } = await seed();
  const controller = loadController(user, { admin: 0, receipt: 0 });
  const res = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user), res);
  assert.equal(res.code, 200);
  const saved = await VendorOnboarding.findById(onboarding._id);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.verificationPayment.status, 'paid');
  assert.ok(saved.verificationPayment.paidAt instanceof Date);
  assert.equal(saved.badge, 'Silver');
});

test('webhook that read payment_pending before a winning submit leaves the record submitted', async () => {
  const { user, onboarding } = await seed();
  const mail = { admin: 0, receipt: 0 };
  const controller = loadController(user, mail);
  const originalFindOne = VendorOnboarding.findOne;
  let release;
  const submitDone = new Promise(resolve => { release = resolve; });
  let webhookRead;
  const webhookHasRead = new Promise(resolve => { webhookRead = resolve; });
  // Hold the webhook's read until /submit has reconciled and submitted.
  // Signal before any assertion so a failure here can never hang the test.
  VendorOnboarding.findOne = async function(filter, ...rest) {
    const doc = await originalFindOne.call(this, filter, ...rest);
    if (filter && filter['verificationPayment.paymentIntentId']) {
      webhookRead(doc?.status);
      await submitDone;
    }
    return doc;
  };
  const hookRes = response();
  try {
    const webhook = controller.handleVendorPaymentWebhook(webhookReq(user), hookRes);
    try {
      assert.equal(await webhookHasRead, 'payment_pending');
      const submitRes = response();
      await controller.submitForReview({ user }, submitRes);
      assert.equal(submitRes.code, 200);
    } finally {
      release();
      await webhook;
    }
  } finally {
    VendorOnboarding.findOne = originalFindOne;
  }
  assert.equal(hookRes.code, 200);
  const saved = await VendorOnboarding.findById(onboarding._id);
  assert.equal(saved.status, 'submitted');
  assert.ok(saved.submittedAt instanceof Date);
  assert.equal(saved.verificationPayment.status, 'paid');
});

for (const status of ['submitted', 'verified', 'rejected']) {
  test(`late webhook records payment but never moves a ${status} record`, async () => {
    const { user, onboarding } = await seed({ status });
    const controller = loadController(user, { admin: 0, receipt: 0 });
    const res = response();
    await controller.handleVendorPaymentWebhook(webhookReq(user), res);
    assert.equal(res.code, 200);
    const saved = await VendorOnboarding.findById(onboarding._id);
    assert.equal(saved.status, status);
    assert.equal(saved.verificationPayment.status, 'paid');
  });
}

test('duplicate webhook delivery is idempotent and keeps the first paidAt', async () => {
  const { user, onboarding } = await seed();
  const controller = loadController(user, { admin: 0, receipt: 0 });
  const first = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user), first);
  const afterFirst = await VendorOnboarding.findById(onboarding._id).lean();
  const second = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user), second);
  assert.equal(first.code, 200);
  assert.equal(second.code, 200);
  const afterSecond = await VendorOnboarding.findById(onboarding._id).lean();
  assert.equal(afterSecond.status, 'draft');
  assert.equal(afterSecond.verificationPayment.status, 'paid');
  assert.equal(afterSecond.verificationPayment.paidAt.getTime(), afterFirst.verificationPayment.paidAt.getTime());
});

test('webhook for a different paymentIntentId does not mark the record paid', async () => {
  const { user, onboarding } = await seed();
  const controller = loadController(user, { admin: 0, receipt: 0 });
  const res = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user, 'pi_someone_else'), res);
  assert.equal(res.code, 200);
  const saved = await VendorOnboarding.findById(onboarding._id);
  assert.equal(saved.status, 'payment_pending');
  assert.equal(saved.verificationPayment.status, 'pending');
  assert.equal(saved.verificationPayment.paidAt ?? null, null);
});

const FAILED = 'payment_intent.payment_failed';

for (const status of ['payment_pending', 'draft']) {
  test(`payment_failed on a ${status} record marks failed and payment_pending as before`, async () => {
    const { user, onboarding } = await seed({ status });
    const controller = loadController(user, { admin: 0, receipt: 0 });
    const res = response();
    await controller.handleVendorPaymentWebhook(webhookReq(user, PI, FAILED), res);
    assert.equal(res.code, 200);
    const saved = await VendorOnboarding.findById(onboarding._id);
    assert.equal(saved.status, 'payment_pending');
    assert.equal(saved.verificationPayment.status, 'failed');
  });
}

for (const status of ['submitted', 'verified', 'rejected']) {
  test(`payment_failed after ${status} leaves the record untouched`, async () => {
    const { user, onboarding } = await seed({ status });
    const before = await VendorOnboarding.collection.findOne({ _id: onboarding._id });
    const controller = loadController(user, { admin: 0, receipt: 0 });
    const res = response();
    await controller.handleVendorPaymentWebhook(webhookReq(user, PI, FAILED), res);
    assert.equal(res.code, 200);
    assert.deepEqual(await VendorOnboarding.collection.findOne({ _id: onboarding._id }), before);
  });
}

test('payment_failed after a successful payment does not unmark paid', async () => {
  const { user, onboarding } = await seed();
  const controller = loadController(user, { admin: 0, receipt: 0 });
  await controller.handleVendorPaymentWebhook(webhookReq(user), response());
  const before = await VendorOnboarding.collection.findOne({ _id: onboarding._id });
  assert.equal(before.verificationPayment.status, 'paid');
  const res = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user, PI, FAILED), res);
  assert.equal(res.code, 200);
  assert.deepEqual(await VendorOnboarding.collection.findOne({ _id: onboarding._id }), before);
});

test('payment_failed with a different paymentIntentId does not write', async () => {
  const { user, onboarding } = await seed();
  const before = await VendorOnboarding.collection.findOne({ _id: onboarding._id });
  const controller = loadController(user, { admin: 0, receipt: 0 });
  const res = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user, 'pi_someone_else', FAILED), res);
  assert.equal(res.code, 200);
  assert.deepEqual(await VendorOnboarding.collection.findOne({ _id: onboarding._id }), before);
});

test('succeeded self-repairs a paid but still payment_pending record to draft and keeps paidAt', async () => {
  const paidAt = new Date('2026-11-20T00:00:00Z');
  const { user, onboarding } = await seed({ verificationPayment: { status: 'paid', paymentIntentId: PI, paidAt } });
  const controller = loadController(user, { admin: 0, receipt: 0 });
  const res = response();
  await controller.handleVendorPaymentWebhook(webhookReq(user), res);
  assert.equal(res.code, 200);
  const saved = await VendorOnboarding.collection.findOne({ _id: onboarding._id });
  assert.equal(saved.status, 'draft');
  assert.equal(saved.verificationPayment.status, 'paid');
  assert.equal(saved.verificationPayment.paidAt.getTime(), paidAt.getTime());
});

for (const status of ['payment_pending', 'draft']) {
  test(`payment_failed on a Bronze ${status} record leaves badge Bronze`, async () => {
    const { user, onboarding } = await seed({ status });
    const controller = loadController(user, { admin: 0, receipt: 0 });
    await controller.handleVendorPaymentWebhook(webhookReq(user, PI, FAILED), response());
    const saved = await VendorOnboarding.collection.findOne({ _id: onboarding._id });
    assert.equal(saved.verificationPayment.status, 'failed');
    assert.equal(saved.badge, 'Bronze');
  });
}
