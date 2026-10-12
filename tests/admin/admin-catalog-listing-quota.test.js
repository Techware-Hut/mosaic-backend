"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/admin/adminCatalog.controller.js'
);
const listingQuotaServicePath = path.resolve(__dirname, '../../services/listingQuotaService.js');
const publicMarketplaceStatesPath = path.resolve(
  __dirname,
  '../../lib/listing/publicMarketplaceStates.js'
);

const adminId = '507f1f77bcf86cd799439001';
const ownerId = '507f1f77bcf86cd799439002';
const businessId = '507f1f77bcf86cd799439003';
const subscriptionId = '507f1f77bcf86cd799439004';
const planId = '507f1f77bcf86cd799439005';
const listingId = '507f1f77bcf86cd799439006';

const AUDIT_ACTIONS = Object.freeze({
  CATALOG_UPDATE: 'catalog.update',
  CATALOG_DEACTIVATE: 'catalog.deactivate',
  CATALOG_ACTIVATE: 'catalog.activate',
  CATALOG_DELETE: 'catalog.delete',
});

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

function buildListing(type, captured, overrides = {}) {
  const listing = {
    _id: listingId,
    businessId,
    ownerId,
    title: `${type} listing`,
    description: 'Complete listing description',
    price: 25,
    coverImage: 'cover.jpg',
    isActive: true,
    isPublished: true,
    isDeleted: false,
    wasPublishedAtDeactivation: false,
    adminRemark: '',
    services: type === 'service'
      ? [
          { name: 'One', price: 10, durationMinutes: 30 },
          { name: 'Two', price: 20, durationMinutes: 45 },
          { name: 'Three', price: 30, durationMinutes: 60 },
        ]
      : undefined,
    async save() {
      captured.saveCalls += 1;
      return this;
    },
    toObject() {
      return {
        _id: this._id,
        businessId: this.businessId,
        ownerId: this.ownerId,
        title: this.title,
        description: this.description,
        price: this.price,
        coverImage: this.coverImage,
        isActive: this.isActive,
        isPublished: this.isPublished,
        isDeleted: this.isDeleted,
        wasPublishedAtDeactivation: this.wasPublishedAtDeactivation,
        adminRemark: this.adminRemark,
        services: this.services,
        adminModeratedAt: this.adminModeratedAt,
        adminModeratedBy: this.adminModeratedBy,
      };
    },
    ...overrides,
  };
  return listing;
}

