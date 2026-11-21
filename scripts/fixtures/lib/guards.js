'use strict';

/**
 * Preconditions for the synthetic staging fixture seeder.
 *
 * The MAIL_RECIPIENT_ALLOWLIST check here is a precondition only: it confirms
 * the fixture emails are covered. Enforcement of the allowlist on outgoing
 * mail is done by the backend itself (backend PR #330), which must already be
 * deployed on staging before this seeder is used.
 *
 * Every check fails closed: a missing or malformed value is a refusal.
 * Nothing in this module ever returns or prints connection credentials.
 */

const REQUIRED_RELEASE_ENVIRONMENT = 'staging';
const REQUIRED_CONFIRM_VALUE = 'synthetic-staging';

const fs = require('fs');
const path = require('path');

const PARSER_PACKAGE = 'mongodb-connection-string-url';

/**
 * Load the connection-string parser that the connecting driver itself uses:
 * resolve mongodb from mongoose's location, then the parser from mongodb's
 * location. A different (e.g. dev-only, hoisted) copy is never used.
 * Throws if any step fails, so callers fail closed.
 */
function resolveDriverConnectionStringParser() {
  const mongooseDir = path.dirname(require.resolve('mongoose/package.json'));
  const mongodbDir = path.dirname(
    require.resolve('mongodb/package.json', { paths: [mongooseDir] })
  );
  const entryPath = require.resolve(PARSER_PACKAGE, { paths: [mongodbDir] });

  // The parser's package.json is not exported; walk up from its entry file.
  let packageDir = path.dirname(entryPath);
  for (;;) {
    const candidate = path.join(packageDir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === PARSER_PACKAGE) break;
    }
    const parent = path.dirname(packageDir);
    if (parent === packageDir) throw new Error(`${PARSER_PACKAGE} package root not found`);
    packageDir = parent;
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(entryPath);
  const ConnectionString = mod.ConnectionString || mod.default;
  if (typeof ConnectionString !== 'function') {
    throw new Error(`${PARSER_PACKAGE} does not export ConnectionString`);
  }

  return { ConnectionString, entryPath, packageDir, mongodbDir };
}

let driverParser = null;
let driverParserError = null;
try {
  driverParser = resolveDriverConnectionStringParser();
} catch (err) {
  driverParserError = err;
}

// Mongo falls back to the "test" database when the URI has no path.
const REFUSED_DB_NAMES = new Set(['', 'test', 'admin', 'local', 'config']);

// Hard-coded, non-configurable target rules. These apply before (and
// regardless of) FIXTURE_ALLOWED_DB_NAMES, so an operator allowlist can never
// widen the seeder onto a non-staging database.
const PRODUCTION_DB_NAMES = new Set(['mosaic']);
const STAGING_DB_NAME_RE = /^.+_staging$/;

const EXACT_ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const DOMAIN_SUFFIX_RE = /^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

class GuardError extends Error {
  constructor(failures) {
    super(
      `Refusing to run synthetic fixture seeder:\n${failures
        .map((f) => `  - [${f.code}] ${f.message}`)
        .join('\n')}`
    );
    this.name = 'GuardError';
    this.failures = failures;
  }
}

function stripPort(hostPart) {
  const host = hostPart.trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host.toLowerCase() : host.slice(1, end).toLowerCase();
  }
  const colon = host.lastIndexOf(':');
  return (colon === -1 ? host : host.slice(0, colon)).toLowerCase();
}

/**
 * Parse hosts and database name from a MongoDB connection string with the
 * driver's own parser (mongodb-connection-string-url). Errors never include
 * any part of the URI.
 */
