#!/usr/bin/env node
'use strict';

/**
 * Synthetic staging fixture seeder.
 *
 * PREREQUISITE: backend PR #330 (MAIL_RECIPIENT_ALLOWLIST enforcement on
 * outgoing mail) must be deployed on staging before this seeder is used. The
 * allowlist check in this script is a precondition only; it is not the
 * enforcement itself.
 *
 * Usage:
 *   node scripts/fixtures/seed-synthetic-staging.js [--dry-run]      # default: print the plan
 *   node scripts/fixtures/seed-synthetic-staging.js --apply          # insert missing fixtures
 *   node scripts/fixtures/seed-synthetic-staging.js --cleanup        # cleanup preview (dry-run)
 *   node scripts/fixtures/seed-synthetic-staging.js --cleanup --apply   # delete (see Cleanup below)
 *   add --allow-orphans-report to let cleanup proceed / exit 0 when documents
 *   need manual review
 *
 * Required environment (every mode; the script refuses otherwise):
 *   RELEASE_ENVIRONMENT=staging
 *   FIXTURE_SEED_CONFIRM=synthetic-staging
 *   MONGODB_URI                 must name the database; its host(s) must be listed in
 *   FIXTURE_ALLOWED_DB_HOSTS    comma-separated host names (ports ignored, case-insensitive)
 *   FIXTURE_ALLOWED_DB_NAMES    comma-separated database names (exact match); independently
 *                               of this list the name must end with "_staging" and must
 *                               never be the production database name (hard-coded)
 *   MAIL_RECIPIENT_ALLOWLIST    must cover every fixture email (fails closed if unset)
 *
 * Fixture emails (env or CLI flag; no defaults):
 *   FIXTURE_EMAIL_BUYER        --buyer-email=
 *   FIXTURE_EMAIL_VENDOR_A     --vendor-a-email=
 *   FIXTURE_EMAIL_VENDOR_B     --vendor-b-email=
 *   FIXTURE_EMAIL_ADMIN        --admin-email=
 *   FIXTURE_EMAIL_FOOD_VENDOR  --food-vendor-email=
 *
 * Optional:
 *   FIXTURE_PASSWORD           required for --apply (min 12 chars); shared login for the
 *                              fixture accounts; never printed
 *   FIXTURE_MOBILE_PREFIX      default "+175755501" (fictional 555-01xx numbers, suffix 91-95)
 *   FIXTURE_SUBSCRIPTION_PLAN  existing plan name to attach, default "Launch Plan"
 *
 * Only the database host(s) and name are printed. Connection credentials are not.
 * Stripe Connect is left unset and no payment objects are created. Subscription
 * ids are placeholders, so Stripe cancel/renew calls on them fail by design.
 *
 * Cleanup (dry-run unless --apply is given):
 *   1. Related QA documents in orders, refunds, carts, cart items, reviews and
 *      bookings (service bookings and food reservations) are classified. A
 *      document is deleted only if its acting user (buyer/customer/reviewer)
 *      is a fixture user AND every vendor/business/product/service reference
 *      in it is a fixture id or empty. Fixture ids are the deterministic
 *      ObjectIds derived from the fixture keys.
 *   2. Anything else that references a fixture (owned by a non-fixture user,
 *      or mixing fixture and non-fixture references) is never deleted. It is
 *      listed as "needs manual review" (counts and ids only). Cleanup then
 *      exits non-zero and, with --apply, deletes nothing, unless
 *      --allow-orphans-report is passed.
 *   3. With --apply: fixture-owned related documents are deleted first, then
 *      the marker-tagged fixture documents.
 *   Stripe is never called: PaymentIntents, transfers and refunds in Stripe
 *   TEST mode are left untouched.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const {
  GuardError,
  assertPreconditions,
  maskEmail,
} = require('./lib/guards');
const { ROLE_ORDER, ROLES, FIXTURE_TAG } = require('./lib/fixtureSpec');
const {
  buildPlan,
  applyPlan,
  countFixtures,
  cleanupFixtures,
  classifyRelatedDocuments,
  deleteRelatedDocuments,
} = require('./lib/seeder');

const EMAIL_SOURCES = {
  buyer: { env: 'FIXTURE_EMAIL_BUYER', flag: '--buyer-email' },
  vendorA: { env: 'FIXTURE_EMAIL_VENDOR_A', flag: '--vendor-a-email' },
  vendorB: { env: 'FIXTURE_EMAIL_VENDOR_B', flag: '--vendor-b-email' },
  admin: { env: 'FIXTURE_EMAIL_ADMIN', flag: '--admin-email' },
  foodVendor: { env: 'FIXTURE_EMAIL_FOOD_VENDOR', flag: '--food-vendor-email' },
};

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const MIN_PASSWORD_LENGTH = 12;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { apply: false, cleanup: false, dryRun: false, allowOrphansReport: false, flags: {} };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--allow-orphans-report') opts.allowOrphansReport = true;
    else if (arg === '--cleanup') opts.cleanup = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--') && arg.includes('=')) {
      const idx = arg.indexOf('=');
      opts.flags[arg.slice(0, idx)] = arg.slice(idx + 1);
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }

  const known = new Set(Object.values(EMAIL_SOURCES).map((s) => s.flag));
  for (const flag of Object.keys(opts.flags)) {
    if (!known.has(flag)) throw new UsageError(`Unknown argument: ${flag}`);
  }

  if (opts.apply && opts.dryRun) {
    throw new UsageError('--apply and --dry-run cannot be combined');
  }
  if (opts.allowOrphansReport && !opts.cleanup) {
    throw new UsageError('--allow-orphans-report is only valid with --cleanup');
  }

  if (opts.cleanup) opts.mode = opts.apply ? 'cleanup-apply' : 'cleanup-preview';
  else opts.mode = opts.apply ? 'apply' : 'dry-run';
  return opts;
}

function resolveEmails(opts, env) {
  const emails = {};
  const problems = [];
  for (const role of ROLE_ORDER) {
    const source = EMAIL_SOURCES[role];
    const value = String(opts.flags[source.flag] ?? env[source.env] ?? '')
      .trim()
      .toLowerCase();
    if (!value) problems.push(`${source.env} (or ${source.flag}=) is required`);
    else if (!EMAIL_RE.test(value)) problems.push(`${source.env} is not a valid email`);
    emails[role] = value;
  }

  const seen = new Set();
  for (const role of ROLE_ORDER) {
    if (!emails[role]) continue;
    if (seen.has(emails[role])) problems.push('fixture emails must be distinct');
    seen.add(emails[role]);
  }

  if (problems.length > 0) {
    throw new UsageError([...new Set(problems)].join('; '));
  }
  return emails;
}

function resolveMobiles(env) {
  const prefix = String(env.FIXTURE_MOBILE_PREFIX || '+175755501').trim();
  const mobiles = {};
  ROLE_ORDER.forEach((role, index) => {
    const mobile = `${prefix}${91 + index}`;
    if (!E164_RE.test(mobile)) {
      throw new UsageError('FIXTURE_MOBILE_PREFIX does not produce E.164 numbers');
    }
    mobiles[role] = mobile;
  });
  return mobiles;
}

function formatCounts(counts) {
  return Object.entries(counts)
    .map(([name, count]) => `  ${name.padEnd(24)} ${count}`)
    .join('\n');
}

async function runCleanup({ opts, log, error }) {
  const applying = opts.mode === 'cleanup-apply';
  const related = await classifyRelatedDocuments();
  const reviewTotal = Object.values(related).reduce((n, r) => n + r.review.length, 0);

  log('Related QA documents (fixture-owned, all references fixture ids):');
  log(formatCounts(Object.fromEntries(Object.entries(related).map(([c, r]) => [c, r.deletable.length]))));
  log('Needs manual review (references fixtures; never deleted):');
  log(formatCounts(Object.fromEntries(Object.entries(related).map(([c, r]) => [c, r.review.length]))));
  for (const [collection, r] of Object.entries(related)) {
    if (r.review.length) log(`  ${collection} ids: ${r.review.map(String).join(', ')}`);
  }
  log('Stripe was not called: PaymentIntents, transfers and refunds in Stripe TEST mode are left untouched.');

  if (reviewTotal > 0 && !opts.allowOrphansReport) {
    error(
      `${reviewTotal} document(s) need manual review. ${applying ? 'Nothing was deleted. ' : ''}` +
        'Resolve them, or re-run with --allow-orphans-report to leave them in place.'
    );
    return 1;
  }

  if (!applying) {
    log('Marker-tagged fixture documents (would be deleted):');
    log(formatCounts(await cleanupFixtures({ dryRun: true })));
    log('Cleanup dry run: nothing was deleted. Re-run with --cleanup --apply to delete.');
    return 0;
  }

  const relatedDeleted = await deleteRelatedDocuments(related);
  log('Deleted related QA documents:');
  log(formatCounts(relatedDeleted));
  log('Deleted marker-tagged fixture documents:');
  log(formatCounts(await cleanupFixtures({ dryRun: false })));
  return 0;
}

/**
 * Entry point. Returns a process exit code; never calls process.exit itself.
 */
