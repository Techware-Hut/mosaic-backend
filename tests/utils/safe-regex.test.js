const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  escapeRegex,
  exactCaseInsensitiveRegex,
  containsCaseInsensitiveRegex,
} = require('../../utils/safeRegex');

test('business names with regex characters never throw and match only themselves', () => {
  for (const name of ['C++', 'A.B (Co)', 'Joe\'s [Bakery]', 'Price $5*', 'a|b', '\\path']) {
    const rx = exactCaseInsensitiveRegex(name);
    assert.ok(rx.test(name), `${name} must match itself`);
    assert.ok(rx.test(name.toUpperCase()), `${name} match is case-insensitive`);
  }
  assert.equal(exactCaseInsensitiveRegex('A.B').test('AxB'), false, '"." is literal');
  assert.equal(exactCaseInsensitiveRegex('Shop').test('Shop Two'), false, 'exact, not prefix');
  assert.equal(containsCaseInsensitiveRegex('St. (Louis').test('Downtown st. (louis'), true);
  assert.equal(escapeRegex('a.b*'), 'a\\.b\\*');
});

test('the unescaped pattern the controllers used to build would throw or mis-match', () => {
  assert.throws(() => new RegExp('^C++$', 'i'));
  assert.ok(new RegExp('^A.B$', 'i').test('AxB'));
});

test('controllers no longer build RegExps from raw user text', () => {
  const files = [
    'controllers/stripeController.js',
    'controllers/businessController.js',
    'controllers/productListingController.js',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    // `^${name}$` templates or new RegExp(variable, ...) without escaping.
    const matches = src.match(/new RegExp\(\s*`\^\$\{(?!\s*escape)[^`]*`|new RegExp\(\s*(?:location|businessName|nameToCheck|businessNameToCheck|req\.body\.businessName)\s*,/g) || [];
    // Inline-escaped templates (`.replace(/[.*+?^${}()|[\]\\]/g, ...)`) are safe.
    const unsafe = matches.filter((m) => !m.includes('.replace(/[.*+?^'));
    assert.deepEqual(unsafe, [], `${rel} still builds an unescaped RegExp: ${unsafe}`);
  }
});

test('all regex punctuation is literal in exact and location contains filters', () => {
  for (const value of ['C++', 'A.B', '+', '.', '*', '?', '[]', '()', '/', '^', '$', String.fromCharCode(92)]) {
    const exact = exactCaseInsensitiveRegex(value);
    assert.ok(exact.test(value));
    assert.equal(exact.test('prefix' + value), false);
    const contains = containsCaseInsensitiveRegex(value);
    assert.ok(contains.test('City ' + value + ' State'));
    assert.equal(contains.test('unrelated'), false);
  }
  assert.equal(exactCaseInsensitiveRegex('C++').test('C'), false);
  assert.ok(exactCaseInsensitiveRegex('Ordinary Cafe').test('ordinary CAFE'));
  assert.ok(containsCaseInsensitiveRegex('New York').test('Downtown NEW YORK State'));
  assert.equal(containsCaseInsensitiveRegex('St. Louis').test('Stx Louis'), false);
});

test('free-text Mongo filters never use raw request values', () => {
  for (const file of ['controllers/businessController.js', 'controllers/categoryController.js', 'controllers/privateListing.js', 'controllers/publicListing.js', 'services/productListingService.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
      .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(source, /\$regex:\s*(?:search|city|state|country)\s*[,}]/, file);
    assert.doesNotMatch(source, /\$regex:\s*String\((?:q|brand|minorityType)\)/, file);
  }
  const ranked = fs.readFileSync(path.resolve(__dirname, '../../controllers/productListingController.js'), 'utf8');
  assert.doesNotMatch(ranked, /new RegExp\(/);
});
