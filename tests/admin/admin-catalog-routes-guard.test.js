const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminCatalogRoutesPath = path.resolve(
  __dirname,
  '../../routes/admin/adminCatalogRoutes.js'
);

test('admin catalog routes remain guarded', () => {
  const source = fs.readFileSync(adminCatalogRoutesPath, 'utf8');

  assert.match(source, /router\.get\('\/audit', authenticate, isAdmin, auditCatalog\)/);
  assert.match(source, /router\.get\('\/', authenticate, isAdmin, listCatalog\)/);
  assert.match(source, /router\.get\('\/:type\/:id', authenticate, isAdmin, getCatalogItem\)/);
  assert.match(source, /router\.put\('\/:type\/:id', authenticate, isAdmin, updateCatalogItem\)/);
  assert.match(source, /router\.patch\('\/:type\/:id\/active', authenticate, isAdmin, patchCatalogActive\)/);
  assert.match(source, /router\.delete\('\/:type\/:id', authenticate, isAdmin, deleteCatalogItem\)/);
});

test('admin catalog routes register expected handlers only', () => {
  const source = fs.readFileSync(adminCatalogRoutesPath, 'utf8');
  const routeMatches = [...source.matchAll(/router\.(get|post|put|patch|delete)\(/g)];

  assert.equal(routeMatches.length, 6);
});
