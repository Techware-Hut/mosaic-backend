const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPublicMarketplaceBusiness,
  publicMarketplaceBusinessFilter,
  getPublicMarketplaceBusinessBlock,
} = require('../../lib/marketplace/businessEligibility');

test('public marketplace eligibility requires approved and active business', () => {
  assert.equal(isPublicMarketplaceBusiness({ isApproved: true, isActive: true }), true);
  assert.equal(isPublicMarketplaceBusiness({ isApproved: false, isActive: true }), false);
  assert.equal(isPublicMarketplaceBusiness({ isApproved: true, isActive: false }), false);
});

test('public marketplace filter adds approved active scope to extra criteria', () => {
  assert.deepEqual(
    publicMarketplaceBusinessFilter({ badge: { $in: ['Bronze'] } }),
    { badge: { $in: ['Bronze'] }, isApproved: true, isActive: true }
  );
});

test('public marketplace block reports ineligible businesses', () => {
  const block = getPublicMarketplaceBusinessBlock({ isApproved: true, isActive: false });

  assert.equal(block.status, 403);
  assert.match(block.message, /approved and active/);
  assert.equal(getPublicMarketplaceBusinessBlock({ isApproved: true, isActive: true }), null);
});

