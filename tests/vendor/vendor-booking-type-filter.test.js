/**
 * Acceptance test: Typed vendor booking-list filter fix
 * Branch: fix/vendor-booking-type-filter
 *
 * Defect: GET /api/bookings/vendor/service and /api/bookings/vendor/food were
 * both returning mixed booking types because the typed wrapper functions
 * attempted to mutate req.query.bookingType which Express silently discards
 * (req.query is a getter on IncomingMessage.prototype with no setter).
 *
 * Fix: Internal query helpers accept an explicit forcedBookingType argument
 * instead of mutating req.query.
 *
 * Acceptance criteria (from defect report):
 *   1. /api/bookings/vendor/service returns ONLY service bookings for owner+business.
 *   2. /api/bookings/vendor/food returns ONLY food bookings for owner+business.
 *   3. Generic /api/bookings/vendor still accepts optional bookingType query param.
 *   4. Owner/business isolation: owner A cannot see owner B bookings.
 *   5. Response shape unchanged: { success: true, bookings: [...] }.
 *   6. Server-pinned type overrides caller-supplied ?bookingType on typed route.
 *
 * This test runs over the real Express router (mounted HTTP) so req.query
 * behaves exactly as in production — no mocked plain objects.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const supertest = require('supertest');

// ── Environment ────────────────────────────────────────────────────────────────
const JWT_SECRET = 'test-secret-vendor-filter-2026';
process.env.JWT_SECRET = JWT_SECRET;

// ── Fixtures ───────────────────────────────────────────────────────────────────
const OWNER_A_ID = '000000000000000000000001';
const OWNER_B_ID = '000000000000000000000002';
const BIZ_A_ID   = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BIZ_B_ID   = 'bbbbbbbbbbbbbbbbbbbbbbbb';

// Seeded bookings in our in-memory "DB"
const SEEDED_BOOKINGS = [
  { _id: 's1', bookingType: 'service', businessId: BIZ_A_ID, ownerId: OWNER_A_ID, customerId: 'c1' },
  { _id: 's2', bookingType: 'service', businessId: BIZ_A_ID, ownerId: OWNER_A_ID, customerId: 'c2' },
  { _id: 'f1', bookingType: 'food',    businessId: BIZ_A_ID, ownerId: OWNER_A_ID, customerId: 'c1' },
  // Owner B — must NEVER appear in Owner A responses
  { _id: 's3', bookingType: 'service', businessId: BIZ_B_ID, ownerId: OWNER_B_ID, customerId: 'c3' },
  { _id: 'f2', bookingType: 'food',    businessId: BIZ_B_ID, ownerId: OWNER_B_ID, customerId: 'c4' },
];

// ── Module stub factory ────────────────────────────────────────────────────────
function makeBookingStub() {
  return {
    find(query) {
      const results = SEEDED_BOOKINGS.filter((b) => {
        if (String(b.businessId) !== String(query.businessId)) return false;
        if (String(b.ownerId)    !== String(query.ownerId))    return false;
        if (query.bookingType && b.bookingType !== query.bookingType) return false;
        return true;
      });
      return {
        populate() { return this; },
        sort()     { return Promise.resolve(results); },
      };
    },
  };
}

function makeUserStub() {
  return {
    async findById(id) {
      const users = {
        [OWNER_A_ID]: { _id: OWNER_A_ID, role: 'business_owner', sessionVersion: 0 },
        [OWNER_B_ID]: { _id: OWNER_B_ID, role: 'business_owner', sessionVersion: 0 },
      };
      return users[String(id)] || null;
    },
  };
}

// ── Build a fresh patched Express app ──────────────────────────────────────────
// IMPORTANT: We must clear module cache for controller AND router, then require
// them inside the patch window so our stubs are in effect when they load.
const controllerAbsPath = path.resolve(__dirname, '../../controllers/bookingController.js');
const routerAbsPath     = path.resolve(__dirname, '../../routes/bookingRoutes.js');

function buildPatchedApp() {
  // Clear the cached modules
  delete require.cache[controllerAbsPath];
  delete require.cache[routerAbsPath];

  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Booking'))            return makeBookingStub();
    if (request.endsWith('models/User'))               return makeUserStub();
    if (request.endsWith('models/Service') ||
        request.endsWith('models/Food')    ||
        request.endsWith('models/Business'))           return {};
    if (request.endsWith('utils/bookingMailer'))        return {
      sendVendorNewServiceBookingEmail: async () => {},
      sendVendorNewFoodBookingEmail: async () => {},
      sendCustomerNewServiceBookingConfirmationEmail: async () => {},
      sendCustomerServicePaymentRequestEmail: async () => {},
      sendCustomerServiceBookingDecisionEmail: async () => {},
    };
    if (request.endsWith('utils/notificationPreferenceGate')) return {
      resolveVendorBookingNotificationRecipients: async () => [],
    };
    return originalLoad(request, parent, isMain);
  };

  // Require controller + router inside the patch window
  const bookingRoutes = require(routerAbsPath);

  Module._load = originalLoad; // Restore immediately after

  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
  return app;
}

// ── Token helper ───────────────────────────────────────────────────────────────
function makeToken(userId) {
  return jwt.sign({ userId, sessionVersion: 0 }, JWT_SECRET);
}

// ── Request helper ─────────────────────────────────────────────────────────────
async function get(app, url, token) {
  return supertest(app)
    .get(url)
    .set('Authorization', `Bearer ${token}`)
    .timeout(5000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test('/vendor/service — returns ONLY service bookings', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  const res = await get(app, `/api/bookings/vendor/service?businessId=${BIZ_A_ID}`, token);

  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.bookings));
  assert.ok(res.body.bookings.length > 0, 'Should have at least one service booking');

  for (const b of res.body.bookings) {
    assert.equal(
      b.bookingType, 'service',
      `/vendor/service returned a non-service booking: ${JSON.stringify(b)}`
    );
  }
});

test('/vendor/food — returns ONLY food bookings', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  const res = await get(app, `/api/bookings/vendor/food?businessId=${BIZ_A_ID}`, token);

  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.bookings));
  assert.ok(res.body.bookings.length > 0, 'Should have at least one food booking');

  for (const b of res.body.bookings) {
    assert.equal(
      b.bookingType, 'food',
      `/vendor/food returned a non-food booking: ${JSON.stringify(b)}`
    );
  }
});

test('/vendor — generic endpoint returns ALL booking types', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  const res = await get(app, `/api/bookings/vendor?businessId=${BIZ_A_ID}`, token);

  assert.equal(res.status, 200);
  const types = new Set(res.body.bookings.map((b) => b.bookingType));
  assert.ok(types.has('service'), 'Generic endpoint must include service bookings');
  assert.ok(types.has('food'),    'Generic endpoint must include food bookings');
});

test('/vendor — optional bookingType query param on generic endpoint works', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  const res = await get(app, `/api/bookings/vendor?businessId=${BIZ_A_ID}&bookingType=service`, token);

  assert.equal(res.status, 200);
  for (const b of res.body.bookings) {
    assert.equal(b.bookingType, 'service');
  }
});

test('Server-pinned type overrides caller-supplied ?bookingType on /vendor/service', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  // Caller passes bookingType=food on the /service route — must be ignored
  const res = await get(app, `/api/bookings/vendor/service?businessId=${BIZ_A_ID}&bookingType=food`, token);

  assert.equal(res.status, 200);
  assert.ok(res.body.bookings.length > 0, 'Should still get service bookings');
  for (const b of res.body.bookings) {
    assert.equal(
      b.bookingType, 'service',
      `Server should pin type to "service" even when caller passes ?bookingType=food`
    );
  }
});

test('Foreign-owner isolation: Owner A cannot see Owner B bookings via /vendor/service', async () => {
  const app    = buildPatchedApp();
  const tokenA = makeToken(OWNER_A_ID);

  const res = await get(app, `/api/bookings/vendor/service?businessId=${BIZ_A_ID}`, tokenA);

  assert.equal(res.status, 200);
  const ids = res.body.bookings.map((b) => b._id);
  assert.ok(!ids.includes('s3'), 'Owner B booking s3 must not appear in Owner A response');
  assert.ok(!ids.includes('f2'), 'Owner B booking f2 must not appear in Owner A response');
});

test('Foreign-owner isolation: Owner A swapping to Owner B businessId returns zero bookings', async () => {
  const app    = buildPatchedApp();
  const tokenA = makeToken(OWNER_A_ID);

  // Owner A JWT sets ownerId=OWNER_A; BIZ_B bookings have ownerId=OWNER_B — no match
  const res = await get(app, `/api/bookings/vendor/service?businessId=${BIZ_B_ID}`, tokenA);

  assert.equal(res.status, 200);
  assert.equal(
    res.body.bookings.length, 0,
    'Owner A should receive 0 bookings when supplying Owner B businessId'
  );
});

test('businessId required — /vendor/service returns 400 without businessId', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  const res = await get(app, '/api/bookings/vendor/service', token);

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'businessId is required');
});

test('businessId required — /vendor/food returns 400 without businessId', async () => {
  const app   = buildPatchedApp();
  const token = makeToken(OWNER_A_ID);

  const res = await get(app, '/api/bookings/vendor/food', token);

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'businessId is required');
});

test('Unauthenticated request to /vendor/service returns 401', async () => {
  const app = buildPatchedApp();

  const res = await supertest(app)
    .get(`/api/bookings/vendor/service?businessId=${BIZ_A_ID}`)
    .timeout(5000);

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});
