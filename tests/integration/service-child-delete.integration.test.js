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
  seedServiceBusiness,
  seedServiceCategories,
} = require('./helpers/factories');
const User = require('../../models/User');
const Service = require('../../models/Service');
const Booking = require('../../models/Booking');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

const twoChildPayload = {
  title: 'Integration Hair Styling',
  description: 'Full salon menu for child delete proof',
  services: [
    { name: 'Basic Cut', price: 30, duration: '30' },
    { name: 'Premium Cut', price: 50, duration: '60' },
  ],
};

async function setupVendorWithTwoChildren(agent, { isPublished = false, businessOverrides = {} } = {}) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user, businessOverrides);
  const { category, subcategory } = await seedServiceCategories();

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const createRes = await agent.post('/api/service/').send({
    ...twoChildPayload,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished,
  });

  const service = createRes.body?.data?.service;
  const parentServiceId = service?._id ? String(service._id) : null;
  const childAId = service?.services?.[0]?._id ? String(service.services[0]._id) : null;
  const childBId = service?.services?.[1]?._id ? String(service.services[1]._id) : null;

  return {
    vendor,
    user,
    business,
    category,
    subcategory,
    createRes,
    parentServiceId,
    childAId,
    childBId,
    slug: service?.slug || null,
  };
}

async function createBookingCustomer() {
  return User.create({
    name: 'Integration Booking Customer',
    email: `booking-customer-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
    role: 'customer',
    provider: 'google',
    providerId: `google-booking-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    isOtpVerified: true,
  });
}

async function seedActiveServiceBooking(setup, status = 'pending_vendor_action') {
  const customer = await createBookingCustomer();
  return Booking.create({
    bookingType: 'service',
    serviceId: setup.parentServiceId,
    serviceTitle: twoChildPayload.title,
    services: ['Basic Cut'],
    serviceItems: ['Basic Cut'],
    date: new Date(Date.now() + 24 * 60 * 60 * 1000),
    slot: '10:00 AM',
    time: '10:00 AM',
    status,
    businessId: setup.business._id,
    ownerId: setup.user._id,
    customerId: customer._id,
    customerInfo: {
      name: customer.name,
      email: customer.email,
      phone: '555-0100',
    },
  });
}

function assertPublicSurfacesIncludeService(agent, serviceId, slug) {
  return (async () => {
    const publicList = await agent.get('/api/services/list');
    assert.equal(publicList.status, 200);
    assert.ok(publicList.body.data.some((entry) => String(entry.id || entry._id) === serviceId));

    const publicDetail = await agent.get(`/api/public/services/${serviceId}`);
    assert.equal(publicDetail.status, 200);

    if (slug) {
      const slugDetail = await agent.get(`/api/services/${slug}`);
      assert.equal(slugDetail.status, 200);
    }

    const businessServiceDetail = await agent.get(`/api/service/business-service/${serviceId}`);
    assert.equal(businessServiceDetail.status, 200);
  })();
}

function assertPublicSurfacesExcludeService(agent, serviceId, slug) {
  return (async () => {
    const publicList = await agent.get('/api/services/list');
    assert.equal(publicList.status, 200);
    assert.ok(!publicList.body.data.some((entry) => String(entry.id || entry._id) === serviceId));

    const publicDetail = await agent.get(`/api/public/services/${serviceId}`);
    assert.equal(publicDetail.status, 404);

    if (slug) {
      const slugDetail = await agent.get(`/api/services/${slug}`);
      assert.equal(slugDetail.status, 404);
    }

    const businessServiceDetail = await agent.get(`/api/service/business-service/${serviceId}`);
    assert.equal(businessServiceDetail.status, 404);
  })();
}

test('owner deletes one of two child services without deleting parent', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: true });

  assert.equal(setup.createRes.status, 201);
  assert.equal(setup.createRes.body.data.service.services.length, 2);

  const deleteRes = await agent.delete(
    `/api/service/${setup.parentServiceId}/child-services/${setup.childBId}`
  );

  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);
  assert.equal(deleteRes.body.deletedChildServiceId, setup.childBId);
  assert.equal(deleteRes.body.data.service.services.length, 1);
  assert.equal(String(deleteRes.body.data.service.services[0]._id), setup.childAId);
  assert.equal(deleteRes.body.data.service.price, 30);
  assert.equal(deleteRes.body.data.service.isPublished, true);
  assert.equal(deleteRes.body.data.publication.isPublished, true);
  assert.equal(deleteRes.body.data.publication.isPubliclyVisible, true);

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.ok(parentInDb, 'parent service must remain in database');
  assert.equal(parentInDb.services.length, 1);
  assert.equal(String(parentInDb.services[0]._id), setup.childAId);
  assert.equal(parentInDb.price, 30);
  assert.equal(parentInDb.isPublished, true);

  await assertPublicSurfacesIncludeService(agent, setup.parentServiceId, setup.slug);
});

