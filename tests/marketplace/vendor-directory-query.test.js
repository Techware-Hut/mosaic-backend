const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  parseObjectIdCsv,
  resolveListingTypeFilter,
  applyListingTypeCategoryFilter,
  buildStorefrontPath,
  mapFirstListingIdByBusiness,
} = require('../../lib/marketplace/vendorDirectoryQuery');

test('resolveListingTypeFilter returns all marketplace types by default', () => {
  assert.deepEqual(resolveListingTypeFilter(), { $in: ['product', 'service', 'food'] });
  assert.deepEqual(resolveListingTypeFilter('invalid'), { $in: ['product', 'service', 'food'] });
});

test('resolveListingTypeFilter accepts valid listing type', () => {
  assert.equal(resolveListingTypeFilter('service'), 'service');
  assert.equal(resolveListingTypeFilter('FOOD'), 'food');
});

test('parseObjectIdCsv ignores invalid category labels', () => {
  const validId = new mongoose.Types.ObjectId().toString();
  const parsed = parseObjectIdCsv(`Fashion,${validId},Electronics`);
  assert.equal(parsed.length, 1);
  assert.equal(String(parsed[0]), validId);
});

test('applyListingTypeCategoryFilter only applies valid object ids', () => {
  const filters = {};
  const validId = new mongoose.Types.ObjectId().toString();

  applyListingTypeCategoryFilter(filters, 'product', {
    productCategory: `Fashion,${validId}`,
  });

  assert.deepEqual(filters.productCategories.$in.map(String), [validId]);
});

test('buildStorefrontPath routes by listing type', () => {
  assert.equal(
    buildStorefrontPath('product', 'biz1', 'biz1'),
    '/vendor-profile/product-vendor/biz1'
  );
  assert.equal(
    buildStorefrontPath('service', 'biz1', 'svc1'),
    '/vendor-profile/service-vendor/svc1'
  );
  assert.equal(buildStorefrontPath('service', 'biz1', null), null);
  assert.equal(
    buildStorefrontPath('food', 'biz1', 'food1'),
    '/vendor-profile/food-vendor/food1'
  );
  assert.equal(buildStorefrontPath('food', 'biz1', null), null);
});

test('mapFirstListingIdByBusiness keeps first listing per business', () => {
  const map = mapFirstListingIdByBusiness([
    { _id: 'svc-a', businessId: 'biz-1' },
    { _id: 'svc-b', businessId: 'biz-1' },
    { _id: 'svc-c', businessId: 'biz-2' },
  ]);

  assert.equal(map.get('biz-1'), 'svc-a');
  assert.equal(map.get('biz-2'), 'svc-c');
});
