const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const supertest = require('supertest');

const corsOriginsPath = path.resolve(__dirname, '../../utils/corsOrigins.js');
const ENV_KEYS = ['NODE_ENV', 'CORS_ORIGINS', 'FRONTEND_URL'];

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
  delete require.cache[corsOriginsPath];
}

function createCorsProbeApp(envOverrides) {
  const saved = snapshotEnv();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, envOverrides);
  delete require.cache[corsOriginsPath];

  const { getAllowedOrigins, isAllowedCredentialOrigin } = require(corsOriginsPath);
  const allowedOrigins = getAllowedOrigins();
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (isAllowedCredentialOrigin(origin, allowedOrigins)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );

  app.post('/api/users/login', (_req, res) => {
    res.sendStatus(200);
  });
  app.post('/api/vendor-onboarding/stage1/upload-file', (_req, res) => {
    res.sendStatus(200);
  });

  return {
    app,
    cleanup: () => restoreEnv(saved),
  };
}

test('OPTIONS /api/users/login allows production apex origin with credentials', async () => {
  const { app, cleanup } = createCorsProbeApp({
    NODE_ENV: 'production',
    CORS_ORIGINS:
      'https://mosaicbizhub.com,https://app.mosaicbizhub.com,https://mosaic-biz-frontend-launch.vercel.app',
  });

  try {
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', 'https://mosaicbizhub.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://mosaicbizhub.com');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally {
    cleanup();
  }
});

test('OPTIONS /api/users/login allows Vercel preview origin when configured', async () => {
  const { app, cleanup } = createCorsProbeApp({
    NODE_ENV: 'production',
    CORS_ORIGINS:
      'https://mosaicbizhub.com,https://app.mosaicbizhub.com,https://mosaic-biz-frontend-launch.vercel.app',
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

test('OPTIONS /api/users/login allows same-project Vercel branch preview origin', async () => {
  const { app, cleanup } = createCorsProbeApp({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://mosaicbizhub.com',
  });

  try {
    const origin = 'https://mosaic-biz-frontend-launch-git-feature-digital-builders.vercel.app';
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], origin);
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally {
    cleanup();
  }
});

test('OPTIONS /api/users/login denies disallowed origin without server error', async () => {
  const { app, cleanup } = createCorsProbeApp({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://mosaicbizhub.com',
  });

  try {
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    assert.notEqual(res.status, 500);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    cleanup();
  }
});

test('OPTIONS /api/vendor-onboarding/stage1/upload-file allows production apex origin with credentials', async () => {
  const { app, cleanup } = createCorsProbeApp({
    NODE_ENV: 'production',
    CORS_ORIGINS:
      'https://mosaicbizhub.com,https://app.mosaicbizhub.com,https://mosaic-biz-frontend-launch.vercel.app',
  });

  try {
    const res = await supertest(app)
      .options('/api/vendor-onboarding/stage1/upload-file')
      .set('Origin', 'https://mosaicbizhub.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'https://mosaicbizhub.com');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally {
    cleanup();
  }
});

test('OPTIONS /api/users/login denies www marketplace origin even if configured', async () => {
  const { app, cleanup } = createCorsProbeApp({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://mosaicbizhub.com,https://www.mosaicbizhub.com',
  });

  try {
    const res = await supertest(app)
      .options('/api/users/login')
      .set('Origin', 'https://www.mosaicbizhub.com')
      .set('Access-Control-Request-Method', 'POST');

    assert.notEqual(res.status, 500);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    cleanup();
  }
});
