const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const Module = require('node:module');
const path = require('node:path');

const routePath = path.resolve(__dirname, '../../routes/googlePlace.js');

function loadRouteWithAxios(post) {
  const originalLoad = Module._load;

  try {
    Module._load = function mockLoad(requestPath, parent, isMain) {
      if (requestPath === 'axios') {
        return { default: { post } };
      }

      return originalLoad.call(this, requestPath, parent, isMain);
    };

    delete require.cache[routePath];
    return require(routePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/google-places', router);
  return app;
}

test('Google Places proxy rejects blank input before provider call', async () => {
  const router = loadRouteWithAxios(async () => {
    throw new Error('axios should not be called');
  });
  const app = createApp(router);

  const res = await request(app)
    .post('/api/google-places')
    .send({ input: '   ' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Input is required');
});

test('Google Places proxy returns 503 when API key is missing', async () => {
  const previousKey = process.env.GOOGLE_GEOCODING_API_KEY;
  delete process.env.GOOGLE_GEOCODING_API_KEY;
  let called = false;
  const router = loadRouteWithAxios(async () => {
    called = true;
    return { data: {} };
  });
  const app = createApp(router);

  try {
    const res = await request(app)
      .post('/api/google-places')
      .send({ input: '123 Main Street' });

    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Google Places is not configured');
    assert.equal(called, false);
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY;
    else process.env.GOOGLE_GEOCODING_API_KEY = previousKey;
  }
});

test('Google Places proxy trims input and forwards caller session token', async () => {
  const previousKey = process.env.GOOGLE_GEOCODING_API_KEY;
  process.env.GOOGLE_GEOCODING_API_KEY = 'places-test-key';
  let capturedBody = null;
  let capturedHeaders = null;
  const router = loadRouteWithAxios(async (_url, body, options) => {
    capturedBody = body;
    capturedHeaders = options.headers;
    return { data: { suggestions: [] } };
  });
  const app = createApp(router);

  try {
    const res = await request(app)
      .post('/api/google-places')
      .send({ input: '  123 Main Street  ', sessionToken: 'session_123456' });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { suggestions: [] });
    assert.equal(capturedBody.input, '123 Main Street');
    assert.equal(capturedBody.sessionToken, 'session_123456');
    assert.equal(capturedHeaders['X-Goog-Api-Key'], 'places-test-key');
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY;
    else process.env.GOOGLE_GEOCODING_API_KEY = previousKey;
  }
});

test('Google Places proxy generates a non-demo session token when caller token is absent', async () => {
  const previousKey = process.env.GOOGLE_GEOCODING_API_KEY;
  process.env.GOOGLE_GEOCODING_API_KEY = 'places-test-key';
  let capturedBody = null;
  const router = loadRouteWithAxios(async (_url, body) => {
    capturedBody = body;
    return { data: { suggestions: [] } };
  });
  const app = createApp(router);

  try {
    const res = await request(app)
      .post('/api/google-places')
      .send({ input: '123 Main Street' });

    assert.equal(res.status, 200);
    assert.notEqual(capturedBody.sessionToken, 'some-session-token');
    assert.match(capturedBody.sessionToken, /^[0-9a-f-]{36}$/);
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_GEOCODING_API_KEY;
    else process.env.GOOGLE_GEOCODING_API_KEY = previousKey;
  }
});
