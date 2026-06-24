const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const utilsDir = path.resolve(__dirname, '../../utils');
const mailerPath = path.resolve(utilsDir, 'mailer.js');
const deliveryPath = path.resolve(utilsDir, 'vendorOnboardingEmailDelivery.js');

function readUtilsSources() {
  return fs.readdirSync(utilsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({
      name,
      source: fs.readFileSync(path.join(utilsDir, name), 'utf8'),
    }));
}

test('no post-purchase review follow-up mailer exists in utils', () => {
  const sources = readUtilsSources();
  const reviewFollowUpPatterns = [
    /sendReviewFollowUp/i,
    /reviewFollowUp/i,
    /postPurchaseReview/i,
    /sendPostPurchaseReview/i,
  ];

  for (const { name, source } of sources) {
    for (const pattern of reviewFollowUpPatterns) {
      assert.equal(
        pattern.test(source),
        false,
        `Unexpected review follow-up pattern in utils/${name}`
      );
    }
  }
});

test('mailer.js does not log OTP values', () => {
  const source = fs.readFileSync(mailerPath, 'utf8');
  assert.ok(!source.includes('console.log') || !/console\.log\([^)]*otp/i.test(source));
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*\botp\b/i));
});

test('userController.js does not log OTP values in error handlers', () => {
  const controllerPath = path.resolve(__dirname, '../../controllers/userController.js');
  const source = fs.readFileSync(controllerPath, 'utf8');
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*,\s*otp\b/i));
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*MAIL_PASSWORD/));
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*MAIL_USER/));
});

test('vendorOnboardingEmailDelivery logs error message only', () => {
  const source = fs.readFileSync(deliveryPath, 'utf8');
  assert.ok(source.includes('err.message'));
  assert.ok(source.includes('never logs secrets'));
  assert.ok(!source.includes('console.error(`Vendor onboarding email failed (${label}):`, err)'));
});

test('vendorOnboardingEmailDelivery source avoids logging credential values', () => {
  const source = fs.readFileSync(deliveryPath, 'utf8');
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*MAIL_PASSWORD/));
  assert.ok(!source.match(/console\.(log|error|warn)\([^)]*MAIL_USER/));
});
