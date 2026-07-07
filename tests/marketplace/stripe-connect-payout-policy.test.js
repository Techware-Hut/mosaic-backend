const test = require('node:test');
const assert = require('node:assert/strict');

const {
  requiresPayoutSetupForBusiness,
  buildPublicationBlockers,
} = require('../../utils/businessListingVisibility');

function verifiedOnboarding() {
  return { status: 'verified', applicationId: 'MBH-APP-TEST' };
}

function activeApprovedBusiness(overrides = {}) {
  return {
    isApproved: true,
    isActive: true,
    listingType: 'product',
    chargesEnabled: false,
    payoutsEnabled: false,
    stripeConnectAccountId: null,
    ...overrides,
  };
}

function listingSnapshotForType(listingType) {
  if (listingType === 'product') {
    return {
      products: [{ _id: 'prod-1', isPublished: false, variants: [] }],
      services: [],
      foods: [],
    };
  }
  if (listingType === 'service') {
    return {
      products: [],
      services: [{
        _id: 'svc-1',
        isPublished: false,
        services: [{ name: 'Consultation', durationMinutes: 30, price: 50 }],
      }],
      foods: [],
    };
  }
  return {
    products: [],
    services: [],
    foods: [{ _id: 'food-1', isPublished: false }],
  };
}

test('requiresPayoutSetupForBusiness is true only for product listing type', () => {
  assert.equal(requiresPayoutSetupForBusiness({ listingType: 'product' }), true);
  assert.equal(requiresPayoutSetupForBusiness({ listingType: 'service' }), false);
  assert.equal(requiresPayoutSetupForBusiness({ listingType: 'food' }), false);
  assert.equal(requiresPayoutSetupForBusiness({ listingType: 'restaurant' }), false);
});

test('product vendor publication is blocked without completed payout setup', () => {
  const blockers = buildPublicationBlockers({
    business: activeApprovedBusiness({ listingType: 'product' }),
    onboarding: verifiedOnboarding(),
    snapshot: listingSnapshotForType('product'),
  });

  assert.ok(blockers.some((blocker) => blocker.code === 'PAYOUT_SETUP_REQUIRED'));
});

test('service vendor can publish without Connect or payout flags', () => {
  const blockers = buildPublicationBlockers({
    business: activeApprovedBusiness({
      listingType: 'service',
      stripeConnectAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
    }),
    onboarding: verifiedOnboarding(),
    snapshot: listingSnapshotForType('service'),
  });

  assert.equal(blockers.length, 0);
});

test('food vendor can publish without Connect or payout flags', () => {
  const blockers = buildPublicationBlockers({
    business: activeApprovedBusiness({
      listingType: 'food',
      stripeConnectAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
    }),
    onboarding: verifiedOnboarding(),
    snapshot: listingSnapshotForType('food'),
  });

  assert.equal(blockers.length, 0);
});