async function main({ argv = process.argv.slice(2), env = process.env, log = console.log, error = console.error } = {}) {
  let opts;
  let emails;
  let mobiles;
  let target;

  try {
    opts = parseArgs(argv);
    emails = resolveEmails(opts, env);
    mobiles = resolveMobiles(env);
    target = assertPreconditions({ env, emails });
  } catch (err) {
    if (err instanceof GuardError || err instanceof UsageError) {
      error(err.message);
      return 2;
    }
    throw err;
  }

  if (opts.mode === 'apply') {
    const password = env.FIXTURE_PASSWORD || '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      error(`Refusing to apply: FIXTURE_PASSWORD must be set (min ${MIN_PASSWORD_LENGTH} chars)`);
      return 2;
    }
  }

  log(`Synthetic fixture seeder (tag ${FIXTURE_TAG}), mode: ${opts.mode}`);
  log(`Target database: host(s) ${target.hosts.join(', ')}, db "${target.dbName}"`);
  log('Fixture accounts:');
  for (const role of ROLE_ORDER) {
    log(`  ${ROLES[role].label.padEnd(12)} ${ROLES[role].role.padEnd(15)} ${maskEmail(emails[role])}`);
  }

  // Only ever use a connection built here from the guarded URI.
  if (mongoose.connection.readyState !== 0) {
    error('Refusing: a database connection is already open in this process');
    return 2;
  }
  // autoIndex/autoCreate off: the seeder must not build indexes or create
  // collections as a side effect (dry-run stays read-only).
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

    if (opts.cleanup) {
      try {
        return await runCleanup({ opts, log, error });
      } catch (err) {
        if (err && err.isFixtureSafe) {
          error(`Refusing: ${err.message}`);
          return 1;
        }
        throw err;
      }
    }

    const passwordHash =
      opts.mode === 'apply' ? await bcrypt.hash(env.FIXTURE_PASSWORD, 12) : undefined;
    const planName = String(env.FIXTURE_SUBSCRIPTION_PLAN || 'Launch Plan').trim();

    const plan = await buildPlan({ emails, mobiles, planName, passwordHash });

    log('Plan:');
    for (const entry of plan.entries) {
      log(`  ${entry.action.padEnd(7)} ${entry.model.padEnd(24)} ${entry.key}`);
    }
    const toCreate = plan.entries.filter((e) => e.action === 'create').length;
    log(`Summary: ${toCreate} to create, ${plan.entries.length - toCreate} already present`);

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

    const result = await applyPlan(plan);
    log(`Applied: ${result.created} created, ${result.existing} already present`);
    log('Fixture counts by model:');
    log(formatCounts(await countFixtures()));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { main, parseArgs, resolveEmails, resolveMobiles };

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      // Only our own guard/cap errors carry messages known to be safe to
      // print; anything else may carry connection details, so print its name.
      const safe = err && (err.isFixtureSafe || err.name === 'GuardError');
      console.error(`Seeder failed: ${safe ? err.message : err && err.name ? err.name : 'Error'}`);
      process.exitCode = 1;
    });
}
