/**
 * Migration: Rename subscription plan tiers
 * Silver Plan → Launch Plan
 * Gold Plan   → Growth Plan
 * Platinum Plan → Legacy Plan
 *
 * Safe to run multiple times (idempotent).
 * Run: node scripts/migrate-rename-plan-tiers.js
 */

'use strict';

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌  MONGO_URI is not set. Export it or add it to .env before running this script.');
  process.exit(1);
}

// Use a schema with NO enum constraint so the migration can freely read and write.
const looseSchema = new mongoose.Schema({ name: String }, { strict: false });
const Plan = mongoose.model('SubscriptionPlan', looseSchema);

const RENAMES = [
  { from: 'Silver Plan',   to: 'Launch Plan' },
  { from: 'Gold Plan',     to: 'Growth Plan' },
  { from: 'Platinum Plan', to: 'Legacy Plan' },
  // Aliases — handle any existing docs without " Plan" suffix
  { from: 'Silver',   to: 'Launch Plan' },
  { from: 'Gold',     to: 'Growth Plan' },
  { from: 'Platinum', to: 'Legacy Plan' },
];

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.\n');

  // Show existing plan names first
  const before = await Plan.find({}, 'name price').lean();
  console.log('── Plans BEFORE migration ──────────────────────────');
  before.forEach((p) => console.log(`  ${p._id}  name="${p.name}"  price=${p.price}`));
  console.log('');

  let totalUpdated = 0;

  for (const { from, to } of RENAMES) {
    // Skip if target name already exists (idempotent guard)
    const alreadyExists = await Plan.exists({ name: to });
    if (alreadyExists) {
      console.log(`⏭  "${to}" already exists — skipping rename from "${from}"`);
      continue;
    }

    const result = await Plan.updateOne({ name: from }, { $set: { name: to } });
    if (result.matchedCount === 0) {
      console.log(`⚠️   No document found with name="${from}" — skipping`);
    } else if (result.modifiedCount === 0) {
      console.log(`ℹ️   "${from}" matched but was not modified (already up to date?)`);
    } else {
      console.log(`✅  Renamed "${from}" → "${to}"`);
      totalUpdated++;
    }
  }

  console.log('');

  // Show final state
  const after = await Plan.find({}, 'name price').lean();
  console.log('── Plans AFTER migration ───────────────────────────');
  after.forEach((p) => console.log(`  ${p._id}  name="${p.name}"  price=${p.price}`));
  console.log('');
  console.log(`Migration complete. ${totalUpdated} plan(s) renamed.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
