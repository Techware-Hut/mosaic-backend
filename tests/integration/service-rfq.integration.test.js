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
const ServiceRfq = require('../../models/ServiceRfq');

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
  title: 'RFQ Integration Salon',
  description: 'Service listing for RFQ proof',
  price: 45,
  duration: '60',
  services: [{ name: 'Consultation', price: 45, durationMinutes: 60 }],
};

async function setupPublishedService(agent, { rfqEnabled = true, externalLink = '' } = {}) {
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
    isPublished: true,
    rfqEnabled,
    externalLink,
    bookingToolLink: externalLink,
  });

  assert.equal(createRes.status, 201);
  const serviceId = String(createRes.body?.data?.service?._id || '');

  return { vendor, user, business, serviceId };
}

test('service RFQ: customer can submit quote request when rfqEnabled', async () => {
  const vendorAgent = createAgent(getApp());
  const { business, serviceId } = await setupPublishedService(vendorAgent, {
    rfqEnabled: true,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);

  const submitRes = await customerAgent.post('/api/enquiries/rfq').send({
    serviceId,
    name: 'Quote Customer',
    email: 'quote.customer@example.com',
    phone: '5551234567',
    message: 'Please share pricing for a full consultation package.',
    services: ['Consultation'],
    budget: '$200-$300',
  });

  assert.equal(submitRes.status, 201);
  assert.equal(submitRes.body.success, true);

  const stored = await ServiceRfq.findOne({ serviceId }).lean();
  assert.ok(stored);
  assert.equal(stored.customerName, 'Quote Customer');
  assert.equal(stored.message, 'Please share pricing for a full consultation package.');
  assert.deepEqual(stored.requestedServices, ['Consultation']);

  const vendorRes = await vendorAgent.get('/api/enquiries/vendor/rfqs').query({
    businessId: business._id,
  });
  assert.equal(vendorRes.status, 200);
  assert.equal(vendorRes.body.total, 1);
  assert.equal(vendorRes.body.data[0].customerEmail, 'quote.customer@example.com');
});

test('service RFQ: rejects submission when rfqEnabled is false', async () => {
  const vendorAgent = createAgent(getApp());
  const { serviceId } = await setupPublishedService(vendorAgent, {
    rfqEnabled: false,
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);

  const submitRes = await customerAgent.post('/api/enquiries/rfq').send({
    serviceId,
    name: 'Quote Customer',
    email: 'quote.customer@example.com',
    phone: '5551234567',
    message: 'Please share pricing for a full consultation package.',
  });

  assert.equal(submitRes.status, 400);
  assert.match(submitRes.body.message, /does not accept quote requests/i);
});

test('service RFQ: rejects submission when external link is configured', async () => {
  const vendorAgent = createAgent(getApp());
  const { serviceId } = await setupPublishedService(vendorAgent, {
    rfqEnabled: true,
    externalLink: 'https://calendly.com/example-booking',
  });

  const customerAgent = createAgent(getApp());
  const customer = await registerAndVerify(customerAgent, { role: 'customer' });
  await login(customerAgent, customer.email, customer.password);

  const submitRes = await customerAgent.post('/api/enquiries/rfq').send({
    serviceId,
    name: 'Quote Customer',
    email: 'quote.customer@example.com',
    phone: '5551234567',
    message: 'Please share pricing for a full consultation package.',
  });

  assert.equal(submitRes.status, 400);
  assert.match(submitRes.body.message, /external booking link/i);
});

test('public service detail exposes externalLink and rfqEnabled', async () => {
  const vendorAgent = createAgent(getApp());
  const { serviceId } = await setupPublishedService(vendorAgent, {
    rfqEnabled: true,
    externalLink: '',
  });

  const publicRes = await vendorAgent.get(`/api/public/services/${serviceId}`);
  assert.equal(publicRes.status, 200);
  assert.equal(publicRes.body.data.service.rfqEnabled, true);
  assert.ok(Object.prototype.hasOwnProperty.call(publicRes.body.data.service, 'externalLink'));
});
