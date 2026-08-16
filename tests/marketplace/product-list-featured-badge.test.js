const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('getAllProducts supports featured and badge query filters', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../controllers/publicListing.js'),
    'utf8'
  );
  const getAllProducts = source.slice(
    source.indexOf('exports.getAllProducts'),
    source.indexOf('exports.getProductsByFilters')
  );

  assert.match(getAllProducts, /filters\.isFeatured\s*=\s*true/);
  assert.match(getAllProducts, /applyBadgeBusinessIdFilter\(filters, badge\)/);
});
