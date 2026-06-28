const test = require('node:test');
const assert = require('node:assert/strict');
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

function loadBookingController({ bookings = [] } = {}) {
  const originalLoad = Module._load;
  const calls = {
    find: [],
    populate: [],
    sort: [],
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/Booking')) {
      return {
        find(query) {
          calls.find.push(query);
          return {
            populate(field, select) {
              calls.populate.push({ field, select });
              return this;
            },
            async sort(sortBy) {
              calls.sort.push(sortBy);
              return bookings;
            },
          };
        },
      };
    }

    if (
      request.endsWith('models/Service') ||
      request.endsWith('models/Food') ||
      request.endsWith('models/Business') ||
      request.endsWith('models/User')
    ) {
      return {};
    }

    if (request.endsWith('utils/bookingMailer')) {
      return {
        sendVendorNewServiceBookingEmail: async () => {},
        sendCustomerNewServiceBookingConfirmationEmail: async () => {},
        sendCustomerServicePaymentRequestEmail: async () => {},
        sendCustomerServiceBookingDecisionEmail: async () => {},
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;

  return { controller, calls };
}

test('getVendorBookings requires a businessId filter', async () => {
  const { controller, calls } = loadBookingController();
  const res = mockResponse();

  await controller.getVendorBookings({ user: { id: 'vendor-1' }, query: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'businessId is required');
  assert.deepEqual(calls.find, []);
});

test('getVendorBookings scopes results to the authenticated vendor and business', async () => {
  const { controller, calls } = loadBookingController({
    bookings: [{ _id: 'booking-1' }],
  });
  const res = mockResponse();

  await controller.getVendorBookings(
    {
      user: { _id: 'vendor-1' },
      query: {
        businessId: 'business-1',
        status: 'pending_vendor_action',
        bookingType: 'service',
      },
    },
    res
  );

  assert.equal(res.statusCode, null);
  assert.deepEqual(calls.find, [
    {
      businessId: 'business-1',
      ownerId: 'vendor-1',
      status: 'pending_vendor_action',
      bookingType: 'service',
    },
  ]);
  assert.deepEqual(calls.populate, [{ field: 'customerId', select: 'name email' }]);
  assert.deepEqual(calls.sort, [{ createdAt: -1 }]);
  assert.deepEqual(res.body, { success: true, bookings: [{ _id: 'booking-1' }] });
});

test('vendor booking shortcuts force the expected booking type while preserving ownership scope', async () => {
  const { controller, calls } = loadBookingController();
  const serviceRes = mockResponse();
  const foodRes = mockResponse();

  await controller.getVendorServiceBookings(
    { user: { id: 'vendor-2' }, query: { businessId: 'business-2' } },
    serviceRes
  );

  await controller.getVendorFoodBookings(
    { user: { id: 'vendor-3' }, query: { businessId: 'business-3' } },
    foodRes
  );

  assert.equal(serviceRes.statusCode, null);
  assert.equal(foodRes.statusCode, null);
  assert.deepEqual(calls.find, [
    {
      businessId: 'business-2',
      ownerId: 'vendor-2',
      bookingType: 'service',
    },
    {
      businessId: 'business-3',
      ownerId: 'vendor-3',
      bookingType: 'food',
    },
  ]);
});
