const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { startHarness, resetDatabase, stopHarness } = require('./setup/harness');
const { seedVendorOnboarding, validStage1Draft } = require('./helpers/factories');
const User = require('../../models/User');
const VendorOnboarding = require('../../models/VendorOnboardingStage1');

test.before(() => startHarness());
test.afterEach(() => resetDatabase());
test.after(() => stopHarness());

test('concurrent submit sends exactly one admin notification and one receipt', async () => {
  const user = await User.create({ name: 'Receipt Vendor', mobile: '+14045550123', email: 'receipt@example.com', password: 'TestPassword123!', role: 'business_owner' });
  const onboarding = await seedVendorOnboarding(user, {
    ...validStage1Draft, status: 'rejected', hasBusinessLicense: false, noLicenseComplianceConfirmed: true, licenseNumber: 'stale',
    rejectionReason: 'Old rejection', requiredNextAction: 'Old action',
    reviewDecision: 'rejected', rejectedAt: new Date(),
    verificationPayment: { status: 'paid' },
  });
  let admin = 0;
  let receipt = 0;
  const originalLoad = Module._load;
  const controllerPath = require.resolve('../../controllers/vendorOnboarding.controller');
  const cached = require.cache[controllerPath];
  const env = { MAIL_USER: process.env.MAIL_USER, MAIL_PASSWORD: process.env.MAIL_PASSWORD };
  process.env.MAIL_USER = 'receipt@example.com';
  process.env.MAIL_PASSWORD = 'test';
  try {
    Module._load = function(request, parent, isMain) {
      if (request === '../utils/WellcomeMailer') return {
        sendAdminOnboardingSubmissionEmail: async () => { admin++; },
        sendVendorSubmissionConfirmationEmail: async () => { receipt++; },
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    Module._load = originalLoad;
    // Force both requests to read the source state before either can update it.
    const originalFindOne = VendorOnboarding.findOne;
    let reads = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    VendorOnboarding.findOne = async function(...args) {
      const doc = await originalFindOne.apply(this, args);
      if (++reads === 2) release();
      await barrier;
      return doc;
    };
    const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const responses = [response(), response()];
    try {
      await Promise.all(responses.map(res => controller.submitForReview({ user }, res)));
    } finally {
      VendorOnboarding.findOne = originalFindOne;
    }
    assert.deepEqual(responses.map(res => res.code), [200, 200]);
    assert.equal(admin, 1);
    assert.equal(receipt, 1);
    assert.equal(responses.filter(res => res.body.receiptEmail?.sent).length, 1);
    assert.deepEqual(responses.find(res => !res.body.receiptEmail).body, {
      success: true, message: 'Application submitted successfully', applicationId: onboarding.applicationId,
    });
    const saved = await VendorOnboarding.findById(onboarding._id);
    assert.equal(saved.status, 'submitted');
    assert.ok(saved.submittedAt instanceof Date);
    assert.equal(saved.licenseNumber, '');
    assert.equal(saved.businessLicenseDocuments.length, 0);
    for (const field of ['reviewDecision', 'rejectionReason', 'requiredNextAction', 'rejectedAt']) assert.equal(saved[field], undefined);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[controllerPath] = cached;
    else delete require.cache[controllerPath];
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});



