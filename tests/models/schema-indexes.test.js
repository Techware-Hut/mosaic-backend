const test = require('node:test');
const assert = require('node:assert/strict');

const Business = require('../../models/Business');
const ProductVariant = require('../../models/ProductVariant');

function countIndex(schema, expectedFields) {
  const expected = JSON.stringify(expectedFields);

  return schema.indexes().filter(([fields]) => JSON.stringify(fields) === expected).length;
}

test('Business schema does not declare duplicate owner or subscription indexes', () => {
  assert.equal(countIndex(Business.schema, { owner: 1 }), 1);
  assert.equal(countIndex(Business.schema, { subscriptionId: 1 }), 1);
});

test('ProductVariant schema does not duplicate the unique sku index', () => {
  assert.equal(countIndex(ProductVariant.schema, { sku: 1 }), 1);
});
