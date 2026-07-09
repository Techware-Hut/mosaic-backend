const test = require('node:test');
const assert = require('node:assert/strict');
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

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

const canonicalChildPayload = {
  title: 'Integration Hair Styling',
  description: 'Full salon menu for integration proof',
  price: 45,
  duration: '60',
  features: ['Mobile appointments', 'Consultation included'],
  services: [{ name: 'Basic Cut' }],
};

async function setupVendorWithService(agent, { isPublished = false, businessOverrides = {} } = {}) {
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user, businessOverrides);
  const { category, subcategory } = await seedServiceCategories();

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const createRes = await agent.post('/api/service/').send({
    ...canonicalChildPayload,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished,
  });

  return {
    vendor,
    user,
    business,
    category,
    subcategory,
    createRes,
    serviceId: createRes.body?.data?.service?._id
      ? String(createRes.body.data.service._id)
      : null,
    slug: createRes.body?.data?.service?.slug || null,
  };
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

test('service publication flow: draft private, publish public list + detail, unpublish hides public reads', async () => {
  const agent = createAgent(getApp());
  const { business, createRes, serviceId, slug } = await setupVendorWithService(agent, {
    isPublished: false,
  });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.publication.isPublished, false);
  assert.equal(createRes.body.data.publication.isPubliclyVisible, false);
  assert.equal(createRes.body.data.service.title, 'Integration Hair Styling');
  assert.equal(createRes.body.data.service.services[0].price, 45);
  assert.equal(createRes.body.data.service.services[0].durationMinutes, 60);
  assert.deepEqual(createRes.body.data.service.features, [
    'Mobile appointments',
    'Consultation included',
  ]);

  const privateList = await agent.get('/api/private/services/list').query({
    businessId: String(business._id),
  });
  assert.equal(privateList.status, 200, JSON.stringify(privateList.body));
  assert.ok(privateList.body.data.some((entry) => String(entry._id || entry.id) === serviceId));

  const myServicesDraft = await agent.get('/api/service/my-services');
  assert.equal(myServicesDraft.status, 200);
  assert.ok(myServicesDraft.body.services.some((entry) => String(entry._id) === serviceId));
  assert.deepEqual(
    myServicesDraft.body.services.find((entry) => String(entry._id) === serviceId).features,
    ['Mobile appointments', 'Consultation included']
  );
  assert.equal(myServicesDraft.body.publicationByServiceId[serviceId].isPublished, false);

  await assertPublicSurfacesExcludeService(agent, serviceId, slug);

  const publishRes = await agent.put(`/api/service/${serviceId}`).send({ isPublished: true });
  assert.equal(publishRes.status, 200);
  assert.equal(String(publishRes.body.data.service._id), serviceId);
  assert.equal(publishRes.body.data.publication.isPublished, true);
  assert.equal(publishRes.body.data.publication.isPubliclyVisible, true);

  await assertPublicSurfacesIncludeService(agent, serviceId, slug);

  const unpublishRes = await agent.put(`/api/service/${serviceId}`).send({ isPublished: false });
  assert.equal(unpublishRes.status, 200);
  assert.equal(unpublishRes.body.data.publication.isPubliclyVisible, false);

  await assertPublicSurfacesExcludeService(agent, serviceId, slug);

  const republishRes = await agent.put(`/api/service/${serviceId}`).send({ isPublished: true });
  assert.equal(republishRes.status, 200);
  assert.equal(republishRes.body.data.publication.isPubliclyVisible, true);

  await assertPublicSurfacesIncludeService(agent, serviceId, slug);

  const serviceCount = await Service.countDocuments({ businessId: business._id });
  assert.equal(serviceCount, 1);

  const retryCreate = await agent.post('/api/service/').send({
    ...canonicalChildPayload,
    businessId: business._id,
    categoryId: createRes.body.data.service.categoryId,
    subcategoryId: createRes.body.data.service.subcategoryId,
  });
  assert.equal(retryCreate.status, 409);
});

test('createService with isPublished true appears on public surfaces immediately', async () => {
  const agent = createAgent(getApp());
  const { createRes, serviceId, slug } = await setupVendorWithService(agent, {
    isPublished: true,
  });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.publication.isPublished, true);
  assert.equal(createRes.body.data.publication.isPubliclyVisible, true);

  await assertPublicSurfacesIncludeService(agent, serviceId, slug);
});

test('vendor cannot mutate another vendor service', async () => {
  const agentA = createAgent(getApp());
  const agentB = createAgent(getApp());

  const setupA = await setupVendorWithService(agentA, { isPublished: false });
  assert.equal(setupA.createRes.status, 201);

  const vendorB = await registerAndVerify(agentB, { role: 'business_owner' });
  await login(agentB, vendorB.email, vendorB.password);

  const mutateRes = await agentB.put(`/api/service/${setupA.serviceId}`).send({ isPublished: true });
  assert.equal(mutateRes.status, 404);

  const deleteRes = await agentB.delete(`/api/service/delete-service/${setupA.serviceId}`);
  assert.equal(deleteRes.status, 404);

  const ownerRead = await agentA.get(`/api/service/${setupA.serviceId}`);
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.body.data.publication.isPublished, false);
});