function parseMongoTarget(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error('MONGODB_URI is not set');
  }

  if (!driverParser) {
    throw new Error(
      `cannot load the mongodb driver's ${PARSER_PACKAGE} (${driverParserError ? driverParserError.message : 'unknown error'}); refusing`
    );
  }

  let parsed;
  try {
    parsed = new driverParser.ConnectionString(uri.trim());
  } catch (_err) {
    throw new Error('MONGODB_URI is not a valid mongodb:// or mongodb+srv:// URI');
  }

  const hosts = parsed.hosts.map(stripPort).filter(Boolean);
  if (hosts.length === 0) {
    throw new Error('MONGODB_URI has no host');
  }

  let dbName = '';
  try {
    dbName = decodeURIComponent(String(parsed.pathname || '').replace(/^\//, ''));
  } catch (_err) {
    throw new Error('MONGODB_URI database name is not valid');
  }

  return { scheme: parsed.isSRV ? 'mongodb+srv' : 'mongodb', hosts, dbName };
}

function parseHostList(value) {
  return String(value || '')
    .split(',')
    .map(stripPort)
    .filter(Boolean);
}

function parseNameList(value) {
  return String(value || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Same entry rules as the staging mail recipient allowlist: exact addresses
 * or "@domain" suffixes (no subdomain match). Invalid entries are dropped.
 */
function parseMailAllowlist(value) {
  const exact = new Set();
  const domains = new Set();

  for (const raw of String(value || '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith('@')) {
      if (DOMAIN_SUFFIX_RE.test(entry)) domains.add(entry);
    } else if (EXACT_ADDRESS_RE.test(entry)) {
      exact.add(entry);
    }
  }

  return { exact, domains, size: exact.size + domains.size };
}

function isAllowlisted(email, allowlist) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return false;
  if (allowlist.exact.has(address)) return true;
  for (const domain of allowlist.domains) {
    if (address.endsWith(domain)) return true;
  }
  return false;
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Run every precondition and collect all failures.
 * @param {object} options
 * @param {object} options.env
 * @param {Record<string,string>} [options.emails] role -> fixture email
 * @param {boolean} [options.requireMailAllowlist=true] the reference-data
 *   seeder creates no accounts and sends no mail, so it passes false; every
 *   other check is unchanged. Only the boolean false opts out.
 * @returns {{ hosts: string[], dbName: string }} the safe-to-print target
 * @throws {GuardError}
 */
function assertPreconditions({ env, emails, requireMailAllowlist = true }) {
  const failures = [];
  const fail = (code, message) => failures.push({ code, message });

  if (env.RELEASE_ENVIRONMENT !== REQUIRED_RELEASE_ENVIRONMENT) {
    fail(
      'RELEASE_ENVIRONMENT',
      `RELEASE_ENVIRONMENT must be exactly "${REQUIRED_RELEASE_ENVIRONMENT}"`
    );
  }

  if (env.FIXTURE_SEED_CONFIRM !== REQUIRED_CONFIRM_VALUE) {
    fail(
      'FIXTURE_SEED_CONFIRM',
      `FIXTURE_SEED_CONFIRM must be exactly "${REQUIRED_CONFIRM_VALUE}"`
    );
  }

  let target = null;
  try {
    target = parseMongoTarget(env.MONGODB_URI);
  } catch (err) {
    fail('MONGODB_URI', err.message);
  }

  if (target) {
    const allowedHosts = new Set(parseHostList(env.FIXTURE_ALLOWED_DB_HOSTS));
    if (allowedHosts.size === 0) {
      fail('DB_HOST_ALLOWLIST', 'FIXTURE_ALLOWED_DB_HOSTS is not set');
    } else {
      const notAllowed = target.hosts.filter((h) => !allowedHosts.has(h));
      if (notAllowed.length > 0) {
        fail(
          'DB_HOST_NOT_ALLOWED',
          `database host(s) not in FIXTURE_ALLOWED_DB_HOSTS: ${notAllowed.join(', ')}`
        );
      }
    }

    if (REFUSED_DB_NAMES.has(target.dbName)) {
      fail(
        'DB_NAME_REFUSED',
        `database name "${target.dbName || '(none)'}" is not allowed; the URI must name the staging database`
      );
    } else if (PRODUCTION_DB_NAMES.has(target.dbName.toLowerCase())) {
      fail(
        'DB_NAME_PRODUCTION',
        `database name "${target.dbName}" is a production database; the seeder never runs against it`
      );
    } else if (!STAGING_DB_NAME_RE.test(target.dbName)) {
      fail(
        'DB_NAME_NOT_STAGING',
        `database name "${target.dbName}" does not end with "_staging"; the seeder only runs against staging databases`
      );
    } else {
      const allowedNames = new Set(parseNameList(env.FIXTURE_ALLOWED_DB_NAMES));
      if (allowedNames.size === 0) {
        fail('DB_NAME_ALLOWLIST', 'FIXTURE_ALLOWED_DB_NAMES is not set');
      } else if (!allowedNames.has(target.dbName)) {
        fail(
          'DB_NAME_NOT_ALLOWED',
          `database name "${target.dbName}" is not in FIXTURE_ALLOWED_DB_NAMES (exact match)`
        );
      }
    }
  }

  const allowlist = parseMailAllowlist(env.MAIL_RECIPIENT_ALLOWLIST);
  // Only an explicit boolean false opts out; any other value (null, 0, '',
  // a string) keeps the allowlist requirement, so the guard fails closed.
  if (requireMailAllowlist === false) {
    // Skipped by the caller (no fixture emails to cover).
  } else if (allowlist.size === 0) {
    fail('MAIL_ALLOWLIST_UNSET', 'MAIL_RECIPIENT_ALLOWLIST has no valid entry');
  } else {
    const missing = Object.entries(emails || {})
      .filter(([, email]) => !isAllowlisted(email, allowlist))
      .map(([role]) => role);
    if (missing.length > 0) {
      fail(
        'MAIL_NOT_ALLOWLISTED',
        `fixture email(s) not in MAIL_RECIPIENT_ALLOWLIST for: ${missing.join(', ')}`
      );
    }
  }

  if (failures.length > 0) {
    throw new GuardError(failures);
  }

  return { hosts: target.hosts, dbName: target.dbName };
}

module.exports = {
  resolveDriverConnectionStringParser,
  REQUIRED_RELEASE_ENVIRONMENT,
  REQUIRED_CONFIRM_VALUE,
  PRODUCTION_DB_NAMES,
  STAGING_DB_NAME_RE,
  GuardError,
  parseMongoTarget,
  parseHostList,
  parseMailAllowlist,
  isAllowlisted,
  maskEmail,
  assertPreconditions,
};
