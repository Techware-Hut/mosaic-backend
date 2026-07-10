const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/publicListing.js');
const filtersPath = path.resolve(__dirname, '../../lib/listing/publicSearchFilters.js');

const businessId = '507f1f77bcf86cd799439011';

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

function loadController(serviceRows, businessRows) {
  const captured = { serviceSelectCalls: 0, populateCalls: 0 };

  const Service = {
    find: () => {
      const chain = buildServiceFindChain(serviceRows);
      const originalSelect = chain.select;
      chain.select = function select(...args) {
        captured.serviceSelectCalls += 1;
        captured.serviceSelect = args[0];
        return originalSelect.apply(this, args);
      };
      const originalPopulate = chain.populate;
      chain.populate = function populate(...args) {
        captured.populateCalls += 1;
        captured.populateArgs = captured.populateArgs || [];
        captured.populateArgs.push(args);
        return originalPopulate.apply(this, args);
      };
      return chain;
    },
    countDocuments: async () => serviceRows.length,
    findOne: async () => null,
    findById: () => ({
      populate() {
        return {
          populate() {
            return {
              populate: async () => null,
            };
          },
        };
      },
    }),
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).endsWith('models/Service')) return Service;
    if (String(request).endsWith('models/Food')) {
      return {
        find: () => buildServiceFindChain([]),
        countDocuments: async () => 0,
      };
    }
    if (String(request).endsWith('models/Business')) {
      return {
        find: () => ({
          select() {
            return { lean: async () => businessRows };
          },
        }),
        findOne: () => ({ select: () => ({ lean: async () => businessRows[0] || null }) }),
      };
    }
    if (String(request).endsWith('models/VendorOnboardingStage1')) {
      return { find: () => ({ select: () => ({ lean: async () => [] }) }) };
    }
    if (String(request).endsWith('models/Review')) return { find: () => ({ populate: async () => [] }) };
    if (String(request).endsWith('models/ServiceCategory')) return { findOne: async () => null };
    if (String(request).endsWith('models/ServiceSubcategory')) return { findOne: async () => null };
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  delete require.cache[filtersPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, captured };
}

test('getAllServices returns populated category, subcategory, and business tags', async () => {
  const serviceRows = [
    {
      _id: '507f1f77bcf86cd799439020',
      title: 'Taxonomy Service',
      description: 'Service with taxonomy',
      businessId,
      isPublished: true,
      price: 45,
      services: [{ name: 'Consultation', price: 45, durationMinutes: 60 }],
      categoryId: {
        _id: '507f1f77bcf86cd799439021',
        name: 'Professional Services',
        slug: 'professional-services',
      },
      subcategoryId: {
        _id: '507f1f77bcf86cd799439022',
        name: 'Business Consulting',
        slug: 'business-consulting',
      },
      features: ['Online Booking'],
    },
  ];

  const businessRows = [
    {
      _id: businessId,
      businessName: 'Taxonomy Vendor',
      badge: 'Silver',
      isApproved: true,
      isActive: true,
      tags: ['Minority-Owned', 'Atlanta'],
    },
  ];

  const { controller } = loadController(serviceRows, businessRows);
  const res = mockResponse();

  await controller.getAllServices({ query: { page: 1, limit: 10 } }, res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);

  const card = res.body.data[0];
  assert.equal(card.category?.name, 'Professional Services');
  assert.equal(card.subcategory?.name, 'Business Consulting');
  assert.deepEqual(card.tags, ['Minority-Owned', 'Atlanta']);
});

test('getServiceById merges business tags into service detail payload', async () => {
  const serviceDoc = {
    _id: '507f1f77bcf86cd799439020',
    title: 'Taxonomy Service',
    description: 'Detail taxonomy',
    isPublished: true,
    price: 45,
    services: [{ name: 'Consultation', price: 45, durationMinutes: 60 }],
    categoryId: {
      _id: '507f1f77bcf86cd799439021',
      name: 'Professional Services',
      slug: 'professional-services',
    },
    subcategoryId: {
      _id: '507f1f77bcf86cd799439022',
      name: 'Business Consulting',
      slug: 'business-consulting',
    },
    businessId: {
      _id: businessId,
      businessName: 'Taxonomy Vendor',
      badge: 'Silver',
      tags: ['Minority-Owned', 'Atlanta'],
      toObject() {
        return { ...this };
      },
    },
    toObject() {
      return { ...this, businessId: this.businessId };
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (String(request).endsWith('models/Service')) {
      return {
        findById: () => ({
          populate() {
            return {
              populate() {
                return {
                  populate: async () => serviceDoc,
                };
              },
            };
          },
        }),
      };
    }
    if (String(request).endsWith('models/Business')) {
      return {
        findOne: () => ({ select: () => ({ lean: async () => ({ _id: businessId }) }) }),
      };
    }
    if (String(request).endsWith('models/VendorOnboardingStage1')) {
      return { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  const res = mockResponse();
  await controller.getServiceById({ params: { id: '507f1f77bcf86cd799439020' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.service.category.name, 'Professional Services');
  assert.equal(res.body.data.service.subcategory.name, 'Business Consulting');
  assert.deepEqual(res.body.data.service.tags, ['Minority-Owned', 'Atlanta']);
});
