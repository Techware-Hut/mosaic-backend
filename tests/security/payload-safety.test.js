const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.resolve(__dirname, '../../app.js');
const userRoutesPath = path.resolve(__dirname, '../../routes/userRoutes.js');
const authRoutesPath = path.resolve(__dirname, '../../routes/authRoutes.js');
const paymentRoutesPath = path.resolve(__dirname, '../../routes/paymentRoutes.js');

test('app.js registers Stripe webhooks before JSON parser with raw body', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  const webhookIndex = source.indexOf("express.raw({ type: 'application/json' })");
  const jsonIndex = source.indexOf("express.json({ limit: '1mb' })");

  assert.ok(webhookIndex > -1, 'expected raw webhook body parser');
  assert.ok(jsonIndex > -1, 'expected JSON body limit');
  assert.ok(webhookIndex < jsonIndex, 'webhooks must mount before express.json');
});

test('app.js applies mongo sanitize and XSS clean to body and params', () => {
  const source = fs.readFileSync(appPath, 'utf8');

  assert.match(source, /mongoSanitize/);
  assert.match(source, /xssClean/);
  assert.match(source, /req\.body = xssClean\(req\.body\)/);
  assert.match(source, /req\.params = xssClean\(req\.params\)/);
  assert.ok(!source.includes('req.query = xssClean'), 'query must stay read-only on Express 5');
});

test('auth and payment routes declare rate limiters on sensitive POST endpoints', () => {
  const userSource = fs.readFileSync(userRoutesPath, 'utf8');
  const authSource = fs.readFileSync(authRoutesPath, 'utf8');
  const paymentSource = fs.readFileSync(paymentRoutesPath, 'utf8');

  assert.match(userSource, /registerLimiter/);
  assert.match(userSource, /loginLimiter/);
  assert.match(userSource, /forgotPasswordLimiter/);
  assert.match(authSource, /googleStartLimiter/);
  assert.match(paymentSource, /paymentLimiter/);
});
