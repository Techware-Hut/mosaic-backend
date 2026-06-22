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
  createAdminDirect,
  validStage1Draft,
  seedVendorOnboarding,
} = require('./helpers/factories');
const User = require('../../models/User');
const VendorOnboarding = require('../../models/VendorOnboardingStage1');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('vendor can save and retrieve onboarding draft', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const saveRes = await agent.post('/api/vendor-onboarding/draft').send(validStage1Draft);
  assert.equal(saveRes.status, 200);

  const getRes = await agent.get('/api/vendor-onboarding/draft');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.data.businessName, validStage1Draft.businessName);
});

test('payment-pending onboarding reports pending payment status', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  const user = await User.findOne({ email: vendor.email });
  await seedVendorOnboarding(user, {
    status: 'draft',
    verificationPayment: { status: 'pending', paymentIntentId: 'pi_integration_test' },
  });

  const statusRes = await agent.get('/api/vendor-onboarding/stage1/payment-status');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.data.status, 'pending');
});

test('submit moves application to submitted when payment is paid', async () => {
  const agent = createAgent(getApp());
  const vendor = await registerAndVerify(agent, { role: 'business_owner' });
  await login(agent, vendor.email, vendor.password);

  await agent.post('/api/vendor-onboarding/draft').send(validStage1Draft);

  const user = await User.findOne({ email: vendor.email });
  const onboarding = await VendorOnboarding.findOneAndUpdate(
    { userId: user._id },
    {
      verificationPayment: {
        status: 'paid',
        paymentIntentId: 'pi_integration_test',
      },
    },
    { new: true }
  );

  const submitRes = await agent.post('/api/vendor-onboarding/submit');
  assert.equal(submitRes.status, 200);

  const refreshed = await VendorOnboarding.findOne({ _id: onboarding._id });
  assert.equal(refreshed.status, 'submitted');
});

test('admin verify and finalize progression', async () => {
  const vendorAgent = createAgent(getApp());
  const vendor = await registerAndVerify(vendorAgent, { role: 'business_owner' });
  await login(vendorAgent, vendor.email, vendor.password);
  const user = await User.findOne({ email: vendor.email });

  const onboarding = await seedVendorOnboarding(user, {
    status: 'submitted',
    totalVerificationPoints: 50,
    verificationPayment: { status: 'paid', paymentIntentId: 'pi_integration_test' },
    verificationChecklist: {
      minorityDocs: true,
      taxDocs: true,
      businessLicense: true,
      website: true,
      facebook: false,
      instagram: false,
      linkedin: false,
      tiktok: false,
    },
  });

  const { email, password } = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const finalizeRes = await adminAgent.post(
    `/api/vendor-onboarding/${onboarding.applicationId}/finalize`
  );
  assert.equal(finalizeRes.status, 200);

  const statusRes = await adminAgent.get(
    `/api/vendor-onboarding/${onboarding.applicationId}`
  );
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.data.status, 'verified');
});

test('rejected application state is readable by admin', async () => {
  const vendor = await registerAndVerify(createAgent(getApp()), {
    role: 'business_owner',
  });
  const user = await User.findOne({ email: vendor.email });
  const onboarding = await seedVendorOnboarding(user, {
    status: 'rejected',
    rejectionReason: 'Integration test rejection',
  });

  const { email, password } = await createAdminDirect();
  const adminAgent = createAgent(getApp());
  await login(adminAgent, email, password);

  const detail = await adminAgent.get(
    `/api/vendor-onboarding/${onboarding.applicationId}`
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.status, 'rejected');
});
