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
  services: [{ name: 'Basic Cut' }],
};

test('service publication flow: draft private, publish public list + detail, unpublish hides public reads', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  const user = await User.findOne({ email: vendor.email });
  const business = await seedServiceBusiness(user);
  const { category, subcategory } = await seedServiceCategories();

  const loginRes = await login(agent, vendor.email, vendor.password);
  assert.equal(loginRes.status, 200);

  const createRes = await agent.post('/api/service/').send({
    ...canonicalChildPayload,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    isPublished: false,
  });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.publication.isPublished, false);
  assert.equal(createRes.body.data.publication.isPubliclyVisible, false);
  assert.equal(createRes.body.data.service.title, 'Integration Hair Styling');
  assert.equal(createRes.body.data.service.services[0].price, 45);
  assert.equal(createRes.body.data.service.services[0].durationMinutes, 60);

  const serviceId = String(createRes.body.data.service._id);

  const privateList = await agent.get('/api/private/services/list').query({
    businessId: String(business._id),
  });
  assert.equal(privateList.status, 200, JSON.stringify(privateList.body));
  assert.ok(privateList.body.data.some((entry) => String(entry._id || entry.id) === serviceId));

  const publicListDraft = await agent.get('/api/services/list');
  assert.equal(publicListDraft.status, 200);
  assert.ok(!publicListDraft.body.data.some((entry) => String(entry.id || entry._id) === serviceId));

  const publicDetailDraft = await agent.get(`/api/public/services/${serviceId}`);
  assert.equal(publicDetailDraft.status, 404);

  const publishRes = await agent.put(`/api/service/${serviceId}`).send({ isPublished: true });
  assert.equal(publishRes.status, 200);
  assert.equal(String(publishRes.body.data.service._id), serviceId);
  assert.equal(publishRes.body.data.publication.isPublished, true);
  assert.equal(publishRes.body.data.publication.isPubliclyVisible, true);

  const publicListPublished = await agent.get('/api/services/list');
  assert.equal(publicListPublished.status, 200);
  assert.ok(publicListPublished.body.data.some((entry) => String(entry.id || entry._id) === serviceId));

  const publicDetailPublished = await agent.get(`/api/public/services/${serviceId}`);
  assert.equal(publicDetailPublished.status, 200);
  assert.equal(String(publicDetailPublished.body.data.service.id || publicDetailPublished.body.data.service._id), serviceId);

  const unpublishRes = await agent.put(`/api/service/${serviceId}`).send({ isPublished: false });
  assert.equal(unpublishRes.status, 200);
  assert.equal(unpublishRes.body.data.publication.isPubliclyVisible, false);

  const publicListUnpublished = await agent.get('/api/services/list');
  assert.ok(!publicListUnpublished.body.data.some((entry) => String(entry.id || entry._id) === serviceId));

  const publicDetailUnpublished = await agent.get(`/api/public/services/${serviceId}`);
  assert.equal(publicDetailUnpublished.status, 404);

  const republishRes = await agent.put(`/api/service/${serviceId}`).send({ isPublished: true });
  assert.equal(republishRes.status, 200);

  const serviceCount = await Service.countDocuments({ businessId: business._id });
  assert.equal(serviceCount, 1);

  const retryCreate = await agent.post('/api/service/').send({
    ...canonicalChildPayload,
    businessId: business._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
  });
  assert.equal(retryCreate.status, 409);
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
