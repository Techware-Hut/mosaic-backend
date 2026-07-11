const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/admin/adminReviewController.js'
);
const reviewControllerPath = path.resolve(
  __dirname,
  '../../controllers/reviewController.js'
);
const routesPath = path.resolve(
  __dirname,
  '../../routes/admin/adminReviewRoutes.js'
);
const appPath = path.resolve(__dirname, '../../app.js');

const validReviewId = '507f1f77bcf86cd799439011';
const validListingId = '507f1f77bcf86cd799439012';
const validUserId = '507f1f77bcf86cd799439013';
const validBusinessId = '507f1f77bcf86cd799439014';

const makeRes = () => ({
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
});

const makeReviewFindChain = (reviews) => ({
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  lean: async () => reviews,
});

const loadAdminReviewController = (overrides = {}) => {
  const Review = overrides.Review || {
    find: () => makeReviewFindChain([]),
    countDocuments: async () => 0,
    findById: async () => null,
  };
  const User = overrides.User || {
    find: () => ({
      select: () => ({
        lean: async () => [],
      }),
    }),
  };
  const Business = overrides.Business || {
    find: () => ({
      select: () => ({
        lean: async () => [],
      }),
    }),
  };
  const reviewService = {
    LISTING_MODELS: overrides.LISTING_MODELS || {
      product: {
        find: () => ({
          select: () => ({
            lean: async () => [],
          }),
        }),
      },
      service: {
        find: () => ({
          select: () => ({
            lean: async () => [],
          }),
        }),
      },
      food: {
        find: () => ({
          select: () => ({
            lean: async () => [],
          }),
        }),
      },
    },
    refreshListingReviewStats: overrides.refreshListingReviewStats || (async () => ({
      totalReviews: 0,
      averageRating: 0,
      ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    })),
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request.endsWith('models/Review')) return Review;
    if (request.endsWith('models/User')) return User;
    if (request.endsWith('models/Business')) return Business;
    if (request.endsWith('services/reviewService')) return reviewService;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
};

