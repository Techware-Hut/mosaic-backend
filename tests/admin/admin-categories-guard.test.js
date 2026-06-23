const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const categoryRoutesPath = path.resolve(__dirname, '../../routes/categoryRoutes.js');

test('GET /api/admin/categories is registered without auth middleware (documented public exposure)', () => {
  const source = fs.readFileSync(categoryRoutesPath, 'utf8');

  assert.match(source, /router\.get\('\/admin\/categories', getAllCategoriesAdmin\)/);
  const adminBlock = source.slice(source.indexOf("router.get('/admin/categories'"));
  assert.ok(!adminBlock.includes('authenticate'), 'no authenticate on admin categories route');
  assert.ok(!adminBlock.includes('isAdmin'), 'no isAdmin on admin categories route');
});
