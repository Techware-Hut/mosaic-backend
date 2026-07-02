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
      mod.parseCorsOrigins(' https://a.com , https://b.com , , *, https://www.mosaicbizhub.com, '),
      ['https://a.com', 'https://b.com']
    );
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins merges CORS_ORIGINS with approved launch origins when set', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://custom-preview.example,https://mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://custom-preview.example'));
    assert.ok(origins.includes('https://mosaicbizhub.com'));
    assert.ok(!origins.includes('https://www.mosaicbizhub.com'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch.vercel.app'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch-digital-builders.vercel.app'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app'));
    assert.ok(origins.includes('https://app.mosaicbizhub.com'));
    assert.equal(origins.length, mod.DEFAULT_CREDENTIAL_ORIGINS.length + 1);
  } finally {
    cleanup();
  }
});

test('isAllowedCredentialOrigin allows same-project Vercel preview origins', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://mosaicbizhub.com',
  });
  try {
    assert.equal(
      mod.isAllowedCredentialOrigin(
        'https://mosaic-biz-frontend-launch-git-feature-digital-builders.vercel.app',
        mod.getAllowedOrigins()
      ),
      true
    );
    assert.equal(
      mod.isAllowedCredentialOrigin(
        'https://not-mosaic-biz-frontend-launch-git-feature.vercel.app',
        mod.getAllowedOrigins()
      ),
      false
    );
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins dedupes CORS_ORIGINS entries', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://mosaicbizhub.com,https://mosaicbizhub.com,*',
  });
  try {
    assert.deepEqual(mod.getAllowedOrigins(), mod.DEFAULT_CREDENTIAL_ORIGINS);
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins falls back to FRONTEND_URL and credentialed production origins when CORS_ORIGINS unset', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://mosaicbizhub.com'));
    assert.ok(!origins.includes('https://www.mosaicbizhub.com'));
    assert.ok(origins.includes('https://app.mosaicbizhub.com'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch.vercel.app'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch-digital-builders.vercel.app'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app'));
    assert.ok(origins.includes('https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app'));
    for (const origin of mod.DEFAULT_CREDENTIAL_ORIGINS) {
      assert.ok(origins.includes(origin));
    }
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins filters disallowed credential origins from explicit env config', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://www.mosaicbizhub.com,https://api.mosaicbizhub.com,https://mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://mosaicbizhub.com'));
    assert.ok(!origins.includes('https://www.mosaicbizhub.com'));
    assert.ok(!origins.includes('https://api.mosaicbizhub.com'));
  } finally {
    cleanup();
  }
});

test('getAllowedOrigins appends dev origins only outside production', () => {
  const { mod, cleanup } = loadCorsOrigins({
    NODE_ENV: 'development',
    CORS_ORIGINS: 'https://mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(origins.includes('https://mosaicbizhub.com'));
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
    CORS_ORIGINS: 'https://mosaicbizhub.com',
  });
  try {
    const origins = mod.getAllowedOrigins();
    assert.ok(!origins.includes('http://localhost:3000'));
    assert.ok(!origins.includes('exp://192.168.0.104:8081'));
  } finally {
    cleanup();
  }
});
