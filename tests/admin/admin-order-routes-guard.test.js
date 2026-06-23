const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminOrderRoutesPath = path.resolve(
  __dirname,
  '../../routes/admin/adminOrderRoutes.js'
);

test('admin order list route is guarded', () => {
  const source = fs.readFileSync(adminOrderRoutesPath, 'utf8');

  assert.match(source, /router\.get\('\/', authenticate, isAdmin, getAllOrdersAdmin\)/);
});

test('admin order routes only register guarded list handler', () => {
  const source = fs.readFileSync(adminOrderRoutesPath, 'utf8');
  const routeMatches = [...source.matchAll(/router\.(get|post|put|patch|delete)\(/g)];

  assert.equal(routeMatches.length, 1, 'expected only admin order list route');
});
