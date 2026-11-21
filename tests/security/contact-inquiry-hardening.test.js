// Contact form hardening: reCAPTCHA verification, HTML escaping in the admin
// email, no internal error text to clients, and rate limiting. No network:
// Google is a fake fetch; mail and the model are mocked. Synthetic data only.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const request = require('supertest');

const {
  verifyRecaptchaToken,
  requireRecaptcha,
  getAllowedHostnames,
  SITEVERIFY_URL,
} = require('../../utils/recaptcha');

const ENV = {
  RECAPTCHA_SECRET_KEY: 'synthetic-test-secret',
  RECAPTCHA_ALLOWED_HOSTNAMES: 'mosaicbizhub.com,www.mosaicbizhub.com',
};

function fakeGoogle(payload, { status = 200, throws = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw new Error('network down');
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetchImpl, calls };
}

// ---------- verifyRecaptchaToken ----------

test('valid token from an allowed host passes and posts secret + token to siteverify', async () => {
  const google = fakeGoogle({ success: true, hostname: 'mosaicbizhub.com' });
  const result = await verifyRecaptchaToken('tok-123', { env: ENV, fetchImpl: google.fetchImpl, remoteIp: '203.0.113.9' });

  assert.deepEqual(result, { ok: true, hostname: 'mosaicbizhub.com' });
  assert.equal(google.calls.length, 1);
  assert.equal(google.calls[0].url, SITEVERIFY_URL);
  const sent = new URLSearchParams(google.calls[0].init.body);
  assert.equal(sent.get('secret'), ENV.RECAPTCHA_SECRET_KEY);
  assert.equal(sent.get('response'), 'tok-123');
  assert.equal(sent.get('remoteip'), '203.0.113.9');
});

test('missing token is rejected without calling Google', async () => {
  const google = fakeGoogle({ success: true });
  for (const token of [undefined, '', '   ', 42]) {
    const result = await verifyRecaptchaToken(token, { env: ENV, fetchImpl: google.fetchImpl });
    assert.equal(result.reason, 'missing_token');
  }
  assert.equal(google.calls.length, 0);
});

test('token Google rejects is invalid', async () => {
  const google = fakeGoogle({ success: false, 'error-codes': ['invalid-input-response'] });
  const result = await verifyRecaptchaToken('bad', { env: ENV, fetchImpl: google.fetchImpl });
  assert.deepEqual(result, { ok: false, reason: 'invalid_token' });
});

test('valid token solved on another site is rejected (hostname check)', async () => {
  const google = fakeGoogle({ success: true, hostname: 'evil.example' });
  const result = await verifyRecaptchaToken('tok', { env: ENV, fetchImpl: google.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'hostname_mismatch');
});

test('Google unreachable or erroring fails closed', async () => {
  const down = await verifyRecaptchaToken('tok', { env: ENV, fetchImpl: fakeGoogle(null, { throws: true }).fetchImpl });
  assert.deepEqual(down, { ok: false, reason: 'verify_unreachable' });
  const http500 = await verifyRecaptchaToken('tok', { env: ENV, fetchImpl: fakeGoogle({}, { status: 500 }).fetchImpl });
  assert.deepEqual(http500, { ok: false, reason: 'verify_http_error' });
});

test('no secret configured: verification is skipped (safe rollout)', async () => {
  const google = fakeGoogle({ success: false });
  const result = await verifyRecaptchaToken(undefined, { env: {}, fetchImpl: google.fetchImpl });
  assert.deepEqual(result, { ok: true, reason: 'not_configured' });
  assert.equal(google.calls.length, 0);
});

test('allowed hostnames fall back to FRONTEND_URL and CORS_ORIGINS', () => {
  assert.deepEqual(
    getAllowedHostnames({ FRONTEND_URL: 'https://mosaicbizhub.com', CORS_ORIGINS: 'https://www.mosaicbizhub.com, http://localhost:3000' }),
    ['mosaicbizhub.com', 'www.mosaicbizhub.com', 'localhost']
  );
});

// ---------- requireRecaptcha middleware ----------

function guardedApp(env, fetchImpl) {
  const app = express();
  app.use(express.json());
  app.post('/x', requireRecaptcha({ env, fetchImpl }), (req, res) => res.status(201).json({ ok: true }));
  return app;
}

test('middleware: pass / missing / invalid / unavailable / not configured', async () => {
  const ok = guardedApp(ENV, fakeGoogle({ success: true, hostname: 'mosaicbizhub.com' }).fetchImpl);
  assert.equal((await request(ok).post('/x').send({ recaptchaToken: 't' })).status, 201);

  const missing = await request(ok).post('/x').send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'RECAPTCHA_REQUIRED');

  const invalid = await request(guardedApp(ENV, fakeGoogle({ success: false }).fetchImpl)).post('/x').send({ recaptchaToken: 't' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'RECAPTCHA_FAILED');

  const unavailable = await request(guardedApp(ENV, fakeGoogle(null, { throws: true }).fetchImpl)).post('/x').send({ recaptchaToken: 't' });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'RECAPTCHA_UNAVAILABLE');

  const notConfigured = await request(guardedApp({}, fakeGoogle({ success: false }).fetchImpl)).post('/x').send({});
  assert.equal(notConfigured.status, 201);
});

