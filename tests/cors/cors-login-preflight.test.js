const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const supertest = require('supertest');

const appPath = path.resolve(__dirname, '../../app.js');
const corsOriginsPath = path.resolve(__dirname, '../../utils/corsOrigins.js');
const ENV_KEYS = [
  'NODE_ENV',
  'CORS_ORIGINS',
  'FRONTEND_URL',
  'STRIPE_SECRET_KEY',
  'JWT_SECRET',
];

function snapshotEnv() {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  delete require.cache[appPath];
  delete require.cache[corsOriginsPath];
}

function loadAppWithEnv(envOverrides) {
  const saved = snapshotEnv();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_cors_login_preflight_mock',
    JWT_SECRET: 'cors-login-preflight-jwt-secret-min-32-chars',
    ...envOverrides,
  });
  delete require.cache[appPath];
  delete require.cache[corsOriginsPath];
  const app = require(appPath);
  return { app, cleanup: () => restoreEnv(saved) };
}

test('OPTIONS /api/users/login allows production app origin with credentials', async () => {
  const { app, cleanup } = loadAppWithEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS:
      'https://app.mosaicbizhub.com,https://mosaic-biz-frontend-launch.vercel.app',
  });

  try {
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', 'https://app.mosaicbizhub.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://app.mosaicbizhub.com');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally {
    cleanup();
  }
});

test('OPTIONS /api/users/login allows Vercel preview origin when configured', async () => {
  const { app, cleanup } = loadAppWithEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS:
      'https://app.mosaicbizhub.com,https://mosaic-biz-frontend-launch.vercel.app',
  });

  try {
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', 'https://mosaic-biz-frontend-launch.vercel.app')
      .set('Access-Control-Request-Method', 'POST');

    assert.equal(res.status, 204);
    assert.equal(
      res.headers['access-control-allow-origin'],
      'https://mosaic-biz-frontend-launch.vercel.app'
    );
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally {
    cleanup();
  }
});

test('OPTIONS /api/users/login rejects disallowed origin', async () => {
  const { app, cleanup } = loadAppWithEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.mosaicbizhub.com',
  });

  try {
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    assert.equal(res.status, 500);
  } finally {
    cleanup();
  }
});
