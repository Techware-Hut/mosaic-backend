const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/bookingController.js');
const routesPath = path.resolve(__dirname, '../../routes/bookingRoutes.js');

const OWNER_ID = '507f1f77bcf86cd799439012';
const OTHER_VENDOR_ID = '507f1f77bcf86cd799439044';

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

function loadController() {
  const created = [];
  const mails = [];
  const smsCalls = [];
  const listing = {
    _id: '507f1f77bcf86cd799439010',
    title: 'Listing',
    businessId: '507f1f77bcf86cd799439011',
    ownerId: OWNER_ID,
  };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Booking')) {
      return {
        create: async (doc) => {
          created.push(doc);
          return { ...doc, _id: '507f1f77bcf86cd799439099' };
        },
      };
    }
    if (request.endsWith('models/Service') || request.endsWith('models/Food')) {
      return { findById: async () => listing };
    }
    if (request.endsWith('models/Business') || request.endsWith('models/User')) {
      return {
        findById: () => ({
          select: async () => ({ businessName: 'Biz', name: 'Owner', email: 'owner@example.com', slug: 'biz' }),
        }),
      };
    }
    if (request.endsWith('utils/bookingMailer')) {
      const record = (kind) => async (payload) => mails.push({ kind, payload });
      return {
        sendVendorNewServiceBookingEmail: record('vendor-service'),
        sendVendorNewFoodBookingEmail: record('vendor-food'),
        sendCustomerNewServiceBookingConfirmationEmail: record('customer-service'),
        sendCustomerNewFoodBookingConfirmationEmail: record('customer-food'),
        sendCustomerServicePaymentRequestEmail: async () => {},
        sendCustomerServiceBookingDecisionEmail: async () => {},
      };
    }
    if (request.endsWith('utils/telnyxService')) {
      const sms = (kind) => async (payload) => smsCalls.push({ kind, payload });
      return {
        sendServiceBookingCreatedCustomerSMS: sms('service-customer'),
        sendServiceBookingAlertVendorSMS: sms('service-vendor'),
        sendServiceBookingApprovedSMS: sms('service-approved'),
        sendServiceBookingRejectedSMS: sms('service-rejected'),
        sendFoodReservationCreatedSMS: sms('food-created'),
      };
    }
    if (request.endsWith('utils/notificationPreferenceGate')) {
      return { resolveVendorBookingNotificationRecipients: async () => ['vendor@example.com'] };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return { controller, created, mails, smsCalls };
}

const serviceBody = {
  name: 'Buyer',
  email: 'buyer@example.com',
  phone: '555-0100',
  services: ['Haircut'],
  date: '2026-12-01',
  slot: '10:00 AM',
};
const foodBody = { ...serviceBody, seats: 'upto 2' };

for (const [kind, handler, params, body] of [
  ['service', 'createServiceBooking', { serviceId: '507f1f77bcf86cd799439010' }, serviceBody],
  ['food', 'createFoodBooking', { foodId: '507f1f77bcf86cd799439010' }, foodBody],
]) {
  test(`${handler} forbids a vendor booking their own ${kind} listing before any write or email`, async () => {
    const { controller, created, mails, smsCalls } = loadController();
    const res = mockResponse();
    await controller[handler]({ user: { id: OWNER_ID, role: 'business_owner' }, params, body }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'SELF_BOOKING_FORBIDDEN');
    assert.equal(created.length, 0);
    assert.equal(mails.length, 0);
    assert.equal(smsCalls.length, 0);
  });

  test(`${handler} lets a vendor account book another business's ${kind} listing`, async () => {
    const { controller, created } = loadController();
    const res = mockResponse();
    await controller[handler]({ user: { id: OTHER_VENDOR_ID, role: 'business_owner' }, params, body }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(created.length, 1);
    assert.equal(String(created[0].customerId), OTHER_VENDOR_ID);
  });
}

test('booking create and buyer listing routes admit checkout buyers (customer or business_owner)', () => {
  const routes = fs.readFileSync(routesPath, 'utf8');
  for (const route of ["'/service'", "'/service/:serviceId'", "'/food'", "'/food/:foodId'"]) {
    assert.ok(routes.includes(`router.post(${route}, authenticate, isCheckoutBuyer,`), route);
  }
  for (const route of ["'/customer'", "'/customer/service'", "'/customer/food'"]) {
    assert.ok(routes.includes(`router.get(${route}, authenticate, isCheckoutBuyer,`), route);
  }
  assert.doesNotMatch(routes, /isCustomer/);
});
