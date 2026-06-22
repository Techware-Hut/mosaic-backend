const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const auditRoutesPath = path.join(root, 'routes/admin/adminAuditRoutes.js');
const appPath = path.join(root, 'app.js');
const modelPath = path.join(root, 'models/AdminAuditEvent.js');

test('audit routes require authenticate and isAdmin on all handlers', () => {
  const source = fs.readFileSync(auditRoutesPath, 'utf8');
  assert.match(source, /router\.use\(authenticate, isAdmin\)/);
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)/);
});

test('app mounts protected admin audit read API', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  assert.match(source, /app\.use\('\/admin\/api\/audit-events', adminAuditRoutes\)/);
});

test('AdminAuditEvent schema disables updatedAt for tamper resistance', () => {
  const source = fs.readFileSync(modelPath, 'utf8');
  assert.match(source, /updatedAt:\s*false/);
  assert.match(source, /blockMutation/);
  assert.match(source, /pre\('updateOne'/);
  assert.match(source, /pre\('deleteOne'/);
});

test('request ID middleware is registered globally', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  assert.match(source, /requestIdMiddleware/);
  assert.match(source, /app\.use\(requestIdMiddleware\)/);
});