test('owner deleting final child unpublishes parent and hides public listing', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: true });

  assert.equal(setup.createRes.status, 201);

  const deleteFirst = await agent.delete(
    `/api/service/${setup.parentServiceId}/child-services/${setup.childBId}`
  );
  assert.equal(deleteFirst.status, 200);

  const deleteFinal = await agent.delete(
    `/api/service/${setup.parentServiceId}/child-services/${setup.childAId}`
  );

  assert.equal(deleteFinal.status, 200);
  assert.equal(deleteFinal.body.success, true);
  assert.equal(deleteFinal.body.deletedChildServiceId, setup.childAId);
  assert.deepEqual(deleteFinal.body.data.service.services, []);
  assert.equal(deleteFinal.body.data.service.price, 0);
  assert.equal(deleteFinal.body.data.service.duration, '');
  assert.equal(deleteFinal.body.data.service.isPublished, false);
  assert.equal(deleteFinal.body.data.publication.isPublished, false);
  assert.equal(deleteFinal.body.data.publication.isPubliclyVisible, false);

  const parentCount = await Service.countDocuments({ _id: setup.parentServiceId });
  assert.equal(parentCount, 1);

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.ok(parentInDb);
  assert.equal(parentInDb.services.length, 0);
  assert.equal(parentInDb.price, 0);
  assert.equal(parentInDb.isPublished, false);

  await assertPublicSurfacesExcludeService(agent, setup.parentServiceId, setup.slug);
});

test('another business_owner cannot delete child service', async () => {
  const agentA = createAgent(getApp());
  const agentB = createAgent(getApp());

  const setupA = await setupVendorWithTwoChildren(agentA, { isPublished: true });
  assert.equal(setupA.createRes.status, 201);

  const vendorB = await registerAndVerify(agentB, { role: 'business_owner' });
  await login(agentB, vendorB.email, vendorB.password);

  const deleteRes = await agentB.delete(
    `/api/service/${setupA.parentServiceId}/child-services/${setupA.childBId}`
  );
  assert.equal(deleteRes.status, 404);

  const parentInDb = await Service.findById(setupA.parentServiceId);
  assert.equal(parentInDb.services.length, 2);
  assert.ok(parentInDb.services.some((child) => String(child._id) === setupA.childAId));
  assert.ok(parentInDb.services.some((child) => String(child._id) === setupA.childBId));
});

test('owner cannot delete child service while parent has active booking', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: true });
  assert.equal(setup.createRes.status, 201);

  await seedActiveServiceBooking(setup, 'pending_vendor_action');

  const deleteRes = await agent.delete(
    `/api/service/${setup.parentServiceId}/child-services/${setup.childBId}`
  );

  assert.equal(deleteRes.status, 409);
  assert.equal(deleteRes.body.success, false);
  assert.match(deleteRes.body.message, /active bookings/i);

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.equal(parentInDb.services.length, 2);
  assert.ok(parentInDb.services.some((child) => String(child._id) === setup.childAId));
  assert.ok(parentInDb.services.some((child) => String(child._id) === setup.childBId));
});

test('owner cannot delete parent service while it has active booking', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: true });
  assert.equal(setup.createRes.status, 201);

  await seedActiveServiceBooking(setup, 'approved');

  const deleteRes = await agent.delete(`/api/service/delete-service/${setup.parentServiceId}`);

  assert.equal(deleteRes.status, 409);
  assert.equal(deleteRes.body.success, false);
  assert.match(deleteRes.body.message, /active bookings/i);

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.ok(parentInDb, 'parent service must remain in database');
  assert.equal(parentInDb.services.length, 2);
});

test('invalid parent or child id returns safe 404 without modifying parent', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: false });
  assert.equal(setup.createRes.status, 201);

  const invalidParentRes = await agent.delete(
    `/api/service/not-a-valid-id/child-services/${setup.childAId}`
  );
  assert.equal(invalidParentRes.status, 404);

  const invalidChildRes = await agent.delete(
    `/api/service/${setup.parentServiceId}/child-services/not-a-valid-id`
  );
  assert.equal(invalidChildRes.status, 404);

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.equal(parentInDb.services.length, 2);
});

test('missing child id returns 404 and does not modify parent', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: false });
  assert.equal(setup.createRes.status, 201);

  const missingChildId = new mongoose.Types.ObjectId();
  const deleteRes = await agent.delete(
    `/api/service/${setup.parentServiceId}/child-services/${missingChildId}`
  );

  assert.equal(deleteRes.status, 404);

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.equal(parentInDb.services.length, 2);
});

test('existing parent deletion route still deletes entire parent service', async () => {
  const agent = createAgent(getApp());
  const setup = await setupVendorWithTwoChildren(agent, { isPublished: false });
  assert.equal(setup.createRes.status, 201);

  const deleteRes = await agent.delete(`/api/service/delete-service/${setup.parentServiceId}`);
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.message, 'Service deleted successfully.');

  const parentInDb = await Service.findById(setup.parentServiceId);
  assert.equal(parentInDb, null);
});
