const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const categoryRoutesPath = path.resolve(__dirname, '../../routes/categoryRoutes.js');

test('GET /api/admin/categories requires authenticate and isAdmin middleware', () => {
  const source = fs.readFileSync(categoryRoutesPath, 'utf8');

  assert.match(
    source,
    /router\.get\('\/admin\/categories', authenticate, isAdmin, getAllCategoriesAdmin\)/
  );
});
