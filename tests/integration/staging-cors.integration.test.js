const test = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { startHarness, stopHarness, getApp } = require('./setup/harness');

const APPROVED_ORIGINS = [
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-synthetic123-digital-builders.vercel.app',
];
const ENV_KEYS = [
  'NODE_ENV', 'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'CORS_ORIGINS',
  'FRONTEND_URL', 'API_BASE_URL', 'AUTH_SESSION_POLICY',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

test.before(async () => {
  // The existing harness provides disposable Mongo and provider/mail stubs.
  // Mark staging before the actual app captures its CORS list at import time.
  Object.assign(process.env, {
    RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
    CORS_ORIGINS: APPROVED_ORIGINS.join(','),
    FRONTEND_URL: APPROVED_ORIGINS[1], API_BASE_URL: 'https://api-staging.mosaicbizhub.com',
  });
  delete process.env.AUTH_SESSION_POLICY;
  await startHarness();
  // Harness initialization uses test mode; EB staging runs in production mode.
  process.env.NODE_ENV = 'production';
});

test.after(async () => {
  try {
    await stopHarness();
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function assertNoCredentialsOrIdentity(res) {
  assert.equal(res.headers['set-cookie'], undefined);
  assert.equal(res.body.user, undefined);
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.loggedIn, undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
}

function assertAllowed(res, origin) {
  assert.equal(res.headers['access-control-allow-origin'], origin);
  assert.notEqual(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
  assert.match(res.headers.vary, /(?:^|,)\s*Origin(?:,|$)/i);
}

function assertDenied(res) {
  // callback(null, false) removes browser CORS permission, not authorization.
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers['access-control-allow-credentials'], undefined);
}

async function authResponse(origin, query, status, code) {
  const req = supertest(getApp()).get(`/api/users/auth/check${query}`);
  if (origin !== undefined) req.set('Origin', origin);
  const res = await req;
  assert.equal(res.status, status);
  assert.equal(res.body.code, code);
  assertNoCredentialsOrIdentity(res);
  assert.equal(process.env.AUTH_SESSION_POLICY, undefined);
  return res;
}

for (const origin of APPROVED_ORIGINS) {
  test(`actual staging app grants preflight and readable anonymous 401/409: ${origin}`, async () => {
    const options = await supertest(getApp()).options('/api/users/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    assert.equal(options.status, 204);
    assertAllowed(options, origin);
    assert.match(options.headers['access-control-allow-methods'], /POST/);
    assert.equal(options.headers['access-control-allow-headers'], 'content-type');
    assert.match(options.headers.vary, /Access-Control-Request-Headers/i);
    assertAllowed(await authResponse(origin, '', 401, 'AUTHENTICATION_REQUIRED'), origin);
    assertAllowed(await authResponse(origin, '?sessionPolicy=legacy', 401, 'AUTHENTICATION_REQUIRED'), origin);
    assertAllowed(await authResponse(origin, '?sessionPolicy=staging-v1', 409, 'AUTH_SESSION_POLICY_MISMATCH'), origin);
  });
}

for (const origin of [
  'https://mosaicbizhub.com', 'https://www.mosaicbizhub.com',
  'https://api.mosaicbizhub.com', 'https://api-staging.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-synthetic456-digital-builders.vercel.app',
  'https://other-project.vercel.app', 'https://app.mosaicbizhub.com.evil.test',
  'https://user@app.mosaicbizhub.com', 'https://app.mosaicbizhub.com:8443',
  'https://app.mosaicbizhub.com/path', 'null', '*',
]) {
  test(`actual staging app grants no CORS permission to denied origin: ${origin}`, async () => {
    const options = await supertest(getApp()).options('/api/users/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');
    assert.notEqual(options.status, 500);
    assertDenied(options);
    // The real handlers still respond; CORS denial is not an HTTP 403/CSRF guard.
    assertDenied(await authResponse(origin, '', 401, 'AUTHENTICATION_REQUIRED'));
    assertDenied(await authResponse(origin, '?sessionPolicy=staging-v1', 409, 'AUTH_SESSION_POLICY_MISMATCH'));
  });
}

test('no-Origin server-to-server auth requests remain compatible without bypassing authentication', async () => {
  const anonymous = await authResponse(undefined, '', 401, 'AUTHENTICATION_REQUIRED');
  const mismatch = await authResponse(undefined, '?sessionPolicy=staging-v1', 409, 'AUTH_SESSION_POLICY_MISMATCH');
  for (const res of [anonymous, mismatch]) {
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    // Existing cors middleware may emit ACAC:true here; without ACAO it does
    // not grant browser readability. Preserve app.js's no-Origin behavior.
  }
});
