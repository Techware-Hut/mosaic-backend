#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const ARN_PATTERN = /^arn:aws(?:-[a-z]+)?:[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+$/;

function parseOptions(argv, { positionals = 0, booleans = [] } = {}) {
  const booleanNames = new Set(booleans);
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }

    if (booleanNames.has(token)) {
      if (parsed[token] !== undefined) throw new Error(`Duplicate option: ${token}`);
      parsed[token] = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option ${token} requires a value`);
    }
    if (parsed[token] !== undefined) throw new Error(`Duplicate option: ${token}`);
    parsed[token] = value;
    index += 1;
  }

  if (parsed._.length !== positionals) {
    throw new Error(`Expected ${positionals} positional argument(s)`);
  }
  return parsed;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalOption(options, name, fallback) {
  const value = options[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function parseBoolean(value, name, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function assertFullSha(value, name = 'release SHA') {
  const normalized = String(value || '').toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${name} must be a full lowercase 40-character SHA`);
  }
  return normalized;
}

function assertArn(value, name) {
  if (!ARN_PATTERN.test(String(value || ''))) {
    throw new Error(`${name} must be a complete AWS ARN`);
  }
  return value;
}

function resourceRef(value, prefix = 'resource') {
  if (typeof value !== 'string' || value.length === 0) return `${prefix}-unknown`;
  const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  return `${prefix}-${digest}`;
}

function instanceSuffix(value) {
  if (typeof value !== 'string' || !/^i-[a-f0-9]+$/i.test(value)) return 'unknown';
  return value.slice(-8).toLowerCase();
}

function readJson(filePath, label = 'JSON fixture') {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch (_error) {
    throw new Error(`${label} could not be read as JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, resolved);
}

function sanitizeMessage(error, fallback = 'Release control operation failed') {
  const raw = String(error && error.message ? error.message : error || '');
  const redacted = raw
    .replace(/arn:aws(?:-[a-z]+)?:[^\s"']+/gi, '<aws-resource>')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, '<database-uri>')
    .replace(/(?:https?:\/\/)?[^\s:@/]+:[^\s@/]+@[^\s]+/gi, '<credentialed-uri>')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '<aws-access-key>')
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+\b/g, '<stripe-key>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<token>');
  if (!redacted.trim()) return fallback;
  return redacted.slice(0, 500);
}

function createAwsCliRunner({
  awsCli = process.env.AWS_CLI || 'aws',
  spawn = spawnSync,
  timeoutMs = 60000,
} = {}) {
  return function runAws(service, operation, args = []) {
    const result = spawn(awsCli, [service, operation, ...args, '--output', 'json'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
    });
    if (result.error || result.status !== 0) {
      // AWS stderr frequently repeats complete resource ARNs. Deliberately omit it.
      throw new Error(`AWS ${service} ${operation} failed`);
    }
    try {
      return JSON.parse(result.stdout || '{}');
    } catch (_error) {
      throw new Error(`AWS ${service} ${operation} did not return valid JSON`);
    }
  };
}

function exactSet(values) {
  return [...new Set(values)].sort();
}

function sameMembers(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

module.exports = {
  ARN_PATTERN,
  SHA_PATTERN,
  assertArn,
  assertFullSha,
  createAwsCliRunner,
  exactSet,
  instanceSuffix,
  nowIso,
  optionalOption,
  parseBoolean,
  parseOptions,
  readJson,
  requireOption,
  resourceRef,
  sameMembers,
  sanitizeMessage,
  writeJson,
};
