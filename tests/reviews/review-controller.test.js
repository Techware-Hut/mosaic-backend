const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/reviewController.js');
const validListingId = '507f1f77bcf86cd799439011';
const validReviewId = '507f1f77bcf86cd799439012';
const validUserId = '507f1f77bcf86cd799439013';

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

const makeListingModel = (listing = { _id: validListingId, isDeleted: false }) => ({
  findById: () => ({
    select: () => ({
      lean: async () => listing,
    }),
  }),
});

const makeReviewFindChain = (reviews) => ({
  populate() {
    return this;
  },
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

const loadController = ({ Review, listingModel = makeListingModel(), reviewService = {} }) => {
  const service = {
    LISTING_MODELS: {
      product: listingModel,
      service: listingModel,
      food: listingModel,
    },
    getReviewSummary: async () => ({
      totalReviews: 1,
      averageRating: 5,
      ratingBreakdown: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
    }),
    refreshListingReviewStats: async () => ({
      totalReviews: 1,
      averageRating: 5,
      ratingBreakdown: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
    }),
    ...reviewService,
  };

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '../models/Review') return Review;
    if (request === '../services/reviewService') return service;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
};

test('listReviews returns only safe public review fields', async () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-01-02T00:00:00.000Z');
  const rawReview = {
    _id: validReviewId,
    userId: {
      _id: validUserId,
      name: 'E2E Customer',
      profileImage: 'https://example.test/customer.png',
      email: 'customer@example.test',
      passwordHash: 'secret',
      otp: 'secret',
      sessionVersion: 4,
    },
    listingId: validListingId,
    listingType: 'product',
    rating: 5,
    comment: 'Great product.',
    image: 'https://example.test/review.png',
    createdAt,
    updatedAt,
    __v: 0,
    internalNote: 'do not expose',
  };

  const Review = {
    find: () => makeReviewFindChain([rawReview]),
    countDocuments: async () => 1,
  };
  const controller = loadController({ Review });
  const res = makeRes();

  await controller.listReviews('product')(
    { params: { productId: validListingId }, query: { page: '1', limit: '10' } },
    res
  );

  assert.equal(res.statusCode, 200);
  const review = res.body.data.reviews[0];
  assert.deepEqual(Object.keys(review).sort(), [
    '_id',
    'comment',
    'createdAt',
    'image',
    'listingId',
    'listingType',
    'rating',
    'updatedAt',
    'userId',
  ].sort());
  assert.deepEqual(Object.keys(review.userId).sort(), ['_id', 'name', 'profileImage'].sort());
  assert.equal(review.userId.email, undefined);
  assert.equal(review.userId.passwordHash, undefined);
  assert.equal(review.__v, undefined);
  assert.equal(review.internalNote, undefined);
  assert.equal(review.createdAt, createdAt.toISOString());
});

test('upsertReview rejects ratings outside the 1 to 5 range', async () => {
  const Review = {
    findOne: async () => null,
  };
  const controller = loadController({ Review });
  const res = makeRes();

  await controller.upsertReview('product')(
    {
      params: { productId: validListingId },
      user: { _id: validUserId },
      body: { rating: 6, comment: 'Too much.' },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /between 1 and 5/i);
});

test('upsertReview updates an existing customer review instead of creating a duplicate', async () => {
  let savedReview;
  let refreshArgs;
  const existingReview = {
    _id: validReviewId,
    userId: validUserId,
    listingId: validListingId,
    listingType: 'product',
    rating: 3,
    comment: 'Old comment.',
    save: async function save() {
      savedReview = { rating: this.rating, comment: this.comment, image: this.image };
    },
  };

  const Review = {
    findOne: async (query) => {
      assert.equal(query.userId, validUserId);
      assert.equal(query.listingId, validListingId);
      assert.equal(query.listingType, 'product');
      return existingReview;
    },
    findById: () => ({
      populate: () => ({
        lean: async () => ({
          _id: validReviewId,
          userId: { _id: validUserId, name: 'E2E Customer', profileImage: '' },
          listingId: validListingId,
          listingType: 'product',
          rating: 4,
          comment: 'Updated comment.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          __v: 0,
        }),
      }),
    }),
  };
  const controller = loadController({
    Review,
    reviewService: {
      refreshListingReviewStats: async (listingId, listingType) => {
        refreshArgs = { listingId, listingType };
        return { totalReviews: 1, averageRating: 4, ratingBreakdown: { 4: 1 } };
      },
    },
  });
  const res = makeRes();

  await controller.upsertReview('product')(
    {
      params: { productId: validListingId },
      user: { _id: validUserId },
      body: { rating: 4, comment: 'Updated comment.' },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, 'Review updated successfully');
  assert.deepEqual(savedReview, { rating: 4, comment: 'Updated comment.', image: undefined });
  assert.deepEqual(refreshArgs, { listingId: validListingId, listingType: 'product' });
  assert.equal(res.body.data.review.__v, undefined);
});

test('deleteReview scopes deletion to the requesting customer', async () => {
  let capturedQuery;
  const Review = {
    findOne: async (query) => {
      capturedQuery = query;
      return null;
    },
  };
  const controller = loadController({ Review });
  const res = makeRes();

  await controller.deleteReview('product')(
    {
      params: { productId: validListingId, reviewId: validReviewId },
      user: { _id: validUserId },
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(capturedQuery, {
    _id: validReviewId,
    listingId: validListingId,
    listingType: 'product',
    userId: validUserId,
  });
});

test('product, service, and food review mutations require customer auth middleware', () => {
  const routeChecks = [
    {
      file: path.resolve(__dirname, '../../routes/productRoutes.js'),
      post: /router\.post\(\s*['"]\/:productId\/reviews['"][\s\S]*authenticate[\s\S]*isCustomer[\s\S]*upsertReview/,
      del: /router\.delete\(\s*['"]\/:productId\/reviews\/:reviewId['"][\s\S]*authenticate[\s\S]*isCustomer[\s\S]*deleteReview/,
    },
    {
      file: path.resolve(__dirname, '../../routes/serviceRoutes.js'),
      post: /router\.post\(\s*['"]\/:serviceId\/reviews['"][\s\S]*authenticate[\s\S]*isCustomer[\s\S]*upsertReview/,
      del: /router\.delete\(\s*['"]\/:serviceId\/reviews\/:reviewId['"][\s\S]*authenticate[\s\S]*isCustomer[\s\S]*deleteReview/,
    },
    {
      file: path.resolve(__dirname, '../../routes/foodRoutes.js'),
      post: /router\.post\(\s*['"]\/:foodId\/reviews['"][\s\S]*authenticate[\s\S]*isCustomer[\s\S]*upsertReview/,
      del: /router\.delete\(\s*['"]\/:foodId\/reviews\/:reviewId['"][\s\S]*authenticate[\s\S]*isCustomer[\s\S]*deleteReview/,
    },
  ];

  for (const check of routeChecks) {
    const source = fs.readFileSync(check.file, 'utf8');
    assert.match(source, check.post, `${path.basename(check.file)} review POST is not customer-guarded`);
    assert.match(source, check.del, `${path.basename(check.file)} review DELETE is not customer-guarded`);
  }
});
