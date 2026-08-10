const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(__dirname, '../../controllers/bookingController.js');

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

function loadCreateServiceBooking({ vendorRecipients = ['vendor@example.com'] } = {}) {
  const mailCalls = {
    vendor: [],
    customer: [],
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Booking')) {
      return {
        create: async (doc) => ({
          ...doc,
          _id: '507f1f77bcf86cd799439099',
        }),
      };
    }
    if (request.endsWith('models/Service')) {
      return {
        findById: async () => ({
          _id: '507f1f77bcf86cd799439010',
          title: 'Salon Cut',
          businessId: '507f1f77bcf86cd799439011',
          ownerId: '507f1f77bcf86cd799439012',
        }),
      };
    }
    if (request.endsWith('models/Business')) {
      return {
        findById: () => ({
          select: async () => ({
            businessName: 'Salon Co',
            email: 'shop@example.com',
            slug: 'salon-co',
          }),
        }),
      };
    }
    if (request.endsWith('models/User')) {
      return {
        findById: () => ({
          select: async () => ({
            name: 'Vendor Owner',
            email: 'owner@example.com',
          }),
        }),
      };
    }
    if (request.endsWith('models/Food')) {
      return {};
    }
    if (request.endsWith('utils/bookingMailer')) {
      return {
        sendVendorNewServiceBookingEmail: async (payload) => {
          mailCalls.vendor.push(payload);
        },
        sendVendorNewFoodBookingEmail: async () => {},
        sendCustomerNewServiceBookingConfirmationEmail: async (payload) => {
          mailCalls.customer.push(payload);
        },
        sendCustomerServicePaymentRequestEmail: async () => {},
        sendCustomerServiceBookingDecisionEmail: async () => {},
      };
    }
    if (request.endsWith('utils/notificationPreferenceGate')) {
      return {
        resolveVendorBookingNotificationRecipients: async () => vendorRecipients,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, mailCalls };
}

test('createServiceBooking emails vendor and customer on successful submit', async () => {
  const { controller, mailCalls } = loadCreateServiceBooking();
  const res = mockResponse();

  await controller.createServiceBooking(
    {
      user: { id: '507f1f77bcf86cd799439013' },
      params: { serviceId: '507f1f77bcf86cd799439010' },
      body: {
        name: 'Casey Customer',
        email: 'customer@example.com',
        phone: '555-0100',
        services: ['Haircut'],
        date: '2026-08-20',
        slot: '10:00 AM',
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(mailCalls.vendor.length, 1);
  assert.deepEqual(mailCalls.vendor[0].to, ['vendor@example.com']);
  assert.equal(mailCalls.customer.length, 1);
  assert.equal(mailCalls.customer[0].to, 'customer@example.com');
});

test('createServiceBooking still confirms customer when vendor recipients are empty', async () => {
  const { controller, mailCalls } = loadCreateServiceBooking({ vendorRecipients: [] });
  const res = mockResponse();

  await controller.createServiceBooking(
    {
      user: { id: '507f1f77bcf86cd799439013' },
      params: { serviceId: '507f1f77bcf86cd799439010' },
      body: {
        name: 'Casey Customer',
        email: 'customer@example.com',
        phone: '555-0100',
        services: ['Haircut'],
        date: '2026-08-20',
        slot: '10:00 AM',
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(mailCalls.vendor.length, 0);
  assert.equal(mailCalls.customer.length, 1);
});

test('booking controller wires customer confirmation mailer on service submit', () => {
  const source = fs.readFileSync(controllerPath, 'utf8');
  assert.ok(source.includes('sendCustomerNewServiceBookingConfirmationEmail'));
  assert.ok(source.includes('resolveVendorBookingNotificationRecipients'));
});
