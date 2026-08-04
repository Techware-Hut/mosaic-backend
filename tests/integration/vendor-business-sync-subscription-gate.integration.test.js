/**
 * Real-schema integration proof — Business sync subscription gate (#248).
 *
 * Runs syncBusinessFromOnboarding against real Business / Subscription /
 * VendorOnboardingStage1 schemas (in-memory MongoDB) to prove:
 *  - Active subscription + plan → sync succeeds; Business created with real
 *    subscription linkage (never null refs, never 'inactive'), isActive=false,
 *    isApproved mirrors the Stage-1 verification decision, listingType comes
 *    only from onboarding.businessType, onboarding.businessId is persisted,
 *    and Subscription.businessId is back-linked when missing.
 *  - Repeat saves UPDATE the same Business (exactly one per owner).
 *  - No / pending / expired / cancelled subscription → typed
 *    VENDOR_SUBSCRIPTION_REQUIRED conflict; NO Business row is created.
 *  - Active subscription with missing planId (legacy raw document) → typed
 *    VENDOR_SUBSCRIPTION_INVALID conflict; NO Business row is created.
 *
 * Legacy-status normalization is intentionally NOT covered: production
 * evidence showed the newest subscription reading exactly 'active', so no
 * normalization was implemented (issue #248, acceptance criterion C).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Business = require('../../models/Business');
const Subscription = require('../../models/Subscription');
const VendorOnboarding = require('../../models/VendorOnboardingStage1');
const {
  syncBusinessFromOnboarding,
  VENDOR_SUBSCRIPTION_REQUIRED,
  VENDOR_SUBSCRIPTION_INVALID,
} = require('../../utils/syncBusinessFromOnboarding');

let mongoServer;

const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const otherUserId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
const planId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439033');

function onboardingFields(overrides = {}) {
  return {
    userId,
    businessName: 'Gate Integration Business',
    businessBio: 'Integration bio text',
    businessType: 'product',
    businessProfileImage: { url: 'https://example.com/logo.png' },
    featureBanner: { url: 'https://example.com/banner.png' },
    businessEmail: 'gate@example.test',
    businessPhone: '5551234567',
    status: 'submitted',
    ...overrides,
  };
}

function subscriptionFields(overrides = {}) {
  return {
    userId,
    subscriptionPlanId: planId,
    stripeSubscriptionId: 'sub_gate_integration',
    paymentStatus: 'COMPLETED',
    startDate: new Date('2026-08-01T00:00:00Z'),
    endDate: new Date('2026-09-01T00:00:00Z'),
    status: 'active',
    ...overrides,
  };
}

async function createOnboarding(overrides = {}) {
  const doc = new VendorOnboarding(onboardingFields(overrides));
  await doc.save();
  return doc;
}

async function createSubscription(overrides = {}) {
  const doc = new Subscription(subscriptionFields(overrides));
  await doc.save();
  return doc;
}

async function syncFor(onboardingDoc, ownerId = userId) {
  return syncBusinessFromOnboarding({
    userId: ownerId,
    onboarding: onboardingDoc,
    Business,
    Subscription,
  });
}

async function assertTypedSyncConflict(onboardingDoc, expectedCode, expectedNextAction) {
  await assert.rejects(
    () => syncFor(onboardingDoc),
    (error) => {
      assert.equal(error.name, 'VendorSubscriptionSyncError');
      assert.equal(error.code, expectedCode);
      assert.equal(error.statusCode, 409);
      assert.equal(error.nextAction, expectedNextAction);
      return true;
    }
  );
  assert.equal(
    await Business.countDocuments({ owner: userId }),
    0,
    'no partial Business may be created'
  );
  const persisted = await VendorOnboarding.findById(onboardingDoc._id).lean();
  assert.equal(
    persisted.businessId ?? null,
    null,
    'onboarding.businessId must stay unset when sync is refused'
  );
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test.beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('active subscription + plan: sync creates Business with real linkage', async () => {
  const subscription = await createSubscription();
  const onboarding = await createOnboarding();

  const business = await syncFor(onboarding);

  // Required refs are real values — never null, never synthetic 'inactive'.
  assert.equal(String(business.subscriptionId), String(subscription._id));
  assert.equal(String(business.subscriptionPlanId), String(planId));
  assert.equal(business.subscriptionStatus, 'active');
  assert.match(business.slug, /^gate-integration-business/);

  // Publication controls untouched: inactive until Stage 6, approval mirrors
  // the Stage-1 verification decision ('submitted' → not approved).
  assert.equal(business.isActive, false);
  assert.equal(business.isApproved, false);

  // Onboarding linkage persisted to the database.
  const persistedOnboarding = await VendorOnboarding.findById(onboarding._id).lean();
  assert.equal(String(persistedOnboarding.businessId), String(business._id));

  // Reverse linkage back-filled on the subscription.
  const persistedSubscription = await Subscription.findById(subscription._id).lean();
  assert.equal(String(persistedSubscription.businessId), String(business._id));
});

test('verified onboarding: created Business is approved', async () => {
  await createSubscription();
  const onboarding = await createOnboarding({ status: 'verified' });

  const business = await syncFor(onboarding);

  assert.equal(business.isApproved, true);
  assert.equal(business.isActive, false, 'still gated on Stage 6 publish');
});

test('repeat saves update the same Business — exactly one per owner', async () => {
  await createSubscription();
  const onboarding = await createOnboarding();

  const first = await syncFor(onboarding);
  onboarding.businessBio = 'Second save bio';
  const second = await syncFor(onboarding);

  assert.equal(await Business.countDocuments({ owner: userId }), 1);
  assert.equal(String(second._id), String(first._id));
  assert.equal(second.description, 'Second save bio');
  assert.equal(second.isActive, false, 'update path never flips isActive');
  assert.equal(second.subscriptionStatus, 'active');
});

test('existing Business keeps its identity and gets refreshed linkage', async () => {
  const subscription = await createSubscription();
  const onboarding = await createOnboarding();

  const first = await syncFor(onboarding);
  // Simulate a subscription row whose businessId was already correct.
  const relinked = await Subscription.findById(subscription._id);
  assert.equal(String(relinked.businessId), String(first._id));

  const second = await syncFor(onboarding);
  assert.equal(String(second._id), String(first._id));
  assert.equal(await Business.countDocuments({ owner: userId }), 1);
});

// ---------------------------------------------------------------------------
// Refused paths — typed conflicts, zero writes
// ---------------------------------------------------------------------------

test('no subscription: VENDOR_SUBSCRIPTION_REQUIRED and no Business created', async () => {
  const onboarding = await createOnboarding();
  await assertTypedSyncConflict(
    onboarding,
    VENDOR_SUBSCRIPTION_REQUIRED,
    'complete_subscription'
  );
});

test('pending / expired / cancelled subscriptions: VENDOR_SUBSCRIPTION_REQUIRED', async () => {
  for (const status of ['pending', 'expired', 'cancelled']) {
    await Subscription.deleteMany({});
    await VendorOnboarding.deleteMany({});
    await Business.deleteMany({});

    await createSubscription({ status });
    const onboarding = await createOnboarding();

    await assertTypedSyncConflict(
      onboarding,
      VENDOR_SUBSCRIPTION_REQUIRED,
      'complete_subscription'
    );
  }
});

test('active subscription with missing planId (legacy raw doc): VENDOR_SUBSCRIPTION_INVALID', async () => {
  // Raw insert bypasses Mongoose validation, reproducing a legacy row whose
  // required subscriptionPlanId was never stored.
  await Subscription.collection.insertOne({
    ...subscriptionFields(),
    subscriptionPlanId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const onboarding = await createOnboarding();

  await assertTypedSyncConflict(
    onboarding,
    VENDOR_SUBSCRIPTION_INVALID,
    'contact_support'
  );
});

// ---------------------------------------------------------------------------
// listingType sourcing — never "Nonprofit"
// ---------------------------------------------------------------------------

test('listingType mirrors onboarding.businessType for every allowed value', async () => {
  for (const businessType of ['product', 'service', 'food']) {
    await Subscription.deleteMany({});
    await VendorOnboarding.deleteMany({});
    await Business.deleteMany({});

    await createSubscription();
    const onboarding = await createOnboarding({ businessType });

    const business = await syncFor(onboarding);
    assert.equal(business.listingType, businessType);
  }
});

test('onboarding schema rejects Nonprofit as a businessType — it can never reach listingType', async () => {
  const onboarding = new VendorOnboarding(
    onboardingFields({ businessType: 'Nonprofit' })
  );
  await assert.rejects(() => onboarding.validate(), /businessType|enum/i);
});

test('missing businessType falls back to product listing', async () => {
  await createSubscription();
  const onboarding = await createOnboarding({ businessType: undefined });

  const business = await syncFor(onboarding);
  assert.equal(business.listingType, 'product');
});

// ---------------------------------------------------------------------------
// Slug uniqueness across owners
// ---------------------------------------------------------------------------

test('two owners with the same business name get distinct slugs', async () => {
  await createSubscription();
  await createSubscription({
    userId: otherUserId,
    stripeSubscriptionId: 'sub_gate_other',
  });

  const onboardingA = await createOnboarding();
  const onboardingB = await createOnboarding({ userId: otherUserId });

  const businessA = await syncFor(onboardingA, userId);
  const businessB = await syncFor(onboardingB, otherUserId);

  assert.notEqual(businessA.slug, businessB.slug);
  assert.equal(await Business.countDocuments({}), 2);
});
