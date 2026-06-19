const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminProductRoutesPath = path.resolve(
  __dirname,
  '../../routes/admin/adminProductRoutes.js'
);

test('admin product routes do not expose unauthenticated /test debug endpoint', () => {
  const source = fs.readFileSync(adminProductRoutesPath, 'utf8');

  assert.ok(!source.includes("router.get('/test'"), 'debug /test route must be removed');
  assert.ok(!source.includes('Admin product routes working'));
});

test('admin product list and featured toggle remain guarded', () => {
  const source = fs.readFileSync(adminProductRoutesPath, 'utf8');

  assert.match(source, /router\.get\('\/', authenticate, isAdmin, getAllProducts\)/);
  assert.match(
    source,
    /router\.patch\('\/:productId\/featured', authenticate, isAdmin, toggleProductFeatured\)/
  );
});

test('admin product routes only register guarded handlers', () => {
  const source = fs.readFileSync(adminProductRoutesPath, 'utf8');
  const routeMatches = [...source.matchAll(/router\.(get|post|put|patch|delete)\(/g)];

  assert.equal(routeMatches.length, 2, 'expected only list and featured-toggle routes');
});
