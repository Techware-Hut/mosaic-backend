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

test('admin sales summary route is guarded', () => {
  const source = fs.readFileSync(adminOrderRoutesPath, 'utf8');

  assert.match(source, /router\.get\('\/summary', authenticate, isAdmin, getAdminSalesSummary\)/);
});

test('admin order routes only register guarded read handlers', () => {
  const source = fs.readFileSync(adminOrderRoutesPath, 'utf8');
  const routeMatches = [...source.matchAll(/router\.(get|post|put|patch|delete)\(/g)];

  assert.equal(routeMatches.length, 2, 'expected only admin order read routes');
});
