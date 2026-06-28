const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
} = require('./setup/harness');
const { createAgent } = require('./helpers/client');
const {
  registerAndVerify,
  login,
  createAdminDirect,
  seedApprovedBusiness,
} = require('./helpers/factories');
const User = require('../../models/User');
const AdminAuditEvent = require('../../models/AdminAuditEvent');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('public launch routes remain readable without authentication', async () => {
  const agent = createAgent(getApp());

  const featured = await agent.get('/api/featured-products');
  assert.equal(featured.status, 200);
  assert.ok(Array.isArray(featured.body.products));

  const deprecatedFeatured = await agent.get('/api/products/featured');
  assert.equal(deprecatedFeatured.status, 404);
});

test('launch-critical protected routes reject unauthenticated callers', async () => {
  const agent = createAgent(getApp());
  const businessId = new mongoose.Types.ObjectId();

  const probes = [
    ['GET', '/api/users/auth/check'],
    ['GET', '/api/business/my'],
    ['GET', '/api/vendor-onboarding/draft'],
    ['POST', '/api/vendor-onboarding/submit'],
    ['POST', '/api/orders/initiate'],
    ['GET', '/api/orders/vendor'],
    ['GET', `/api/connect/${businessId}/status`],
    ['GET', '/admin/api/audit-events'],
  ];

  for (const [method, path] of probes) {
    const res = await agent[method.toLowerCase()](path);
    assert.equal(res.status, 401, `${method} ${path} should require auth`);
  }
});

test('wrong roles are denied from customer, vendor, and admin launch surfaces', async () => {
  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);

  const customerBusiness = await customerAgent.get('/api/business/my');
  assert.equal(customerBusiness.status, 403);

  const customerVendorOrders = await customerAgent.get('/api/orders/vendor');
  assert.equal(customerVendorOrders.status, 403);

  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);

  const vendorCheckout = await vendorAgent.post('/api/orders/initiate').send({});
  assert.equal(vendorCheckout.status, 403);

  const vendorAudit = await vendorAgent.get('/admin/api/audit-events');
  assert.equal(vendorAudit.status, 403);
});

test('business-owner Connect routes enforce owner scope', async () => {
  const ownerAgent = createAgent(getApp());
  const otherAgent = createAgent(getApp());

  const owner = await registerAndVerify(ownerAgent, { role: 'business_owner' });
  const other = await registerAndVerify(otherAgent, { role: 'business_owner' });
  await login(ownerAgent, owner.email, owner.password);
  await login(otherAgent, other.email, other.password);

  const otherUser = await User.findOne({ email: other.email });
  const otherBusiness = await seedApprovedBusiness(otherUser);

  const foreignStatus = await ownerAgent.get(
    `/api/connect/${otherBusiness._id}/status`
  );
  assert.equal(foreignStatus.status, 403);
});

test('admin audit list is admin-only and returns safe audit event data', async () => {
  const { user, email, password } = await createAdminDirect();
  await AdminAuditEvent.create({
    actorUserId: user._id,
    actorRole: 'admin',
    actionCode: 'launch.contract.proof',
    targetType: 'launch_access_contract',
    targetId: 'integration-proof',
    requestId: 'req-launch-contract-proof',
    outcome: 'success',
    note: 'Integration launch access proof',
  });

  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const res = await adminAgent.get(
    '/admin/api/audit-events?actionCode=launch.contract.proof'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].actionCode, 'launch.contract.proof');
  assert.equal(res.body.data[0].outcome, 'success');
  assert.equal(res.body.data[0].requestId, 'req-launch-contract-proof');
});
