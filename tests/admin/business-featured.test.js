const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin business routes guard featured update endpoint', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../routes/admin/businessRoutes.js'),
    'utf8'
  );

  assert.match(
    source,
    /router\.patch\(\s*['"]\/:id\/featured['"],\s*authenticate,\s*isAdmin,\s*businessController\.updateBusinessFeatured\s*\)/
  );
});

test('public business listing supports featured=true query filter', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../controllers/businessController.js'),
    'utf8'
  );

  assert.match(source, /featured/);
  assert.match(source, /filters\.isFeatured\s*=\s*true/);
});

test('action registry includes business feature audit codes', () => {
  const { ADMIN_AUDIT_ACTIONS } = require('../../utils/audit/actionRegistry');

  assert.equal(ADMIN_AUDIT_ACTIONS.BUSINESS_FEATURE, 'business.feature');
  assert.equal(ADMIN_AUDIT_ACTIONS.BUSINESS_UNFEATURE, 'business.unfeature');
});
