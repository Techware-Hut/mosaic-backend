const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/publicListing.js');
const filtersPath = path.resolve(__dirname, '../../lib/listing/publicSearchFilters.js');

const ids = {
  bronze: '507f1f77bcf86cd799439011',
  silver: '507f1f77bcf86cd799439012',
  gold: '507f1f77bcf86cd799439013',
  otherSilver: '507f1f77bcf86cd799439014',
  inactiveSilver: '507f1f77bcf86cd799439015',
  unapprovedSilver: '507f1f77bcf86cd799439016',
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

function buildBusiness(overrides = {}) {
  return {
    _id: ids.bronze,
    businessName: 'Marketplace Vendor',
    badge: 'Bronze',
    isApproved: true,
    isActive: true,
    ...overrides,
  };
}

function buildListing(type, businessId) {
  return {
    _id: `${type}-${businessId}`,
    title: `${type} listing`,
    description: 'Listing',
    businessId,
    isPublished: true,
    price: 25,
    toObject() {
      return { ...this };
    },
  };
}

function buildServiceFindChain(rows) {
  const chain = {
    select() { return chain; },
    populate() { return chain; },
    sort() { return chain; },
    skip() { return chain; },
    limit() { return chain; },
    lean() { return Promise.resolve(rows); },
  };
  return chain;
}

function buildLeanFindChain(rows) {
  const chain = {
    select() { return chain; },
    populate() { return chain; },
    sort() { return chain; },
    skip() { return chain; },
    limit() { return chain; },
    lean() { return Promise.resolve(rows); },
  };
  return chain;
}

function buildSelectLeanChain(rows) {
  return {
    select() {
      return {
        lean: async () => rows,
      };
    },
  };
}

function normalizeIdSet(value) {
  if (!value) return [];
  if (value.$in) return value.$in.map(String);
  return [String(value)];
}

function loadController(options = {}) {
  const businesses = options.businesses || [
    buildBusiness({ _id: ids.bronze, badge: 'Bronze' }),
    buildBusiness({ _id: ids.silver, badge: 'Silver' }),
    buildBusiness({ _id: ids.gold, badge: 'Gold' }),
    buildBusiness({ _id: ids.otherSilver, badge: 'Silver' }),
    buildBusiness({ _id: ids.inactiveSilver, badge: 'Silver', isActive: false }),
    buildBusiness({ _id: ids.unapprovedSilver, badge: 'Silver', isApproved: false }),
  ];
  const captured = {
    businessFinds: [],
    serviceFind: null,
    foodFind: null,
    productFind: null,
  };

  const activeApprovedBusinesses = () => (
    businesses.filter((business) => business.isApproved === true && business.isActive === true)
  );

  const findBusinesses = (filter = {}) => {
    captured.businessFinds.push(filter);
    let rows = activeApprovedBusinesses();

    if (filter.badge?.$in) {
      const requested = new Set(filter.badge.$in.map(String));
      rows = rows.filter((business) => requested.has(String(business.badge)));
    }

    if (filter._id?.$in) {
      const requested = new Set(filter._id.$in.map(String));
      rows = rows.filter((business) => requested.has(String(business._id)));
    }

    return buildSelectLeanChain(rows);
  };

  const Service = {
    find: (filter) => {
      captured.serviceFind = filter;
      return buildServiceFindChain(options.serviceRows || [buildListing('service', ids.bronze)]);
    },
    countDocuments: async () => 1,
    findOne: async () => null,
    findById: () => ({ populate: () => ({ populate: () => ({ populate: async () => null }) }) }),
  };

  const Food = {
    find: (filter) => {
      captured.foodFind = filter;
      return buildLeanFindChain(options.foodRows || [buildListing('food', ids.silver)]);
    },
    countDocuments: async () => 1,
    findById: () => ({ populate: () => ({ populate: async () => null }) }),
  };

  const Product = {
    find: (filter) => {
      captured.productFind = filter;
      return buildLeanFindChain(options.productRows || [buildListing('product', ids.bronze)]);
    },
    countDocuments: async () => 1,
    findById: () => ({ populate: () => ({ populate: async () => null }) }),
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).endsWith('models/Service')) return Service;
    if (String(request).endsWith('models/Food')) return Food;
    if (String(request).endsWith('models/Product')) return Product;
    if (String(request).endsWith('models/ProductVariant')) return {};
    if (String(request).endsWith('models/Business')) {
      return {
        find: findBusinesses,
        findOne: () => ({ select: () => ({ lean: async () => activeApprovedBusinesses()[0] || null }) }),
      };
    }
    if (String(request).endsWith('models/VendorOnboardingStage1')) {
      return { find: () => buildSelectLeanChain([]), findOne: () => ({ select: () => ({ lean: async () => null }) }) };
    }
    if (String(request).endsWith('models/Review')) return { find: () => ({ populate: async () => [] }) };
    if (String(request).endsWith('models/MinorityType')) return { find: async () => [] };
    if (String(request).endsWith('models/ServiceCategory')) return { findOne: async () => null };
    if (String(request).endsWith('models/ServiceSubcategory')) return { findOne: async () => null };
    if (String(request).endsWith('models/FoodCategory')) return { findOne: async () => null };
    if (String(request).endsWith('models/FoodSubcategory')) return { findOne: async () => null };
    if (String(request).endsWith('models/ProductCategory')) return { findOne: async () => null };
    if (String(request).endsWith('models/ProductSubcategory')) return { findOne: async () => null };
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  delete require.cache[filtersPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, captured };
}

