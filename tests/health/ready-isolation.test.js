const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const healthRoutesPath = path.resolve(__dirname, '../../routes/healthRoutes.js');
const ENV_KEYS = ['RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'AWS_S3_BUCKET'];

function withEnv(values, fn) {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function loadHealthRouter(mongooseMock) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'mongoose') return mongooseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[healthRoutesPath];
  try {
    return require(healthRoutesPath);
  } finally {
    Module._load = originalLoad;
  }
}

function call(router, routePath) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === routePath && entry.route.methods.get);
  assert.ok(layer, `missing GET ${routePath}`);
  const res = mockResponse();
  layer.route.stack[layer.route.stack.length - 1].handle({}, res);
  return res;
}

const mongooseMock = { connection: { readyState: 1, name: 'mosaic_staging' } };

test('production /ready, /health and /build-info keep their exact top-level shape', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'production', AWS_S3_BUCKET: 'prod-bucket' }, () => {
    const router = loadHealthRouter(mongooseMock);
    const ready = call(router, '/ready');
    assert.deepEqual(Object.keys(ready.body), ['status', 'database', 'authEmail', 'timestamp', 'release']);
    assert.deepEqual(Object.keys(ready.body.authEmail), ['configured']);
    assert.ok(!JSON.stringify(ready.body).includes('mosaic_staging'));
    assert.ok(!JSON.stringify(ready.body).includes('prod-bucket'));
    assert.deepEqual(Object.keys(call(router, '/health').body), ['status', 'service', 'timestamp', 'uptime', 'release']);
    assert.deepEqual(Object.keys(call(router, '/build-info').body), ['service', 'timestamp', 'release']);
  }));

test('/ready without any environment marker omits isolation', () =>
  withEnv({}, () => {
    const router = loadHealthRouter(mongooseMock);
    assert.equal('isolation' in call(router, '/ready').body, false);
  }));

test('staging /ready adds the isolation self-check; /health and /build-info unchanged', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', AWS_S3_BUCKET: 'mosaic-staging-uploads' }, () => {
    const router = loadHealthRouter(mongooseMock);
    const ready = call(router, '/ready');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(Object.keys(ready.body), ['status', 'database', 'authEmail', 'timestamp', 'release', 'isolation']);
    assert.equal(ready.body.isolation.stagingMarker, true);
    assert.equal(ready.body.isolation.database.name, 'mosaic_staging');
    assert.equal(ready.body.isolation.storage.bucketConfigured, true);
    assert.ok(!JSON.stringify(ready.body).includes('mosaic-staging-uploads'));
    assert.equal(typeof ready.body.isolation.jobs.onboardingReminders, 'boolean');
    assert.equal('isolation' in call(router, '/health').body, false);
    assert.equal('isolation' in call(router, '/build-info').body, false);
  }));