// ---------- controller: escaping + error handling ----------

const controllerPath = path.resolve(__dirname, '../../controllers/contactInquiry.controller.js');

function loadController({ saveError } = {}) {
  const sent = [];
  const originalLoad = Module._load;
  Module._load = function mockLoad(req, parent, isMain) {
    if (req === '../models/ContactInquiry') {
      return function ContactInquiry(doc) {
        Object.assign(this, doc);
        this.save = async () => { if (saveError) throw saveError; };
      };
    }
    if (req === 'nodemailer') {
      return { createTransport: () => ({ sendMail: async (msg) => { sent.push(msg); return { messageId: 'm' }; } }) };
    }
    return originalLoad.call(this, req, parent, isMain);
  };
  delete require.cache[controllerPath];
  try {
    return { controller: require(controllerPath), sent };
  } finally {
    Module._load = originalLoad;
  }
}

function res() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('admin email escapes every form field and keeps the subject on one line', async () => {
  const { controller, sent } = loadController();
  const out = res();
  await controller.createContactInquiry({
    body: {
      firstName: '<b>Jane</b>',
      lastName: '"Doe"',
      email: 'jane@example.test',
      phoneNo: "555'0100",
      subject: 'Hi\r\nBcc: victim@example.test',
      howCanWeHelp: '<script>alert(1)</script><a href="https://phish.example">click</a>',
    },
  }, out);

  assert.equal(out.statusCode, 201);
  assert.equal(sent.length, 1);
  const { html, subject } = sent[0];
  assert.doesNotMatch(html, /<script>|<a href|<b>Jane/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;Jane&lt;\/b&gt;/);
  assert.match(html, /&quot;Doe&quot;/);
  assert.match(html, /555&#39;0100/);
  assert.doesNotMatch(subject, /[\r\n]/);
});

test('save failures never echo internal error text', async () => {
  const internal = new Error('E11000 duplicate key collection: mosaic.contactinquiries index: secret_idx');
  const { controller } = loadController({ saveError: internal });
  const out = res();
  await controller.createContactInquiry({ body: { firstName: 'A' } }, out);
  assert.equal(out.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(out.body), /E11000|secret_idx|mosaic\./);

  const validation = Object.assign(new Error('Path `email` is required.'), { name: 'ValidationError' });
  const { controller: c2 } = loadController({ saveError: validation });
  const out2 = res();
  await c2.createContactInquiry({ body: {} }, out2);
  assert.equal(out2.statusCode, 400);
  assert.equal(out2.body.code, 'CONTACT_INQUIRY_INVALID');
  assert.doesNotMatch(JSON.stringify(out2.body), /Path `email`/);
});

// ---------- route wiring + rate limit ----------

test('contact route runs the rate limiter, then reCAPTCHA, then the handler', () => {
  const router = require('../../routes/contactInquiryRoutes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.post);
  const names = layer.route.stack.map((l) => l.handle.name || l.name);
  assert.deepEqual(names.slice(0, 2), ['contactInquiryLimiter', 'recaptchaGuard']);
  assert.equal(names.length, 3);
});

test('contact limiter allows 5 messages per window, then 429', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production'; // limiters skip under NODE_ENV=test
  try {
    const { buildPublicLimiter } = require('../../middlewares/publicRateLimit');
    const app = express();
    app.post('/c', buildPublicLimiter({ name: 'c', windowMs: 15 * 60 * 1000, max: 5, message: 'Too many messages sent. Please try again later.' }), (req, r) => r.status(201).json({ ok: true }));
    for (let i = 0; i < 5; i += 1) assert.equal((await request(app).post('/c')).status, 201);
    const limited = await request(app).post('/c');
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
  } finally {
    process.env.NODE_ENV = previous;
  }
});
