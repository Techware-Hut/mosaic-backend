const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateGalleryImageChange,
  evaluateGalleryImageCount,
  getGalleryImageLimit,
  parseCurrentImageCount,
} = require('../../utils/galleryImageLimits');

test('create rejects a persisted gallery above the plan limit', () => {
  const result = evaluateGalleryImageChange({
    listingType: 'product',
    currentImages: [],
    nextImages: ['1', '2', '3', '4', '5', '6'],
    limit: 5,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'IMAGE_LIMIT_REACHED');
  assert.equal(result.limit, 5);
  assert.equal(result.current, 0);
  assert.equal(result.next, 6);
});

test('update rejects an increase above the current tier image limit', () => {
  const result = evaluateGalleryImageChange({
    listingType: 'service',
    currentImages: ['1', '2', '3', '4'],
    nextImages: ['1', '2', '3', '4', '5', '6'],
    limit: 5,
  });

  assert.equal(result.ok, false);
  assert.equal(result.attemptedIncrease, 2);
  assert.equal(result.remaining, 1);
});

test('downgrade keeps unchanged over-limit galleries editable', () => {
  const images = ['1', '2', '3', '4', '5', '6', '7'];
  const result = evaluateGalleryImageChange({
    listingType: 'food',
    currentImages: images,
    nextImages: images,
    limit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.current, 7);
  assert.equal(result.next, 7);
});

test('downgrade allows reducing a gallery that remains above the new limit', () => {
  const result = evaluateGalleryImageChange({
    listingType: 'product',
    currentImages: ['1', '2', '3', '4', '5', '6', '7'],
    nextImages: ['1', '2', '3', '4', '5', '6'],
    limit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.attemptedIncrease, 0);
});

test('presign count check blocks the next gallery image at the limit', () => {
  const result = evaluateGalleryImageCount({
    listingType: 'product',
    currentCount: 5,
    nextCount: 6,
    limit: 5,
    status: 403,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'IMAGE_LIMIT_REACHED');
});

test('client gallery counts reject negative, fractional, and nonnumeric values', () => {
  for (const value of ['-1', '1.5', 'NaN']) {
    const result = parseCurrentImageCount(value);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_IMAGE_COUNT');
  }
});

test('omitted client gallery count remains backward compatible but non-authoritative', () => {
  assert.deepEqual(parseCurrentImageCount(undefined), {
    ok: true,
    count: 0,
    provided: false,
  });
});

test('gallery limit resolves the existing plan field without inventing a value', () => {
  assert.equal(getGalleryImageLimit({ limits: { imageLimit: 7 } }), 7);
  assert.equal(getGalleryImageLimit({ limits: { galleryImageLimit: 9, imageLimit: 7 } }), 9);
  assert.equal(getGalleryImageLimit({ limits: {} }), 0);
});