function loadAdminCatalogController(options = {}) {
  const type = options.type || 'product';
  const captured = {
    findOneQueries: [],
    productCountQueries: [],
    servicePipelines: [],
    foodCountQueries: [],
    productVariantExistsQueries: [],
    businessFindById: [],
    subscriptionFindById: [],
    subscriptionFallbackCalls: 0,
    planFindById: [],
    saveCalls: 0,
    auditCalls: [],
    changeSummaryCalls: [],
  };
  const listing = buildListing(type, captured, options.listing || {});

  const Product = {
    async findOne(query) {
      captured.findOneQueries.push({ type: 'product', query });
      return type === 'product' ? listing : null;
    },
    async countDocuments(query) {
      captured.productCountQueries.push(query);
      return options.productCurrent ?? 0;
    },
  };
  const Service = {
    async findOne(query) {
      captured.findOneQueries.push({ type: 'service', query });
      return type === 'service' ? listing : null;
    },
    async aggregate(pipeline) {
      captured.servicePipelines.push(pipeline);
      return [{ _id: null, total: options.serviceCurrent ?? 0 }];
    },
  };
  const Food = {
    async findOne(query) {
      captured.findOneQueries.push({ type: 'food', query });
      return type === 'food' ? listing : null;
    },
    async countDocuments(query) {
      captured.foodCountQueries.push(query);
      return options.foodCurrent ?? 0;
    },
  };
  const ProductVariant = {
    async exists(query) {
      captured.productVariantExistsQueries.push(query);
      return Boolean(options.hasPublishedVariant);
    },
  };
  const business = {
    _id: businessId,
    owner: ownerId,
    subscriptionId,
    subscriptionPlanId: planId,
  };
  const Business = {
    async findById(id) {
      captured.businessFindById.push(id);
      return business;
    },
  };
  const Subscription = {
    async findById(id) {
      captured.subscriptionFindById.push(id);
      return {
        _id: subscriptionId,
        userId: ownerId,
        businessId,
        subscriptionPlanId: planId,
        status: 'active',
        paymentStatus: 'PENDING',
        endDate: new Date('2099-01-01T00:00:00.000Z'),
      };
    },
    findOne() {
      captured.subscriptionFallbackCalls += 1;
      return { sort: async () => null };
    },
  };
  const SubscriptionPlan = {
    async findById(id) {
      captured.planFindById.push(id);
      return {
        _id: planId,
        name: 'Silver Plan',
        limits: {
          productListings: 1,
          serviceListings: 1,
          foodListings: 1,
        },
      };
    },
  };

  const auditService = {
    async recordAdminAuditSuccess(req, payload) {
      captured.auditCalls.push({ req, payload });
    },
    buildFieldChangeSummary(before, after, fields) {
      captured.changeSummaryCalls.push({ before, after, fields });
      return { fields };
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Product')) return Product;
    if (request.endsWith('models/ProductVariant')) return ProductVariant;
    if (request.endsWith('models/Service')) return Service;
    if (request.endsWith('models/Food')) return Food;
    if (request.endsWith('models/Business')) return Business;
    if (request.endsWith('models/Subscription')) return Subscription;
    if (request.endsWith('models/SubscriptionPlan')) return SubscriptionPlan;
    if (request.endsWith('services/adminAuditService')) return auditService;
    if (request.endsWith('utils/audit/actionRegistry')) {
      return {
        ADMIN_AUDIT_ACTIONS: AUDIT_ACTIONS,
        ADMIN_AUDIT_TARGET_TYPES: { CATALOG_LISTING: 'catalog_listing' },
      };
    }
    if (request.endsWith('utils/bookingDeleteGuards')) {
      return {
        hasActiveFoodBookings: async () => false,
        hasActiveServiceBookings: async () => false,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  let controller;
  try {
    delete require.cache[controllerPath];
    delete require.cache[listingQuotaServicePath];
    delete require.cache[publicMarketplaceStatesPath];
    controller = require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }

  return { controller, listing, captured };
}

function request(type, body) {
  return {
    params: { type, id: listingId },
    body,
    user: { _id: adminId },
  };
}

function assertExactEntitlement(captured) {
  assert.deepEqual(captured.businessFindById, [businessId]);
  assert.deepEqual(captured.subscriptionFindById, [subscriptionId]);
  assert.equal(captured.subscriptionFallbackCalls, 0);
  assert.deepEqual(captured.planFindById, [planId]);
}

test('reactivating an inactive published product at the Silver cap blocks before save and audit', async () => {
  const { controller, listing, captured } = loadAdminCatalogController({
    type: 'product',
    productCurrent: 10,
    listing: {
      isActive: false,
      isPublished: true,
      wasPublishedAtDeactivation: true,
    },
  });
  const res = mockResponse();

  await controller.updateCatalogItem(request('product', { isActive: true }), res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    code: 'LISTING_LIMIT_REACHED',
    message: 'Product listing limit reached for Silver. Limit 10, current 10, attempted increase 1.',
    error: 'Product listing limit reached for Silver. Limit 10, current 10, attempted increase 1.',
    listingType: 'product',
    tier: 'Silver',
    limit: 10,
    current: 10,
    attemptedIncrease: 1,
    remaining: 0,
  });
  assert.equal(listing.isActive, false);
  assert.equal(listing.isPublished, true);
  assert.equal(captured.saveCalls, 0);
  assert.equal(captured.auditCalls.length, 0);
  assert.deepEqual(captured.productCountQueries, [{
    businessId,
    isDeleted: false,
    isPublished: true,
    isActive: { $ne: false },
  }]);
  assertExactEntitlement(captured);
});

test('metadata edit on an already-published active product remains allowed above a downgraded cap', async () => {
  const { controller, listing, captured } = loadAdminCatalogController({
    type: 'product',
    productCurrent: 25,
    listing: { isActive: true, isPublished: true },
  });
  const res = mockResponse();

  await controller.updateCatalogItem(request('product', {
    title: '  Updated metadata  ',
    adminRemark: '  Copy correction  ',
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(listing.title, 'Updated metadata');
  assert.equal(listing.adminRemark, 'Copy correction');
  assert.equal(listing.isPublished, true);
  assert.equal(listing.isActive, true);
  assert.equal(captured.productCountQueries.length, 0);
  assert.equal(captured.businessFindById.length, 0);
  assert.equal(captured.saveCalls, 1);
  assert.equal(captured.auditCalls.length, 1);
  assert.equal(captured.auditCalls[0].payload.actionCode, AUDIT_ACTIONS.CATALOG_UPDATE);
});

test('deactivation remains allowed and hides without auto-deleting or unpublishing the product', async () => {
  const { controller, listing, captured } = loadAdminCatalogController({
    type: 'product',
    productCurrent: 25,
    listing: { isActive: true, isPublished: true, isDeleted: false },
  });
  const res = mockResponse();

  await controller.updateCatalogItem(request('product', {
    isActive: false,
    adminRemark: 'Temporarily hidden',
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(listing.isActive, false);
  assert.equal(listing.isPublished, true);
  assert.equal(listing.isDeleted, false);
  assert.equal(listing.wasPublishedAtDeactivation, true);
  assert.equal(captured.productCountQueries.length, 0);
  assert.equal(captured.businessFindById.length, 0);
  assert.equal(captured.saveCalls, 1);
  assert.equal(captured.auditCalls.length, 1);
  assert.equal(captured.auditCalls[0].payload.actionCode, AUDIT_ACTIONS.CATALOG_DEACTIVATE);
});

test('service reactivation uses embedded child offering count as the attempted increase', async () => {
  const { controller, listing, captured } = loadAdminCatalogController({
    type: 'service',
    serviceCurrent: 3,
    listing: {
      isActive: false,
      isPublished: true,
      wasPublishedAtDeactivation: true,
      services: [
        { name: 'One', price: 10, durationMinutes: 30 },
        { name: 'Two', price: 20, durationMinutes: 45 },
        { name: 'Three', price: 30, durationMinutes: 60 },
      ],
    },
  });
  const res = mockResponse();

  await controller.updateCatalogItem(request('service', { isActive: true }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'LISTING_LIMIT_REACHED');
  assert.equal(res.body.listingType, 'service');
  assert.equal(res.body.limit, 5);
  assert.equal(res.body.current, 3);
  assert.equal(res.body.attemptedIncrease, 3);
  assert.equal(res.body.remaining, 2);
  assert.equal(listing.isActive, false);
  assert.equal(captured.saveCalls, 0);
  assert.equal(captured.auditCalls.length, 0);
  assert.deepEqual(captured.servicePipelines, [[
    {
      $match: {
        businessId,
        isPublished: true,
        isActive: { $ne: false },
      },
    },
    {
      $project: {
        offeringCount: { $size: { $ifNull: ['$services', []] } },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$offeringCount' },
      },
    },
  ]]);
  assertExactEntitlement(captured);
});
