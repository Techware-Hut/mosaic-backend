'use strict';

const STAGING_ISSUER = 'https://api-staging.mosaicbizhub.com';
const LEGACY_COOKIE_NAMES = Object.freeze({
  token: 'token', user_session: 'user_session', user_gender: 'user_gender',
  otpPending: 'otpPending', mbh_tmp: 'mbh_tmp',
});
const STAGING_COOKIE_NAMES = Object.freeze({
  token: 'mbh_stg_token', user_session: 'mbh_stg_user_session',
  user_gender: 'mbh_stg_user_gender', otpPending: 'mbh_stg_otp_pending',
  mbh_tmp: 'mbh_stg_tmp',
});

class SessionPolicyError extends Error {
  constructor() {
    super('Invalid authentication session policy configuration');
    this.code = 'INVALID_AUTH_SESSION_POLICY';
  }
}

class SessionCredentialError extends Error {
  constructor() {
    super('Ambiguous or invalid authentication credentials');
    this.code = 'AUTH_CREDENTIAL_CONFLICT';
  }
}

const normalized = (value) => String(value ?? '').trim().toLowerCase();

// Deliberately lazy: importing the package must not activate it or require settings.
// NODE_ENV and hosting markers alone never select the new contract.
function resolveSessionPolicy(env = process.env) {
  const mode = env.AUTH_SESSION_POLICY === undefined
    ? 'legacy' : String(env.AUTH_SESSION_POLICY).trim();
  if (mode === 'legacy') {
    return Object.freeze({ mode, staging: false, cookieNames: LEGACY_COOKIE_NAMES });
  }
  if (mode !== 'staging-v1') throw new SessionPolicyError();

  const markers = [env.RELEASE_ENVIRONMENT, env.SENTRY_ENVIRONMENT]
    .map(normalized).filter(Boolean);
  if (!markers.length || markers.some((marker) => marker !== 'staging')) {
    throw new SessionPolicyError();
  }
  let api;
  try { api = new URL(String(env.API_BASE_URL)); } catch { throw new SessionPolicyError(); }
  if (!/^https:\/\/[^/]+\/?$/i.test(String(env.API_BASE_URL)) ||
      api.origin !== STAGING_ISSUER || api.username || api.password ||
      api.pathname !== '/' || api.search || api.hash ||
      /[\\\u0000-\u0020\u007f]/.test(String(env.API_BASE_URL))) {
    throw new SessionPolicyError();
  }
  if ((env.COOKIE_DOMAIN !== undefined &&
       normalized(env.COOKIE_DOMAIN).replace(/^\./, '') !== 'mosaicbizhub.com') ||
      (env.COOKIE_SECURE !== undefined && normalized(env.COOKIE_SECURE) !== 'true') ||
      (env.COOKIE_SAMESITE !== undefined && normalized(env.COOKIE_SAMESITE) !== 'none') ||
      (env.TEMP_COOKIE_NAME !== undefined &&
       !['mbh_tmp', STAGING_COOKIE_NAMES.mbh_tmp].includes(env.TEMP_COOKIE_NAME))) {
    throw new SessionPolicyError();
  }
  return Object.freeze({ mode, staging: true, cookieNames: STAGING_COOKIE_NAMES });
}

function tokenContract(purpose) {
  if (purpose === 'session') return { audience: 'mosaic-staging-api', use: 'session' };
  if (purpose === 'profile_completion') {
    return { audience: 'mosaic-staging-profile', use: 'profile_completion' };
  }
  throw new SessionPolicyError();
}

function jwtClaims(purpose = 'session', env = process.env) {
  if (!resolveSessionPolicy(env).staging) return {};
  return { token_use: tokenContract(purpose).use };
}

function jwtSignOptions(purpose = 'session', env = process.env) {
  if (!resolveSessionPolicy(env).staging) return {};
  return {
    algorithm: 'HS256', issuer: STAGING_ISSUER, audience: tokenContract(purpose).audience,
  };
}

function verifyPolicyToken(token, secret, purpose = 'session', env = process.env) {
  const policy = resolveSessionPolicy(env);
  const jwt = require('jsonwebtoken');
  if (!policy.staging) return jwt.verify(token, secret);
  const contract = tokenContract(purpose);
  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'], issuer: STAGING_ISSUER, audience: contract.audience,
  });
  if (!decoded || typeof decoded !== 'object' ||
      decoded.iss !== STAGING_ISSUER || decoded.aud !== contract.audience ||
      decoded.token_use !== contract.use ||
      typeof decoded.sub !== 'string' || !decoded.sub || /\s/.test(decoded.sub) ||
      !Number.isSafeInteger(decoded.exp) ||
      (purpose === 'session' &&
       (!Number.isSafeInteger(decoded.sessionVersion) || decoded.sessionVersion < 0))) {
    throw new SessionCredentialError();
  }
  return decoded;
}

function headerValues(req, name) {
  const values = [];
  if (Array.isArray(req.rawHeaders)) {
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() === name) values.push(req.rawHeaders[i + 1]);
    }
  }
  const value = req.headers?.[name];
  if (values.length) {
    if (name === 'authorization' && value !== undefined &&
        (values.length !== 1 || typeof value !== 'string' || value !== values[0])) {
      throw new SessionCredentialError();
    }
    return values;
  }
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function readCredentialCookie(req, name) {
  const headers = headerValues(req, 'cookie');
  if (!headers.length) {
    const value = req.cookies?.[name];
    if (value === undefined) return { present: false };
    if (typeof value !== 'string') throw new SessionCredentialError();
    return { present: true, value };
  }
  const matches = [];
  for (const header of headers) {
    if (typeof header !== 'string') throw new SessionCredentialError();
    for (const part of header.split(';')) {
      const equals = part.indexOf('=');
      if (equals < 0) {
        if (part.trim() === name) throw new SessionCredentialError();
        continue;
      }
      if (part.slice(0, equals).trim() !== name) continue;
      let value = part.slice(equals + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      try { value = decodeURIComponent(value); } catch { throw new SessionCredentialError(); }
      matches.push(value);
    }
  }
  if (matches.length > 1) throw new SessionCredentialError();
  return matches.length ? { present: true, value: matches[0] } : { present: false };
}

function readBearerCredential(req) {
  const values = headerValues(req, 'authorization');
  if (!values.length) return { present: false };
  if (values.length !== 1 || typeof values[0] !== 'string') throw new SessionCredentialError();
  const match = /^Bearer ([^\s,]+)$/i.exec(values[0]);
  if (!match) throw new SessionCredentialError();
  return { present: true, value: match[1] };
}

module.exports = {
  resolveSessionPolicy, jwtClaims, jwtSignOptions, verifyPolicyToken,
  readCredentialCookie, readBearerCredential, SessionPolicyError, SessionCredentialError,
};
