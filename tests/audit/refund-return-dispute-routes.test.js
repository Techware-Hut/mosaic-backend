const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const orderRoutesPath = path.join(root, 'routes/orderRoutes.js');
const orderControllerPath = path.join(root, 'controllers/orderController.js');
const webhookControllerPath = path.join(root, 'controllers/webhookController.js');
const refundModelPath = path.join(root, 'models/Refund.js');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('order routes register cancel, return, reject, and vendor fulfillment handlers', () => {
  const routes = readSource(orderRoutesPath);

  assert.match(routes, /router\.post\("\/:orderId\/cancel", authenticate, isCustomer, cancelOrderByUser\)/);
  assert.match(routes, /router\.put\('\/initiateReturn\/:orderId', authenticate, isCustomer, initiateReturn\)/);
  assert.match(routes, /router\.put\('\/return\/:orderId', authenticate, isBusinessOwner, acceptReturn\)/);
  assert.match(routes, /router\.put\('\/reject\/:orderId', authenticate, isBusinessOwner, rejectOrder\)/);
  assert.match(routes, /router\.put\('\/ship\/:orderId', authenticate, isBusinessOwner, shipOrder\)/);
  assert.match(routes, /router\.put\('\/deliver\/:orderId', authenticate, isBusinessOwner, deliverOrder\)/);
});

test('admin order routes expose read-only list alias without refund mutations', () => {
  const adminRoutes = readSource(path.join(root, 'routes/admin/adminOrderRoutes.js'));
  const orderController = readSource(orderControllerPath);

  assert.match(adminRoutes, /router\.get\('\/', authenticate, isAdmin, getAllOrdersAdmin\)/);
  assert.doesNotMatch(adminRoutes, /refund|return|cancel|reject/i);
  assert.doesNotMatch(orderController, /exports\.\w*Refund/);
});

test('refund handlers use Connect-safe Stripe refund options', () => {
  const source = readSource(orderControllerPath);

  const refundBlocks = source.match(/stripe\.refunds\.create\([\s\S]*?\);/g) || [];
  assert.equal(refundBlocks.length, 3, 'expected reject, acceptReturn, and cancel refund paths');

  for (const block of refundBlocks) {
    assert.match(block, /reverse_transfer:\s*true/);
    assert.match(block, /refund_application_fee:\s*true/);
  }
});

test('Refund mongoose model exists but is not referenced by order refund flows', () => {
  const refundModel = readSource(refundModelPath);
  const controller = readSource(orderControllerPath);
  const webhook = readSource(webhookControllerPath);

  assert.match(refundModel, /refundStatus/);
  assert.doesNotMatch(controller, /require\(['"].*Refund['"]\)/);
  assert.doesNotMatch(webhook, /require\(['"].*Refund['"]\)/);
});

test('order status webhook handles charge.refunded using charge metadata orderId', () => {
  const source = readSource(webhookControllerPath);

  assert.match(source, /case 'charge\.refunded':/);
  assert.match(source, /chargeRefunded\.metadata\.orderId/);
});