test('published service on inactive business is hidden from public surfaces', async () => {
  const agent = createAgent(getApp());
  const { serviceId, slug } = await setupVendorWithService(agent, {
    isPublished: true,
    businessOverrides: { isActive: false },
  });

  const ownerRead = await agent.get(`/api/service/${serviceId}`);
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.body.data.publication.isPublished, true);
  assert.equal(ownerRead.body.data.publication.isPubliclyVisible, false);
  assert.equal(ownerRead.body.data.publication.visibilityReason, 'BUSINESS_INACTIVE');

  await assertPublicSurfacesExcludeService(agent, serviceId, slug);
});

test('private service slug route returns only owner-owned services', async () => {
  const agentA = createAgent(getApp());
  const agentB = createAgent(getApp());

  const setupA = await setupVendorWithService(agentA, { isPublished: false });
  assert.equal(setupA.createRes.status, 201);
  assert.ok(setupA.slug);

  const ownerSlug = await agentA.get(`/api/private/services/${setupA.slug}`);
  assert.equal(ownerSlug.status, 200);
  assert.equal(String(ownerSlug.body.data.service._id), setupA.serviceId);

  const vendorB = await registerAndVerify(agentB, { role: 'business_owner' });
  await login(agentB, vendorB.email, vendorB.password);

  const otherOwnerSlug = await agentB.get(`/api/private/services/${setupA.slug}`);
  assert.equal(otherOwnerSlug.status, 404);
});

test('createService rejects missing child price and duration with field errors', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user);
  const { category, subcategory } = await seedServiceCategories();

  await login(agent, vendor.email, vendor.password);

  const res = await agent.post('/api/service/').send({
    title: 'Invalid Service',
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    services: [{ name: 'Only Name' }],
  });

  assert.equal(res.status, 400);
  assert.ok(res.body.fieldErrors['services[0].price']);
  assert.ok(res.body.fieldErrors['services[0].durationMinutes']);
});

test('service edit persistence: saving draft preserves categories, duration, and faq', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user);
  const { category, subcategory } = await seedServiceCategories();

  await login(agent, vendor.email, vendor.password);

  // 1. Create a service with duration, category, faq, etc.
  const createRes = await agent.post('/api/service/').send({
    title: 'Persistence Test Service',
    description: 'Initial description',
    price: 50,
    duration: '2 hours',
    businessId: business._id,
    categories: [
      {
        categoryId: category._id.toString(),
        subcategoryIds: [subcategory._id.toString()],
      }
    ],
    services: [
      {
        name: 'Initial Sub Service',
        price: 50,
        durationMinutes: 120,
      }
    ],
    faq: [
      { question: 'Q1', answer: 'A1' }
    ]
  });

  assert.equal(createRes.status, 201);
  const serviceId = createRes.body.data.service._id;

  // 2. Retrieve service to check initial values
  const getRes1 = await agent.get(`/api/service/${serviceId}`);
  assert.equal(getRes1.status, 200);
  assert.equal(getRes1.body.data.service.duration, '2 hours');
  assert.equal(getRes1.body.data.service.faq.length, 1);
  assert.equal(getRes1.body.data.service.faq[0].question, 'Q1');
  assert.equal(getRes1.body.data.service.categoryId._id.toString(), category._id.toString());
  assert.equal(getRes1.body.data.service.subcategoryId._id.toString(), subcategory._id.toString());

  // 3. Update the service to new values (simulating the save draft/edit cycle)
  const updateRes = await agent.put(`/api/service/${serviceId}`).send({
    title: 'Updated Test Service',
    description: 'Updated description',
    price: 60,
    duration: '3 hours',
    categories: [
      {
        categoryId: category._id.toString(),
        subcategoryIds: [subcategory._id.toString()],
      }
    ],
    services: [
      {
        name: 'Updated Sub Service',
        price: 60,
        durationMinutes: 180,
      }
    ],
    faq: [
      { question: 'Q2', answer: 'A2' }
    ]
  });

  assert.equal(updateRes.status, 200);

  // 4. Retrieve service again and verify fields are NOT cleared and have correct updated values
  const getRes2 = await agent.get(`/api/service/${serviceId}`);
  assert.equal(getRes2.status, 200);
  assert.equal(getRes2.body.data.service.duration, '3 hours');
  assert.equal(getRes2.body.data.service.faq.length, 1);
  assert.equal(getRes2.body.data.service.faq[0].question, 'Q2');
  assert.equal(getRes2.body.data.service.faq[0].answer, 'A2');
  assert.equal(getRes2.body.data.service.categoryId._id.toString(), category._id.toString());
  assert.equal(getRes2.body.data.service.subcategoryId._id.toString(), subcategory._id.toString());
});
