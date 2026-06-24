const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const corsOriginsPath = path.resolve(__dirname, '../../utils/corsOrigins.js');
const ENV_KEYS = ['CORS_ORIGINS', 'FRONTEND_URL', 'NODE_ENV'];

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

function loadCorsOrigins(envOverrides = {}) {
  const saved = snapshotEnv();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, envOverrides);
  delete require.cache[corsOriginsPath];
  return {
    mod: require(corsOriginsPath),
    cleanup: () => restoreEnv(saved),
  };
}

test.afterEach(() => {
  delete require.cache[corsOriginsPath];
});

test('parseCorsOrigins trims and filters empty entries', () => {
  const { mod, cleanup } = loadCorsOrigins();
  try {
    assert.deepEqual(
      mod.parseCorsOrigins(' https://a.com , https://b.com , , '),
      ['https://a.com', 'https://b.com']
    );
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins uses CORS_ORIGINS when set', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://mosaic-biz-frontend-launch.vercel.app,https://app.mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch.vercel.app'));
    assert.ok(origins.includes('https://app.mosaicbizhub.com'));
    assert.ok(!origins.includes('https://mosaicbizhub.com'));
    assert.ok(!origins.includes('https://www.mosaicbizhub.com'));
    assert.equal(origins.length, 2);
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins dedupes CORS_ORIGINS entries', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.mosaicbizhub.com,https://app.mosaicbizhub.com',
  });
  try {
    assert.deepEqual(mod.getAllowedOrigins(), ['https://app.mosaicbizhub.com']);
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins falls back to FRONTEND_URL and credentialed app origins when CORS_ORIGINS unset', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://app.mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://app.mosaicbizhub.com'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch.vercel.app'));
    assert.ok(!origins.includes('https://mosaicbizhub.com'));
    assert.ok(!origins.includes('https://www.mosaicbizhub.com'));
    for (const origin of mod.DEFAULT_CREDENTIAL_ORIGINS) {
      assert.ok(origins.includes(origin));
    }
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins appends dev origins only outside production', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'development',
    CORS_ORIGINS: 'https://app.mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://app.mosaicbizhub.com'));
    assert.ok(origins.includes('http://localhost:3000'));
    for (const dev of mod.DEV_ORIGINS) {
      assert.ok(origins.includes(dev));
    }
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins excludes dev origins in production', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(!origins.includes('http://localhost:3000'));
    assert.ok(!origins.includes('exp://192.168.0.104:8081'));
  } finally {
    cleanup();
  }
});
