const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseListingPrice,
  hasPositiveListingPrice,
  toResponseSalePrice,
  productHasPublishablePrice,
  serviceHasPublishablePrice,
  foodHasPublishablePrice,
  validateProductPublishState,
  validateServicePublishState,
  validateFoodPublishState,
  filterPublishableListings,
  LISTING_PRICE_REQUIRED_CODE,
} = require('../../lib/marketplace/listingPricePolicy');

test('parseListingPrice handles Decimal128-like objects', () => {
  assert.equal(parseListingPrice({ toString: () => '24.50' }), 24.5);
});

test('hasPositiveListingPrice rejects zero and missing values', () => {
  assert.equal(hasPositiveListingPrice(null), false);
  assert.equal(hasPositiveListingPrice(0), false);
  assert.equal(hasPositiveListingPrice(12.5), true);
});

test('productHasPublishablePrice requires a positive variant price when publishing', () => {
  assert.equal(
    productHasPublishablePrice({
      variants: [{ price: 0, isPublished: true }],
    }),
    false
  );
  assert.equal(
    productHasPublishablePrice({
      variants: [{ price: 19.99, isPublished: true }],
    }),
    true
  );
});

test('serviceHasPublishablePrice uses minimum positive child price', () => {
  assert.equal(
    serviceHasPublishablePrice({
      services: [{ name: 'Cut', price: 0, durationMinutes: 30 }],
    }),
    false
  );
  assert.equal(
    serviceHasPublishablePrice({
      services: [{ name: 'Cut', price: 25, durationMinutes: 30 }],
    }),
    true
  );
});

test('foodHasPublishablePrice requires price greater than zero', () => {
  assert.equal(foodHasPublishablePrice({ price: 0 }), false);
  assert.equal(foodHasPublishablePrice({ price: 8 }), true);
});

test('validate publish helpers return LISTING_PRICE_REQUIRED when price is missing', () => {
  const productResult = validateProductPublishState({
    product: {},
    variants: [{ price: 0, isPublished: true }],
    isPublished: true,
  });
  assert.equal(productResult.ok, false);
  assert.equal(productResult.code, LISTING_PRICE_REQUIRED_CODE);

  const serviceResult = validateServicePublishState({
    service: { services: [{ name: 'Cut', price: 0, durationMinutes: 30 }] },
    isPublished: true,
  });
  assert.equal(serviceResult.ok, false);
  assert.equal(serviceResult.code, LISTING_PRICE_REQUIRED_CODE);

  const foodResult = validateFoodPublishState({
    food: { price: 0 },
    isPublished: true,
  });
  assert.equal(foodResult.ok, false);
  assert.equal(foodResult.code, LISTING_PRICE_REQUIRED_CODE);
});

test('filterPublishableListings keeps only priced listings per type', () => {
  const products = filterPublishableListings('product', [
    { price: 0, variants: [] },
    { variants: [{ price: 12, isPublished: true }] },
  ]);
  assert.equal(products.length, 1);

  const services = filterPublishableListings('service', [
    { services: [{ name: 'A', price: 0, durationMinutes: 30 }] },
    { services: [{ name: 'B', price: 40, durationMinutes: 60 }] },
  ]);
  assert.equal(services.length, 1);

  const foods = filterPublishableListings('food', [
    { price: 0 },
    { price: 15 },
  ]);
  assert.equal(foods.length, 1);
});

test('toResponseSalePrice returns null for missing, zero, negative and non-numeric sales', () => {
  const { Types } = require('mongoose');
  assert.equal(toResponseSalePrice(undefined), null);
  assert.equal(toResponseSalePrice(null), null);
  assert.equal(toResponseSalePrice(''), null);
  assert.equal(toResponseSalePrice(0), null);
  assert.equal(toResponseSalePrice(Types.Decimal128.fromString('0')), null);
  assert.equal(toResponseSalePrice({ $numberDecimal: '0' }), null);
  assert.equal(toResponseSalePrice(Types.Decimal128.fromString('-5')), null);
  assert.equal(toResponseSalePrice('abc'), null);
  assert.equal(toResponseSalePrice(NaN), null);
});

test('toResponseSalePrice returns the numeric value for a positive sale', () => {
  const { Types } = require('mongoose');
  assert.equal(toResponseSalePrice(Types.Decimal128.fromString('19.99')), 19.99);
  assert.equal(toResponseSalePrice({ $numberDecimal: '7.5' }), 7.5);
  assert.equal(toResponseSalePrice(12), 12);
  assert.equal(toResponseSalePrice('4.25'), 4.25);
});
