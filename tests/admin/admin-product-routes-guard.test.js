const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminProductRoutesPath = path.resolve(
  __dirname,
  '../../routes/admin/adminProductRoutes.js'
);

test('admin product list and featured toggle remain guarded', () => {
  const source = fs.readFileSync(adminProductRoutesPath, 'utf8');

  assert.match(source, /router\.get\('\/', authenticate, isAdmin, getAllProducts\)/);
  assert.match(
    source,
    /router\.patch\('\/:productId\/featured', authenticate, isAdmin, toggleProductFeatured\)/
  );
});

test('admin product debug /test route audit documents main state pending PR #96', () => {
  const source = fs.readFileSync(adminProductRoutesPath, 'utf8');
  const hasDebugRoute = source.includes("router.get('/test'");

  // On main the unguarded debug route exists until PR #96 merges.
  assert.equal(
    hasDebugRoute,
    true,
    'expected unguarded /test on main — remove assertion after PR #96 merge'
  );
});
