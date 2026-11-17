#!/usr/bin/env node
'use strict';

/**
 * Synthetic staging fixture seeder.
 *
 * Usage:
 *   node scripts/fixtures/seed-synthetic-staging.js [--dry-run]      # default: print the plan
 *   node scripts/fixtures/seed-synthetic-staging.js --apply          # insert missing fixtures
 *   node scripts/fixtures/seed-synthetic-staging.js --cleanup        # delete marker-carrying docs
 *   node scripts/fixtures/seed-synthetic-staging.js --cleanup --dry-run   # count only
 *
 * Required environment (every mode; the script refuses otherwise):
 *   RELEASE_ENVIRONMENT=staging
 *   FIXTURE_SEED_CONFIRM=synthetic-staging
 *   MONGODB_URI                 must name the database; its host(s) must be listed in
 *   FIXTURE_ALLOWED_DB_HOSTS    comma-separated host names (ports ignored)
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
 * Stripe Connect is left unset and no payment objects are created.
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
  const opts = { apply: false, cleanup: false, dryRun: false, flags: {} };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
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

  if (opts.apply && opts.cleanup) {
    throw new UsageError('--apply and --cleanup cannot be combined');
  }
  if (opts.apply && opts.dryRun) {
    throw new UsageError('--apply and --dry-run cannot be combined');
  }

  opts.mode = opts.apply ? 'apply' : opts.cleanup ? 'cleanup' : 'dry-run';
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

  log(`Synthetic fixture seeder (tag ${FIXTURE_TAG}), mode: ${opts.mode}${opts.cleanup && opts.dryRun ? ' (dry-run)' : ''}`);
  log(`Target database: host(s) ${target.hosts.join(', ')}, db "${target.dbName}"`);
  log('Fixture accounts:');
  for (const role of ROLE_ORDER) {
    log(`  ${ROLES[role].label.padEnd(12)} ${ROLES[role].role.padEnd(15)} ${maskEmail(emails[role])}`);
  }

  const ownConnection = mongoose.connection.readyState === 0;
  if (ownConnection) {
    // autoIndex/autoCreate off: the seeder must not build indexes or create
    // collections as a side effect (dry-run stays read-only).
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      autoIndex: false,
      autoCreate: false,
    });
  }

  try {
    if (mongoose.connection.db.databaseName !== target.dbName) {
      error('Refusing: connected database name does not match the URI');
      return 2;
    }

    if (opts.mode === 'cleanup') {
      const deleted = await cleanupFixtures({ dryRun: opts.dryRun });
      log(opts.dryRun ? 'Cleanup preview (documents with the fixture marker):' : 'Cleanup deleted (fixture marker only):');
      log(formatCounts(deleted));
      return 0;
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
    if (ownConnection) {
      await mongoose.disconnect();
    }
  }
}

module.exports = { main, parseArgs, resolveEmails, resolveMobiles };

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      // Do not echo error objects that might carry connection details.
      console.error(`Seeder failed: ${err && err.name ? err.name : 'Error'}`);
      process.exitCode = 1;
    });
}
