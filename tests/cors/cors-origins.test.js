const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const corsOriginsPath = path.resolve(__dirname, '../../utils/corsOrigins.js');
const ENV_KEYS = [
  'CORS_ORIGINS', 'FRONTEND_URL', 'NODE_ENV',
  'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'AUTH_SESSION_POLICY',
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

const STAGING_ORIGINS = [
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
];
const EXACT_PREVIEW = 'https://mosaic-biz-frontend-launch-synthetic123-digital-builders.vercel.app';
const OTHER_PREVIEW = 'https://mosaic-biz-frontend-launch-synthetic456-digital-builders.vercel.app';
const STAGING_ENV = { NODE_ENV: 'production', RELEASE_ENVIRONMENT: 'staging' };

test('STG-006 staging denies production apex and unconfigured Preview', () => {
  const { mod, cleanup } = loadCorsOrigins(STAGING_ENV);
  try {
    const origins = mod.getAllowedOrigins();
    assert.equal(origins.includes('https://mosaicbizhub.com'), false);
    assert.equal(mod.isAllowedCredentialOrigin('https://mosaicbizhub.com', origins), false);
    assert.equal(mod.isAllowedCredentialOrigin(OTHER_PREVIEW, origins), false);
  } finally {
    cleanup();
  }
});

for (const markers of [
  { RELEASE_ENVIRONMENT: 'staging' },
  { SENTRY_ENVIRONMENT: 'staging' },
  { RELEASE_ENVIRONMENT: ' STAGING ', SENTRY_ENVIRONMENT: 'staging' },
]) {
  test(`staging markers select exact defaults under NODE_ENV=production: ${JSON.stringify(markers)}`, () => {
    const { mod, cleanup } = loadCorsOrigins({ NODE_ENV: 'production', ...markers });
    try {
      assert.deepEqual(mod.getAllowedOrigins(), STAGING_ORIGINS);
      for (const origin of STAGING_ORIGINS) assert.equal(mod.isAllowedCredentialOrigin(origin), true);
      assert.equal(mod.isAllowedCredentialOrigin('http://localhost:3000'), false);
    } finally {
      cleanup();
    }
  });
}

for (const markers of [
  { RELEASE_ENVIRONMENT: 'production', SENTRY_ENVIRONMENT: 'staging' },
  { RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'production' },
  { RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'development' },
]) {
  test(`contradictory staging markers deny credential origins: ${JSON.stringify(markers)}`, () => {
    const { mod, cleanup } = loadCorsOrigins({ ...STAGING_ENV, ...markers, CORS_ORIGINS: STAGING_ORIGINS[0] });
    try {
      assert.deepEqual(mod.getAllowedOrigins(), []);
      assert.equal(mod.isAllowedCredentialOrigin(STAGING_ORIGINS[0], STAGING_ORIGINS), false);
      assert.equal(mod.isAllowedCredentialOrigin('https://mosaicbizhub.com'), false);
      assert.equal(mod.isAllowedCredentialOrigin(undefined), true);
    } finally {
      cleanup();
    }
  });
}

test('explicit staging selection narrows defaults and enables only the exact configured Preview', () => {
  const { mod, cleanup } = loadCorsOrigins({ ...STAGING_ENV, CORS_ORIGINS: `${STAGING_ORIGINS[1]},${EXACT_PREVIEW}` });
  try {
    assert.deepEqual(mod.getAllowedOrigins(), [STAGING_ORIGINS[1], EXACT_PREVIEW]);
    assert.equal(mod.isAllowedCredentialOrigin(EXACT_PREVIEW), true);
    assert.equal(mod.isAllowedCredentialOrigin(OTHER_PREVIEW), false);
    assert.equal(mod.isAllowedCredentialOrigin(STAGING_ORIGINS[0]), false);
    assert.equal(mod.isAllowedCredentialOrigin(STAGING_ORIGINS[2]), false);
  } finally {
    cleanup();
  }
});

test('staging exact origin tuples normalize case/default HTTPS port and deduplicate', () => {
  const { mod, cleanup } = loadCorsOrigins({
    ...STAGING_ENV, CORS_ORIGINS: ` ${STAGING_ORIGINS[0]},HTTPS://APP.MOSAICBIZHUB.COM:443,${STAGING_ORIGINS[0]}`,
  });
  try {
    assert.deepEqual(mod.getAllowedOrigins(), [STAGING_ORIGINS[0]]);
    assert.equal(mod.isAllowedCredentialOrigin('https://app.mosaicbizhub.com:443'), true);
  } finally {
    cleanup();
  }
});

const UNSAFE_STAGING_ORIGINS = [
  '', '   ', ',', '*', 'null',
  'https://mosaicbizhub.com', 'https://www.mosaicbizhub.com',
  'https://api.mosaicbizhub.com', 'https://api-staging.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-main.vercel.app',
  'https://other-project-synthetic123.vercel.app',
  'https://app.mosaicbizhub.com.evil.test', 'https://app-mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch-synthetic.vercel.app.evil.test',
  'https://*.mosaicbizhub.com', 'https://*.vercel.app',
  'http://app.mosaicbizhub.com', '//app.mosaicbizhub.com',
  'https:app.mosaicbizhub.com', 'https:///app.mosaicbizhub.com',
  'https://user@app.mosaicbizhub.com', 'https://user:pass@app.mosaicbizhub.com',
  'https://app.mosaicbizhub.com:8443', 'https://app.mosaicbizhub.com/',
  'https://app.mosaicbizhub.com/path', 'https://app.mosaicbizhub.com?query',
  'https://app.mosaicbizhub.com#fragment', 'https://app.mosaicbizhub.com.',
  'https://app.mosaicbizhub.com\\evil', 'https://app.mosaicbizhub.com\n',
  'https://%61pp.mosaicbizhub.com', 'https://app.mosaicbizhub.com:0443',
];

for (const origin of UNSAFE_STAGING_ORIGINS) {
  test(`unsafe staging configuration fails closed: ${JSON.stringify(origin)}`, () => {
    const { mod, cleanup } = loadCorsOrigins({ ...STAGING_ENV, CORS_ORIGINS: origin });
    try {
      assert.deepEqual(mod.getAllowedOrigins(), []);
      assert.equal(mod.isAllowedCredentialOrigin(origin, [...STAGING_ORIGINS, origin]), false);
    } finally {
      cleanup();
    }
  });
}

for (const invalid of ['*', 'null', 'https://mosaicbizhub.com', 'https://evil.test', '']) {
  test(`partially invalid staging selection does not silently retain or widen entries: ${JSON.stringify(invalid)}`, () => {
    const { mod, cleanup } = loadCorsOrigins({ ...STAGING_ENV, CORS_ORIGINS: `${STAGING_ORIGINS[0]},${invalid}` });
    try {
      assert.deepEqual(mod.getAllowedOrigins(), []);
      assert.equal(mod.isAllowedCredentialOrigin(STAGING_ORIGINS[0]), false);
    } finally {
      cleanup();
    }
  });
}

test('staging ignores FRONTEND_URL and NODE_ENV development defaults, without activating auth', () => {
  const { mod, cleanup } = loadCorsOrigins({ ...STAGING_ENV, NODE_ENV: 'development', FRONTEND_URL: EXACT_PREVIEW });
  try {
    assert.deepEqual(mod.getAllowedOrigins(), STAGING_ORIGINS);
    assert.equal(mod.isAllowedCredentialOrigin(EXACT_PREVIEW), false);
    assert.equal(mod.isAllowedCredentialOrigin('http://localhost:3000'), false);
    assert.equal(process.env.AUTH_SESSION_POLICY, undefined);
  } finally {
    cleanup();
  }
});

test('absent markers preserve production compatibility even with an auth policy selector', () => {
  const { mod, cleanup } = loadCorsOrigins({ NODE_ENV: 'production', AUTH_SESSION_POLICY: 'staging-v1' });
  try {
    assert.deepEqual(mod.getAllowedOrigins(), mod.DEFAULT_CREDENTIAL_ORIGINS);
    assert.equal(mod.isAllowedCredentialOrigin('https://mosaicbizhub.com'), true);
  } finally {
    cleanup();
  }
});

test('staging distinguishes an absent Origin from the literal null origin', () => {
  const { mod, cleanup } = loadCorsOrigins(STAGING_ENV);
  try {
    assert.equal(mod.isAllowedCredentialOrigin(undefined), true);
    assert.equal(mod.isAllowedCredentialOrigin('null'), false);
  } finally {
    cleanup();
  }
});
