#!/usr/bin/env node
'use strict';

/**
 * Synthetic reference data seeder for an empty, isolated staging database.
 *
 * Seeds subscription plans (Launch / Growth / Legacy), the product, service and
 * food category trees, and minority types, so the app and the synthetic
 * fixture seeder (seed-synthetic-staging.js, which attaches the "Launch Plan")
 * work against a fresh staging database. Run this first, then the fixture
 * seeder.
 *
 * Usage:
 *   node scripts/fixtures/seed-reference-data.js [--dry-run]   # default: print the plan
 *   node scripts/fixtures/seed-reference-data.js --apply       # insert missing reference docs
 *
 * Required environment (every mode; the script refuses otherwise):
 *   RELEASE_ENVIRONMENT=staging
 *   FIXTURE_SEED_CONFIRM=synthetic-staging
 *   MONGODB_URI                 must name the database; its host(s) must be listed in
 *   FIXTURE_ALLOWED_DB_HOSTS    comma-separated host names (ports ignored, case-insensitive)
 *   FIXTURE_ALLOWED_DB_NAMES    comma-separated database names (exact match)
 * MAIL_RECIPIENT_ALLOWLIST is not required: this seeder creates no accounts
 * and sends no mail.
 *
 * Identification: every document written carries
 *   fixtureTag: "mbh-synthetic-reference-v1"  and  fixtureKey: "<kind>:<slug>"
 * (e.g. "subscription-plan:launch-plan", "product-category:home-living").
 * Apply upserts by that key with $setOnInsert: existing documents are never
 * modified, a document not created by this seeder that already uses an
 * entry's name/slug is skipped and left untouched, and nothing is deleted.
 * Running --apply twice gives the same counts. There is no cleanup mode; to
 * remove reference data, delete by { fixtureTag: "mbh-synthetic-reference-v1" }.
 *
 * Stripe: plan stripePriceId / stripeProductId values are fake placeholders
 * (prefix "SYNTHETIC_TEST_ONLY_") for Stripe TEST mode only. Stripe is never
 * called by this script; on first checkout the app's ensurePlanPrice() sees the
 * placeholder as missing and creates a real test-mode product and price; on
 * hosted staging it refuses (no Stripe call) when the Stripe key is a live key.
 *
 * Only the database host(s) and name are printed. Connection credentials are not.
 */

const mongoose = require('mongoose');
const { GuardError, assertPreconditions } = require('./lib/guards');
const {
  REFERENCE_TAG,
  buildReferencePlan,
  applyReferencePlan,
  countReferenceDocs,
} = require('./lib/referenceSeeder');

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { apply: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }
  if (opts.apply && opts.dryRun) {
    throw new UsageError('--apply and --dry-run cannot be combined');
  }
  opts.mode = opts.apply ? 'apply' : 'dry-run';
  return opts;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .map(([name, count]) => `  ${name.padEnd(24)} ${count}`)
    .join('\n');
}

/**
 * Entry point. Returns a process exit code; never calls process.exit itself.
 */
async function main({ argv = process.argv.slice(2), env = process.env, log = console.log, error = console.error } = {}) {
  let opts;
  let target;

  try {
    opts = parseArgs(argv);
    target = assertPreconditions({ env, emails: {}, requireMailAllowlist: false });
  } catch (err) {
    if (err instanceof GuardError || err instanceof UsageError) {
      error(err.message);
      return 2;
    }
    throw err;
  }

  log(`Synthetic reference data seeder (tag ${REFERENCE_TAG}), mode: ${opts.mode}`);
  log(`Target database: host(s) ${target.hosts.join(', ')}, db "${target.dbName}"`);

  // Only ever use a connection built here from the guarded URI.
  if (mongoose.connection.readyState !== 0) {
    error('Refusing: a database connection is already open in this process');
    return 2;
  }
  // autoIndex/autoCreate off: no index builds or collection creation as a
  // side effect (dry-run stays read-only).
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
    autoCreate: false,
  });

  try {
    if (mongoose.connection.db.databaseName !== target.dbName) {
      error('Refusing: connected database name does not match the URI');
      return 2;
    }

    const plan = await buildReferencePlan();

    log('Plan:');
    for (const entry of plan.entries) {
      const reason = entry.reason ? `  (${entry.reason})` : '';
      log(`  ${entry.action.padEnd(11)} ${entry.model.padEnd(20)} ${entry.key}${reason}`);
    }
    const count = (action) => plan.entries.filter((e) => e.action === action).length;
    log(
      `Summary: ${count('create')} to create, ${count('exists')} already present, ` +
        `${count('skip') + count('skip-parent')} skipped (not ours / parent skipped)`
    );

    if (plan.blockers.length > 0) {
      error('Blockers:');
      for (const b of plan.blockers) error(`  - [${b.code}] ${b.message}`);
    }

    if (opts.mode === 'dry-run') {
      log('Dry run: nothing was written. Re-run with --apply to write.');
      return plan.blockers.length > 0 ? 1 : 0;
    }

    if (plan.blockers.length > 0) {
      error('Refusing to apply: resolve the blockers above. Nothing was written.');
      return 1;
    }

    const result = await applyReferencePlan(plan);
    log(`Applied: ${result.created} created, ${result.existing} already present, ${result.skipped} skipped`);
    log('Reference documents by model:');
    log(formatCounts(await countReferenceDocs()));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      // Unknown errors may carry connection details, so print only the name.
      const safe = err && err.name === 'GuardError';
      console.error(`Reference seeder failed: ${safe ? err.message : err && err.name ? err.name : 'Error'}`);
      process.exitCode = 1;
    });
}