test('admin review routes are guarded and mapped correctly', () => {
  const routesSource = fs.readFileSync(routesPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');

  assert.match(routesSource, /router\.use\(authenticate, isAdmin\)/);
  assert.match(routesSource, /router\.get\('\/', listAllPlatformReviews\)/);
  assert.match(
    routesSource,
    /router\.patch\('\/:reviewId\/moderation', toggleReviewVisibility\)/
  );
  assert.match(routesSource, /router\.delete\('\/:reviewId', removePlatformReview\)/);
  assert.match(appSource, /app\.use\('\/api\/admin\/reviews', adminReviewRoutes\)/);
});

test('listAllPlatformReviews returns enriched user, listing, and business data', async () => {
  const review = {
    _id: validReviewId,
    userId: validUserId,
    listingId: validListingId,
    listingType: 'product',
    rating: 5,
    comment: 'Excellent quality.',
    image: '',
    isHidden: false,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
  };

  const controller = loadAdminReviewController({
    Review: {
      find: () => makeReviewFindChain([review]),
      countDocuments: async () => 1,
    },
    User: {
      find: () => ({
        select: () => ({
          lean: async () => [
            {
              _id: validUserId,
              name: 'Platform Customer',
              email: 'customer@example.test',
              profileImage: 'https://example.test/avatar.png',
            },
          ],
        }),
      }),
    },
    LISTING_MODELS: {
      product: {
        find: () => ({
          select: () => ({
            lean: async () => [
              {
                _id: validListingId,
                title: 'Handmade Candle',
                slug: 'handmade-candle',
                businessId: validBusinessId,
                coverImage: 'https://example.test/candle.jpg',
                isDeleted: false,
              },
            ],
          }),
        }),
      },
      service: {
        find: () => ({
          select: () => ({
            lean: async () => [],
          }),
        }),
      },
      food: {
        find: () => ({
          select: () => ({
            lean: async () => [],
          }),
        }),
      },
    },
    Business: {
      find: () => ({
        select: () => ({
          lean: async () => [
            {
              _id: validBusinessId,
              businessName: 'Artisan Vendor',
              slug: 'artisan-vendor',
              logo: 'https://example.test/logo.png',
            },
          ],
        }),
      }),
    },
  });

  const res = makeRes();
  await controller.listAllPlatformReviews({ query: { page: '1', limit: '25' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.reviews.length, 1);

  const record = res.body.data.reviews[0];
  assert.equal(record._id, validReviewId);
  assert.equal(record.user.email, 'customer@example.test');
  assert.equal(record.listing.title, 'Handmade Candle');
  assert.equal(record.listing.listingType, 'product');
  assert.equal(record.business.businessName, 'Artisan Vendor');
  assert.equal(record.business._id, validBusinessId);
});

test('listAllPlatformReviews supports listingType and isHidden filters', async () => {
  let capturedFilter;

  const controller = loadAdminReviewController({
    Review: {
      find: (filter) => {
        capturedFilter = filter;
        return makeReviewFindChain([]);
      },
      countDocuments: async () => 0,
    },
  });

  const res = makeRes();
  await controller.listAllPlatformReviews(
    { query: { listingType: 'service', isHidden: 'true', page: '2', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(capturedFilter.listingType, 'service');
  assert.equal(capturedFilter.isHidden, true);
});

test('toggleReviewVisibility flips isHidden, sets moderatedAt, and refreshes listing stats', async () => {
  let refreshArgs;
  const reviewDoc = {
    _id: validReviewId,
    listingId: validListingId,
    listingType: 'product',
    isHidden: false,
    moderatedAt: null,
    save: async function save() {
      this.saved = true;
    },
  };

  const controller = loadAdminReviewController({
    Review: {
      findById: async () => reviewDoc,
    },
    refreshListingReviewStats: async (listingId, listingType) => {
      refreshArgs = { listingId, listingType };
      return {
        totalReviews: 2,
        averageRating: 4.5,
        ratingBreakdown: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
      };
    },
  });

  const res = makeRes();
  await controller.toggleReviewVisibility({ params: { reviewId: validReviewId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.review.isHidden, true);
  assert.ok(res.body.data.review.moderatedAt);
  assert.equal(reviewDoc.saved, true);
  assert.deepEqual(refreshArgs, {
    listingId: validListingId,
    listingType: 'product',
  });
  assert.equal(res.body.data.summary.totalReviews, 2);
});

test('toggleReviewVisibility restores a hidden review when toggled again', async () => {
  const reviewDoc = {
    _id: validReviewId,
    listingId: validListingId,
    listingType: 'food',
    isHidden: true,
    moderatedAt: new Date('2026-06-01T00:00:00.000Z'),
    save: async function save() {
      this.saved = true;
    },
  };

  const controller = loadAdminReviewController({
    Review: {
      findById: async () => reviewDoc,
    },
  });

  const res = makeRes();
  await controller.toggleReviewVisibility({ params: { reviewId: validReviewId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.review.isHidden, false);
  assert.match(res.body.message, /restored/i);
});

test('removePlatformReview permanently deletes a review and refreshes listing stats', async () => {
  let refreshArgs;
  let deleted;
  const reviewDoc = {
    _id: validReviewId,
    listingId: validListingId,
    listingType: 'service',
    deleteOne: async function deleteOne() {
      deleted = true;
    },
  };

  const controller = loadAdminReviewController({
    Review: {
      findById: async () => reviewDoc,
    },
    refreshListingReviewStats: async (listingId, listingType) => {
      refreshArgs = { listingId, listingType };
      return {
        totalReviews: 0,
        averageRating: 0,
        ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      };
    },
  });

  const res = makeRes();
  await controller.removePlatformReview({ params: { reviewId: validReviewId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(deleted, true);
  assert.equal(res.body.data.reviewId, validReviewId);
  assert.deepEqual(refreshArgs, {
    listingId: validListingId,
    listingType: 'service',
  });
  assert.equal(res.body.data.summary.totalReviews, 0);
});

test('listReviews excludes hidden reviews from public listing queries', async () => {
  let capturedFilter;
  const Review = {
    find: (filter) => {
      capturedFilter = filter;
      return {
        populate() {
          return {
            sort() {
              return {
                skip() {
                  return {
                    limit() {
                      return {
                        lean: async () => [],
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    countDocuments: async () => 0,
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Review') return Review;
    if (request === '../services/reviewService') {
      return {
        LISTING_MODELS: {
          product: {
            findById: () => ({
              select: () => ({
                lean: async () => ({ _id: validListingId, isDeleted: false }),
              }),
            }),
          },
        },
        getReviewSummary: async () => ({
          totalReviews: 0,
          averageRating: 0,
          ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[reviewControllerPath];
  const { listReviews } = require(reviewControllerPath);
  Module._load = originalLoad;

  const res = makeRes();
  await listReviews('product')(
    { params: { productId: validListingId }, query: { page: '1', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(capturedFilter, {
    listingId: validListingId,
    listingType: 'product',
    isHidden: { $ne: true },
  });
});

test('getReviewSummary aggregate excludes hidden reviews from listing stats', async () => {
  let capturedPipeline;
  const Review = {
    aggregate: async (pipeline) => {
      capturedPipeline = pipeline;
      return [{ totalReviews: 1, averageRating: 5 }];
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Review') return Review;
    return originalLoad.call(this, request, parent, isMain);
  };

  const servicePath = path.resolve(__dirname, '../../services/reviewService.js');
  delete require.cache[servicePath];
  const { getReviewSummary } = require(servicePath);
  Module._load = originalLoad;

  await getReviewSummary(validListingId, 'product');

  assert.equal(capturedPipeline[0].$match.isHidden.$ne, true);
});
