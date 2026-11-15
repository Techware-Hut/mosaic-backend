'use strict';

// Opt-in, staging-only recipient allowlist for outbound mail and SMS.
// Outside hosted staging, or when the env var is unset/blank, nothing here
// changes behaviour. When active and the list parses to zero valid entries,
// every send is suppressed (fail closed).

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
 * @returns {{ active: boolean, addresses: Set<string>, domains: string[], size: number }}
 */
function getMailAllowlist(env = process.env) {
  const active = isStagingEnv(env) && isAllowlistSet(env, MAIL_ALLOWLIST_ENV);
  const addresses = new Set();
  const domains = [];
  if (active) {
    for (const entry of rawEntries(env[MAIL_ALLOWLIST_ENV])) {
      const lower = entry.toLowerCase();
      if (DOMAIN_SUFFIX_PATTERN.test(lower)) {
        if (!domains.includes(lower)) domains.push(lower);
      } else if (EMAIL_PATTERN.test(lower)) {
        addresses.add(lower);
      }
    }
  }
  return { active, addresses, domains, size: addresses.size + domains.length };
}

/**
 * @returns {{ active: boolean, numbers: Set<string>, size: number }}
 */
function getSmsAllowlist(env = process.env) {
  const active = isStagingEnv(env) && isAllowlistSet(env, SMS_ALLOWLIST_ENV);
  const numbers = new Set();
  if (active) {
    for (const entry of rawEntries(env[SMS_ALLOWLIST_ENV])) {
      if (E164_PATTERN.test(entry)) numbers.add(entry);
    }
  }
  return { active, numbers, size: numbers.size };
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

/**
 * Filters to/cc/bcc (and envelope.to/cc/bcc) against an active allowlist.
 * @returns {{ mailOptions: object, total: number, allowed: number, suppress: boolean }}
 */
function filterMailOptions(mailOptions, allowlist) {
  const next = { ...(mailOptions || {}) };
  let total = 0;
  let allowed = 0;

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

  if (next.envelope && typeof next.envelope === 'object') {
    const envelope = { ...next.envelope };
    for (const field of MAIL_RECIPIENT_FIELDS) {
      if (!(field in envelope)) continue;
      const kept = parseAddressField(envelope[field])
        .filter((entry) => isMailAddressAllowed(entry.address, allowlist))
        .map((entry) => entry.address);
      if (kept.length > 0) envelope[field] = kept;
      else delete envelope[field];
    }
    next.envelope = envelope;
  }

  return { mailOptions: next, total, allowed, suppress: allowed === 0 };
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
