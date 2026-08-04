/**
 * P0 regression tests — new Business sync fails Mongo 16755 from invalid
 * default GeoJSON location (#251, child of #248).
 *
 * Production defect (release 5239db9, 2026-08-04): PUT /business-profile
 * returned HTTP 500 "Failed to sync business profile data" for a vendor with
 * a valid active subscription. Sanitized logs: MongoServerError code 16755
 * ("Can't extract geo keys: unknown GeoJSON type: { address: \"\" }") on
 * Business.save(). The Business schema materialized location: { address: '' }
 * on every new document (location.address had default: ''), and the 2dsphere
 * index rejects that object as invalid GeoJSON. The existing-Business path
 * already unset malformed location; the new-Business path did not.
 *
 * Contract under test:
 *  - new Business + no geolocation → save succeeds, location ABSENT
 *  - schema never materializes a partial location on new documents
 *  - valid GeoJSON Point values are preserved (new and existing)
 *  - malformed legacy location ({ address: '' }) is unset during sync
 *  - repeated saves keep exactly one Business; linkage and isActive unchanged
 *  - subscription gate (REQUIRED/INVALID) still throws typed 409s first
 *
 * Runs against the real Business / Subscription / VendorOnboardingStage1
 * schemas with in-memory MongoDB and ALL indexes initialized — including the
 * partial 2dsphere index on location — the production condition the earlier
 * suites did not exercise.
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
  hasValidGeoPoint,
  VENDOR_SUBSCRIPTION_REQUIRED,
  VENDOR_SUBSCRIPTION_INVALID,
} = require('../../utils/syncBusinessFromOnboarding');

let mongoServer;

const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const planId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439033');

function onboardingFields(overrides = {}) {
  return {
    userId,
    businessName: 'Geo Gate Business',
    businessBio: 'Bio text',
    businessType: 'product',
    businessProfileImage: { url: 'https://example.com/logo.png' },
    businessEmail: 'geo@example.test',
    businessPhone: '5551234567',
    status: 'verified',
    ...overrides,
  };
}

function subscriptionFields(overrides = {}) {
  return {
    userId,
    subscriptionPlanId: planId,
    stripeSubscriptionId: 'sub_geo_gate',
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

async function syncFor(onboardingDoc) {
  return syncBusinessFromOnboarding({
    userId,
    onboarding: onboardingDoc,
    Business,
    Subscription,
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  // autoIndex disabled: fixtures manage indexes explicitly and
  // deterministically (no background index builds racing drops).
  await mongoose.connect(mongoServer.getUri(), { autoIndex: false });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test.beforeEach(async () => {
  // Deterministic state per test: drop data AND indexes, then rebuild every
  // index — including the partial 2dsphere index on location — before any
  // write (the production condition the earlier suites did not exercise).
  await mongoose.connection.dropDatabase();
  await Business.ensureIndexes();
});

// ---------------------------------------------------------------------------
// hasValidGeoPoint contract
// ---------------------------------------------------------------------------

test('hasValidGeoPoint accepts only a complete GeoJSON Point', () => {
  assert.equal(hasValidGeoPoint(undefined), false);
  assert.equal(hasValidGeoPoint(null), false);
  assert.equal(hasValidGeoPoint({}), false);
  assert.equal(hasValidGeoPoint({ address: '' }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point' }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: [] }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: [-76.3] }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: [-76.3, 36.8, 10] }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: ['-76.3', 36.8] }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: [NaN, 36.8] }), false);
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: [Infinity, 36.8] }), false);
  assert.equal(
    hasValidGeoPoint({ type: 'Polygon', coordinates: [[[-76, 36], [-75, 36], [-75, 37], [-76, 36]]] }),
    false
  );
  assert.equal(hasValidGeoPoint({ type: 'Point', coordinates: [-76.3, 36.8] }), true);
});

// ---------------------------------------------------------------------------
// Schema materialization
// ---------------------------------------------------------------------------

test('schema never materializes a partial location on a new document', () => {
  const business = new Business({
    owner: userId,
    businessName: 'No Geo Business',
    listingType: 'product',
    subscriptionId: new mongoose.Types.ObjectId(),
    subscriptionPlanId: planId,
  });
  assert.equal(business.location, undefined);
});

// ---------------------------------------------------------------------------
// Production reproduction — fails on pre-#251 main with MongoServerError 16755
// ---------------------------------------------------------------------------

test('reproduction: new-Business profile sync succeeds with indexes initialized and writes no location', async () => {
  await createSubscription();
  const onboarding = await createOnboarding();

  // Mirror the production collection's index state: businesses.location
  // carries the original FULL 2dsphere index from the geolocation feature
  // launch. The schema's later partial-index definition never replaced it —
  // indexes are not rebuilt retroactively. A full 2dsphere index validates
  // every write, which is why production rejected location: { address: '' }
  // with MongoServerError 16755. (On a fresh partial index the malformed
  // write is silently tolerated instead — a latent corruption path this
  // fix also closes.)
  await Business.collection.dropIndexes();
  await Business.collection.createIndex({ location: '2dsphere' });

  let business;
  try {
    business = await syncFor(onboarding);
  } catch (error) {
    console.error(
      `[repro-evidence] errorName=${error?.name} code=${error?.code} message=${String(error?.message || '').split('\n')[0]}`
    );
    throw error;
  }

  const persisted = await Business.findById(business._id).lean();
  assert.ok(persisted, 'Business must be created');
  assert.equal(persisted.location, undefined, 'no partial location may be written');
  assert.equal(await Business.countDocuments({ owner: userId }), 1);
});

// ---------------------------------------------------------------------------
// Valid GeoJSON values are preserved
// ---------------------------------------------------------------------------

test('valid GeoJSON Point on a new Business is preserved through save', async () => {
  const subscription = await createSubscription();
  const business = new Business({
    owner: userId,
    businessName: 'Geocoded Business',
    listingType: 'product',
    subscriptionId: subscription._id,
    subscriptionPlanId: planId,
    location: { type: 'Point', coordinates: [-76.2855, 36.8508] },
  });

  await business.save();

  const persisted = await Business.findById(business._id).lean();
  assert.equal(persisted.location.type, 'Point');
  assert.deepEqual(persisted.location.coordinates, [-76.2855, 36.8508]);
});

test('existing Business with a valid GeoJSON Point: sync preserves it', async () => {
  await createSubscription();
  const onboarding = await createOnboarding();
  const business = await syncFor(onboarding);

  business.location = {
    type: 'Point',
    coordinates: [-76.2855, 36.8508],
    address: '1 Main St',
  };
  await business.save();

  await syncFor(onboarding);

  const persisted = await Business.findById(business._id).lean();
  assert.equal(persisted.location.type, 'Point');
  assert.deepEqual(persisted.location.coordinates, [-76.2855, 36.8508]);
  assert.equal(persisted.location.address, '1 Main St');
  assert.equal(await Business.countDocuments({ owner: userId }), 1);
});

// ---------------------------------------------------------------------------
// Malformed legacy location is safely unset during sync
// ---------------------------------------------------------------------------

test('existing Business with malformed legacy location: sync unsets it and save succeeds', async () => {
  await createSubscription();
  const onboarding = await createOnboarding();
  const business = await syncFor(onboarding);

  // Plant the legacy shape. A live write of invalid GeoJSON is rejected by the
  // 2dsphere index (that IS the production bug), so the fixture drops the
  // index in the throwaway in-memory database ONLY to plant the legacy
  // document, then rebuilds all indexes before exercising the sync. The fix
  // itself never touches the index; production indexes are unchanged.
  await Business.collection.dropIndex('location_2dsphere');
  await Business.updateOne(
    { _id: business._id },
    { $set: { location: { address: '' } } }
  );
  await Business.ensureIndexes();

  await syncFor(onboarding);

  const persisted = await Business.findById(business._id).lean();
  assert.equal(persisted.location, undefined, 'malformed location must be unset');
  assert.equal(await Business.countDocuments({ owner: userId }), 1);
});

// ---------------------------------------------------------------------------
// Idempotency, linkage, and publication state
// ---------------------------------------------------------------------------

test('repeated saves keep exactly one Business with real linkage and isActive=false', async () => {
  const subscription = await createSubscription();
  const onboarding = await createOnboarding();

  const first = await syncFor(onboarding);
  onboarding.businessBio = 'Second save bio';
  const second = await syncFor(onboarding);

  assert.equal(await Business.countDocuments({ owner: userId }), 1);
  assert.equal(String(second._id), String(first._id));
  assert.equal(String(second.subscriptionId), String(subscription._id));
  assert.equal(String(second.subscriptionPlanId), String(planId));
  assert.equal(second.subscriptionStatus, 'active');
  assert.equal(second.isActive, false);

  const persistedOnboarding = await VendorOnboarding.findById(onboarding._id).lean();
  assert.equal(String(persistedOnboarding.businessId), String(first._id));

  const persistedSubscription = await Subscription.findById(subscription._id).lean();
  assert.equal(String(persistedSubscription.businessId), String(first._id));
});

// ---------------------------------------------------------------------------
// Subscription gate still fires first (no geo write is ever attempted)
// ---------------------------------------------------------------------------

test('no active subscription still throws typed VENDOR_SUBSCRIPTION_REQUIRED with zero writes', async () => {
  const onboarding = await createOnboarding();

  await assert.rejects(
    () => syncFor(onboarding),
    (error) => {
      assert.equal(error.code, VENDOR_SUBSCRIPTION_REQUIRED);
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
  assert.equal(await Business.countDocuments({ owner: userId }), 0);
});

test('active subscription missing its plan still throws typed VENDOR_SUBSCRIPTION_INVALID with zero writes', async () => {
  await Subscription.collection.insertOne({
    ...subscriptionFields(),
    subscriptionPlanId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const onboarding = await createOnboarding();

  await assert.rejects(
    () => syncFor(onboarding),
    (error) => {
      assert.equal(error.code, VENDOR_SUBSCRIPTION_INVALID);
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
  assert.equal(await Business.countDocuments({ owner: userId }), 0);
});
