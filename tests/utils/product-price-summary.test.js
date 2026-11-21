const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  getVariantSummaryPrice,
  summarizeVariantPrices,
} = require('../../utils/productPriceSummary');

const { Decimal128 } = mongoose.Types;
const dec = (value) => Decimal128.fromString(String(value));
const num = (value) => (value === null ? null : Number(value.toString()));

test('Decimal128("0") sale price is ignored and falls back to base price', () => {
  const variant = { price: dec('46.64'), salePrice: dec('0') };
  assert.equal(getVariantSummaryPrice(variant), 46.64);

  const summary = summarizeVariantPrices([variant]);
  assert.equal(num(summary.price), 46.64);
  assert.equal(num(summary.maxPrice), 46.64);
});

test('numeric 0, null, undefined and empty-string sale prices are ignored', () => {
  for (const salePrice of [0, null, undefined, '', '0']) {
    assert.equal(
      getVariantSummaryPrice({ price: dec('20'), salePrice }),
      20,
      `salePrice=${JSON.stringify(salePrice)}`
    );
  }
});

test('negative and non-numeric sale prices are ignored', () => {
  assert.equal(getVariantSummaryPrice({ price: dec('20'), salePrice: dec('-5') }), 20);
  assert.equal(getVariantSummaryPrice({ price: 20, salePrice: 'abc' }), 20);
});

test('a positive sale price wins over base price (Decimal128 or string)', () => {
  assert.equal(getVariantSummaryPrice({ price: dec('20'), salePrice: dec('15.5') }), 15.5);
  assert.equal(getVariantSummaryPrice({ price: '20', salePrice: '12' }), 12);
});

test('summary uses min/max effective price across variants', () => {
  const summary = summarizeVariantPrices([
    { price: dec('30'), salePrice: dec('25') },
    { price: dec('10'), salePrice: dec('0') },
    { price: dec('50'), salePrice: null },
  ]);
  assert.equal(num(summary.price), 10);
  assert.equal(num(summary.maxPrice), 50);
  assert.ok(summary.price instanceof Decimal128);
});

test('soft-deleted variants are excluded', () => {
  const summary = summarizeVariantPrices([
    { price: dec('5'), isDeleted: true },
    { price: dec('40'), salePrice: dec('0'), isDeleted: false },
  ]);
  assert.equal(num(summary.price), 40);
  assert.equal(num(summary.maxPrice), 40);
});

test('no variants (or only deleted / unusable ones) yields null price fields', () => {
  assert.deepEqual(summarizeVariantPrices([]), { price: null, maxPrice: null });
  assert.deepEqual(summarizeVariantPrices(undefined), { price: null, maxPrice: null });
  assert.deepEqual(
    summarizeVariantPrices([{ price: dec('9'), isDeleted: true }, { price: null }]),
    { price: null, maxPrice: null }
  );
});
