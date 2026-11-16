'use strict';

// Staging-only recipient allowlist for outbound mail and SMS.
// Outside hosted staging (no staging marker) nothing here changes behaviour.
// In hosted staging the guard is always on and fails closed: only allowlisted
// recipients are delivered, and when the allowlist is unset, blank or parses to
// zero valid entries every send of that kind is suppressed. Staging data may be
// a production clone, so real customers must never be reachable by default.

const frontendUrl = require('./frontendUrl');

function isStagingEnv(env) {
  // Guarded so partial test doubles of ./frontendUrl fall back to pass-through.
  return typeof frontendUrl.isStagingEnv === 'function' && frontendUrl.isStagingEnv(env) === true;
}

const MAIL_ALLOWLIST_ENV = 'MAIL_RECIPIENT_ALLOWLIST';
const SMS_ALLOWLIST_ENV = 'SMS_RECIPIENT_ALLOWLIST';

const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const DOMAIN_SUFFIX_PATTERN = /^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

function rawEntries(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowlistSet(env, name) {
  return typeof env[name] === 'string' && env[name].trim() !== '';
}

/**
 * Public, non-sensitive policy enum.
 *  - 'off'                  not hosted staging: pure pass-through
 *  - 'enforced'             staging, allowlist has >= 1 valid entry
 *  - 'suppress_all_unset'   staging, allowlist unset/blank: nothing is sent
 *  - 'suppress_all_invalid' staging, allowlist set but zero valid entries: nothing is sent
 */
function policyFor(active, set, size) {
  if (!active) return 'off';
  if (!set) return 'suppress_all_unset';
  return size > 0 ? 'enforced' : 'suppress_all_invalid';
}

/**
 * @returns {{ active: boolean, policy: string, addresses: Set<string>, domains: string[], size: number }}
 */
function getMailAllowlist(env = process.env) {
  const active = isStagingEnv(env) && isAllowlistSet(env, MAIL_ALLOWLIST_ENV);
  const set = isAllowlistSet(env, MAIL_ALLOWLIST_ENV);
  const addresses = new Set();
  const domains = [];
  if (active && set) {
    for (const entry of rawEntries(env[MAIL_ALLOWLIST_ENV])) {
      const lower = entry.toLowerCase();
      if (DOMAIN_SUFFIX_PATTERN.test(lower)) {
        if (!domains.includes(lower)) domains.push(lower);
      } else if (EMAIL_PATTERN.test(lower)) {
        addresses.add(lower);
      }
    }
  }
  const size = addresses.size + domains.length;
  return { active, policy: policyFor(active, set, size), addresses, domains, size };
}

/**
 * @returns {{ active: boolean, policy: string, numbers: Set<string>, size: number }}
 */
function getSmsAllowlist(env = process.env) {
  const active = isStagingEnv(env) && isAllowlistSet(env, SMS_ALLOWLIST_ENV);
  const set = isAllowlistSet(env, SMS_ALLOWLIST_ENV);
  const numbers = new Set();
  if (active && set) {
    for (const entry of rawEntries(env[SMS_ALLOWLIST_ENV])) {
      if (E164_PATTERN.test(entry)) numbers.add(entry);
    }
  }
  return { active, policy: policyFor(active, set, numbers.size), numbers, size: numbers.size };
}

function isMailAddressAllowed(address, allowlist) {
  if (typeof address !== 'string') return false;
  const lower = address.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(lower)) return false;
  if (allowlist.addresses.has(lower)) return true;
  return allowlist.domains.some((suffix) => lower.endsWith(suffix));
}

function isSmsNumberAllowed(number, allowlist) {
  return typeof number === 'string' && allowlist.numbers.has(number.trim());
}

function parseAddressField(value) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  const parsed = [];
  for (const item of items) {
    if (!item) continue;
    if (typeof item === 'object') {
      if (typeof item.address === 'string') {
        parsed.push({ name: item.name || '', address: item.address });
      }
      continue;
    }
    const addressparser = require('nodemailer/lib/addressparser');
    for (const entry of addressparser(String(item), { flatten: true })) {
      if (entry && typeof entry.address === 'string' && entry.address) {
        parsed.push({ name: entry.name || '', address: entry.address });
      }
    }
  }
  return parsed;
}

const MAIL_RECIPIENT_FIELDS = ['to', 'cc', 'bcc'];

// Custom headers named To/Cc/Bcc become SMTP recipients in nodemailer, and a
// `raw` message carries its own recipient headers. Neither can be filtered
// safely, so an active allowlist suppresses such messages outright.
function hasHeaderRecipients(headers) {
  if (!headers || typeof headers !== 'object') return false;
  const keys = Array.isArray(headers)
    ? headers.map((header) => (header && typeof header.key === 'string' ? header.key : ''))
    : Object.keys(headers);
  return keys.some((key) => MAIL_RECIPIENT_FIELDS.includes(String(key).trim().toLowerCase()));
}

/**
 * Filters to/cc/bcc (and envelope.to/cc/bcc) against an active allowlist.
 * @returns {{ mailOptions: object, total: number, allowed: number, suppress: boolean, reason: string }}
 */
function filterMailOptions(mailOptions, allowlist) {
  const next = { ...(mailOptions || {}) };
  let total = 0;
  let allowed = 0;

  if (next.raw !== undefined && next.raw !== null && next.raw !== false) {
    return { mailOptions: next, total, allowed, suppress: true, reason: 'raw_message' };
  }
  if (hasHeaderRecipients(next.headers)) {
    return { mailOptions: next, total, allowed, suppress: true, reason: 'header_recipients' };
  }

  for (const field of MAIL_RECIPIENT_FIELDS) {
    if (!(field in next)) continue;
    const parsed = parseAddressField(next[field]);
    const kept = parsed.filter((entry) => isMailAddressAllowed(entry.address, allowlist));
    total += parsed.length;
    allowed += kept.length;
    if (kept.length > 0) {
      next[field] = kept;
    } else {
      delete next[field];
    }
  }

  // nodemailer delivers to an explicit envelope verbatim (header recipients are
  // ignored), so an envelope left without allowed recipients is suppressed.
  let envelopeAllowed = null;
  if (next.envelope && typeof next.envelope === 'object') {
    const envelope = { ...next.envelope };
    envelopeAllowed = 0;
    for (const field of MAIL_RECIPIENT_FIELDS) {
      if (!(field in envelope)) continue;
      const kept = parseAddressField(envelope[field])
        .filter((entry) => isMailAddressAllowed(entry.address, allowlist))
        .map((entry) => entry.address);
      envelopeAllowed += kept.length;
      if (kept.length > 0) envelope[field] = kept;
      else delete envelope[field];
    }
    next.envelope = envelope;
  }

  if (allowed === 0) {
    return { mailOptions: next, total, allowed, suppress: true, reason: 'no_allowed_recipients' };
  }
  if (envelopeAllowed === 0) {
    return { mailOptions: next, total, allowed, suppress: true, reason: 'no_allowed_envelope_recipients' };
  }
  return { mailOptions: next, total, allowed, suppress: false, reason: 'allowed' };
}

module.exports = {
  MAIL_ALLOWLIST_ENV,
  SMS_ALLOWLIST_ENV,
  filterMailOptions,
  getMailAllowlist,
  getSmsAllowlist,
  isMailAddressAllowed,
  isSmsNumberAllowed,
};
