const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const healthRoutesPath = path.resolve(__dirname, '../../routes/healthRoutes.js');

const originalMailUser = process.env.MAIL_USER;
const originalMailPassword = process.env.MAIL_PASSWORD;

function restoreMailEnv() {
  if (originalMailUser === undefined) {
    delete process.env.MAIL_USER;
  } else {
    process.env.MAIL_USER = originalMailUser;
  }
  if (originalMailPassword === undefined) {
    delete process.env.MAIL_PASSWORD;
  } else {
    process.env.MAIL_PASSWORD = originalMailPassword;
  }
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadHealthRouter(mongooseMock) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'mongoose') return mongooseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[healthRoutesPath];
  const router = require(healthRoutesPath);
  Module._load = originalLoad;
  return router;
}

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === routePath && entry.route.methods[method]
  );
  assert.ok(layer, `missing ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test('GET /health returns ok without database dependency', () => {
  const router = loadHealthRouter({ connection: { readyState: 0 } });
  const handler = getRouteHandler(router, 'get', '/health');
  const res = mockResponse();

  handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.service, 'mosaic-backend');
  assert.ok(typeof res.body.uptime === 'number');
  assert.ok(res.body.timestamp);
});

test('GET /ready returns 200 when database is connected', async () => {
  process.env.MAIL_USER = 'mail@example.com';
  process.env.MAIL_PASSWORD = 'app-password';
  const router = loadHealthRouter({ connection: { readyState: 1 } });
  const handler = getRouteHandler(router, 'get', '/ready');
  const res = mockResponse();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.database, 'connected');
  assert.equal(res.body.authEmail.configured, true);
  restoreMailEnv();
});

test('GET /ready reports authEmail.configured false when SMTP env missing', async () => {
  delete process.env.MAIL_USER;
  delete process.env.MAIL_PASSWORD;
  const router = loadHealthRouter({ connection: { readyState: 1 } });
  const handler = getRouteHandler(router, 'get', '/ready');
  const res = mockResponse();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authEmail.configured, false);
  restoreMailEnv();
});

test('GET /ready returns 503 when database is disconnected', async () => {
  const router = loadHealthRouter({ connection: { readyState: 0 } });
  const handler = getRouteHandler(router, 'get', '/ready');
  const res = mockResponse();

  await handler({}, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, 'not_ready');
  assert.equal(res.body.database, 'disconnected');
  assert.ok(!JSON.stringify(res.body).includes('mongodb'));
});

test('healthRoutes source does not expose secrets', () => {
  const source = fs.readFileSync(healthRoutesPath, 'utf8');
  assert.ok(!source.includes('process.env.MONGODB_URI'));
  assert.ok(!source.includes('JWT_SECRET'));
  assert.ok(!source.includes('MAIL_PASSWORD'));
  assert.ok(!source.includes('MAIL_USER'));
});
