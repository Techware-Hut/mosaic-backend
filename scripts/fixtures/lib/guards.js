'use strict';

/**
 * Preconditions for the synthetic staging fixture seeder.
 *
 * Every check fails closed: a missing or malformed value is a refusal.
 * Nothing in this module ever returns or prints connection credentials.
 */

const REQUIRED_RELEASE_ENVIRONMENT = 'staging';
const REQUIRED_CONFIRM_VALUE = 'synthetic-staging';

// Mongo falls back to the "test" database when the URI has no path.
const REFUSED_DB_NAMES = new Set(['', 'test', 'admin', 'local', 'config']);

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
 * Parse hosts and database name from a MongoDB connection string without
 * keeping the credential segment. Throws a plain Error (no URI in the
 * message) when the string is not a mongodb:// or mongodb+srv:// URI.
 */
function parseMongoTarget(uri) {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error('MONGODB_URI is not set');
  }

  const match = /^(mongodb(?:\+srv)?):\/\/(.*)$/i.exec(uri.trim());
  if (!match) {
    throw new Error('MONGODB_URI is not a mongodb:// or mongodb+srv:// URI');
  }

  let rest = match[2];
  const pathStart = rest.search(/[/?]/);
  let authority = pathStart === -1 ? rest : rest.slice(0, pathStart);
  rest = pathStart === -1 ? '' : rest.slice(pathStart);

  const at = authority.lastIndexOf('@');
  if (at !== -1) {
    authority = authority.slice(at + 1);
  }

  const hosts = authority
    .split(',')
    .map(stripPort)
    .filter(Boolean);

  if (hosts.length === 0) {
    throw new Error('MONGODB_URI has no host');
  }

  let dbName = '';
  if (rest.startsWith('/')) {
    const q = rest.indexOf('?');
    dbName = rest.slice(1, q === -1 ? undefined : q);
    try {
      dbName = decodeURIComponent(dbName);
    } catch (_err) {
      throw new Error('MONGODB_URI database name is not valid');
    }
  }

  return { scheme: match[1].toLowerCase(), hosts, dbName };
}

function parseHostList(value) {
  return String(value || '')
    .split(',')
    .map(stripPort)
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
 * @returns {{ hosts: string[], dbName: string }} the safe-to-print target
 * @throws {GuardError}
 */
function assertPreconditions({ env, emails }) {
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
    }
  }

  const allowlist = parseMailAllowlist(env.MAIL_RECIPIENT_ALLOWLIST);
  if (allowlist.size === 0) {
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
  REQUIRED_RELEASE_ENVIRONMENT,
  REQUIRED_CONFIRM_VALUE,
  GuardError,
  parseMongoTarget,
  parseHostList,
  parseMailAllowlist,
  isAllowlisted,
  maskEmail,
  assertPreconditions,
};