test('service badge filter normalizes Bronze and keeps approved active scope', async () => {
  const { controller, captured } = loadController({
    serviceRows: [buildListing('service', ids.bronze)],
  });
  const res = mockResponse();

  await controller.getAllServices({ query: { badge: 'bronze' } }, res);

  assert.equal(res.body.success, true);
  assert.deepEqual(normalizeIdSet(captured.serviceFind.businessId), [ids.bronze]);
  const badgeFilter = captured.businessFinds.find((filter) => filter.badge);
  assert.deepEqual(badgeFilter.badge.$in, ['Bronze']);
  assert.equal(badgeFilter.isApproved, true);
  assert.equal(badgeFilter.isActive, true);
});

test('service badge filter supports Silver and Gold without explicit businessId', async () => {
  const { controller, captured } = loadController({
    serviceRows: [buildListing('service', ids.silver), buildListing('service', ids.gold)],
  });
  const res = mockResponse();

  await controller.getAllServices({ query: { badge: 'silver,gold' } }, res);

  assert.equal(res.body.success, true);
  assert.deepEqual(
    normalizeIdSet(captured.serviceFind.businessId).sort(),
    [ids.gold, ids.silver, ids.otherSilver].sort()
  );
  assert.ok(!normalizeIdSet(captured.serviceFind.businessId).includes(ids.inactiveSilver));
  assert.ok(!normalizeIdSet(captured.serviceFind.businessId).includes(ids.unapprovedSilver));
});

test('service badge filter preserves explicit matching businessId', async () => {
  const { controller, captured } = loadController({
    serviceRows: [buildListing('service', ids.silver)],
  });
  const res = mockResponse();

  await controller.getAllServices({ query: { badge: 'silver', businessId: ids.silver } }, res);

  assert.equal(res.body.success, true);
  assert.equal(captured.serviceFind.businessId, ids.silver);
});

test('service badge filter returns empty for explicit nonmatching businessId', async () => {
  const { controller, captured } = loadController();
  const res = mockResponse();

  await controller.getAllServices({ query: { badge: 'gold', businessId: ids.silver } }, res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.total, 0);
  assert.equal(captured.serviceFind, null);
});

test('food badge filter does not leak another vendor into explicit vendor menu context', async () => {
  const { controller, captured } = loadController({
    foodRows: [buildListing('food', ids.silver)],
  });
  const res = mockResponse();

  await controller.getAllFood({ query: { badge: 'silver', businessId: ids.silver, price: 'all' } }, res);

  assert.equal(res.body.success, true);
  assert.equal(captured.foodFind.businessId, ids.silver);
});

test('food badge filter returns empty for explicit nonmatching vendor context', async () => {
  const { controller, captured } = loadController();
  const res = mockResponse();

  await controller.getAllFood({ query: { badge: 'gold', businessId: ids.silver, price: 'all' } }, res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.total, 0);
  assert.equal(captured.foodFind, null);
});

test('product badge filter shares Bronze normalization and business-scope intersection', async () => {
  const { controller, captured } = loadController({
    productRows: [buildListing('product', ids.bronze)],
  });
  const res = mockResponse();

  await controller.getAllProducts({ query: { badge: 'BRONZE' } }, res);

  assert.equal(res.body.success, true);
  assert.deepEqual(normalizeIdSet(captured.productFind.businessId), [ids.bronze]);
  const badgeFilter = captured.businessFinds.find((filter) => filter.badge);
  assert.deepEqual(badgeFilter.badge.$in, ['Bronze']);
});
