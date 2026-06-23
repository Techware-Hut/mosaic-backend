/**
 * Read-only production onboarding state snapshot (sanitized).
 * Loads MONGODB_URI from .env — never logs connection string or PII.
 */
require('dotenv').config();

const mongoose = require('mongoose');

const VendorOnboarding = require('../models/VendorOnboardingStage1');
const Business = require('../models/Business');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.log('BLOCKED  MONGODB_URI unset — cannot read DB state');
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const submitted = await VendorOnboarding.find({ status: 'submitted' })
    .select('applicationId status verificationPayment.status submittedAt')
    .limit(10)
    .lean();

  const verifiedCount = await VendorOnboarding.countDocuments({ status: 'verified' });
  const paidDraft = await VendorOnboarding.find({
    status: { $in: ['draft', 'payment_pending'] },
    'verificationPayment.status': 'paid',
  })
    .select('applicationId status verificationPayment.status')
    .limit(5)
    .lean();

  const verifiedSample = await VendorOnboarding.find({ status: 'verified' })
    .select('applicationId status badge userId')
    .limit(3)
    .lean();

  const businessCounts = await Business.countDocuments({ isApproved: true });

  console.log('=== Read-only onboarding state snapshot (sanitized) ===');
  console.log(`submitted_count=${submitted.length} (capped query limit 10)`);
  submitted.forEach((row) => {
    console.log(
      `  app=${row.applicationId} status=${row.status} payment=${row.verificationPayment?.status || 'n/a'}`
    );
  });

  console.log(`verified_total=${verifiedCount}`);
  verifiedSample.forEach((row) => {
    console.log(`  app=${row.applicationId} status=${row.status} badge=${row.badge || 'none'}`);
  });

  console.log(`paid_draft_or_pending_count=${paidDraft.length} (capped 5)`);
  paidDraft.forEach((row) => {
    console.log(
      `  app=${row.applicationId} status=${row.status} payment=${row.verificationPayment?.status}`
    );
  });

  console.log(`approved_business_records=${businessCounts}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('ERROR', err.message);
  process.exit(1);
});
