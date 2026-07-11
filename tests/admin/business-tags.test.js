const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBusinessTags } = require('../../lib/admin/businessTags');

test('normalizeBusinessTags trims, dedupes case-insensitively, and caps count', () => {
  assert.deepEqual(
    normalizeBusinessTags([' Organic ', 'organic', 'Local', '', '  ']),
    ['Organic', 'Local']
  );
});

test('normalizeBusinessTags accepts comma-separated strings', () => {
  assert.deepEqual(normalizeBusinessTags('Atlanta, Minority-Owned ,Atlanta'), [
    'Atlanta',
    'Minority-Owned',
  ]);
});

test('normalizeBusinessTags clips long tag values', () => {
  const longTag = 'a'.repeat(80);
  const [result] = normalizeBusinessTags([longTag]);
  assert.equal(result.length, 50);
});

test('admin business routes guard tag update endpoint', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../routes/admin/businessRoutes.js'),
    'utf8'
  );

  assert.match(
    source,
    /router\.put\(\s*['"]\/:id\/tags['"],\s*authenticate,\s*isAdmin,\s*businessController\.updateBusinessTags\s*\)/
  );
  assert.match(
    source,
    /router\.put\(\s*['"]\/:id['"],\s*authenticate,\s*isAdmin,\s*businessController\.updateBusinessProfile\s*\)/
  );
});
