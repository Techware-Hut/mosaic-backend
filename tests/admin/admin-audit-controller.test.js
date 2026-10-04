const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const controllerPath = path.resolve(
  __dirname,
  '../../controllers/admin/adminAudit.controller.js'
);

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

function loadControllerWithAuditModel(model) {
  const originalLoad = Module._load;
  try {
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request.endsWith('models/AdminAuditEvent')) return model;
      return originalLoad(request, parent, isMain);
    };
    delete require.cache[controllerPath];
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

test('listAdminAuditEvents rejects unauthenticated access via route guards in integration', () => {
  const routesSource = require('fs').readFileSync(
    path.resolve(__dirname, '../../routes/admin/adminAuditRoutes.js'),
    'utf8'
  );
  assert.match(routesSource, /router\.use\(authenticate, isAdmin\)/);
});

test('listAdminAuditEvents returns paginated audit events for admin handler', async () => {
  const events = [
    {
      eventId: 'evt-1',
      actionCode: 'user.block',
      targetType: 'user',
      targetId: '507f1f77bcf86cd799439099',
      outcome: 'success',
    },
  ];

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/AdminAuditEvent')) {
      return {
        find: () => ({
          sort: () => ({
            skip: () => ({
              limit: () => ({
                select: () => ({
                  lean: async () => events,
                }),
              }),
            }),
          }),
        }),
        countDocuments: async () => 1,
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[controllerPath];
  const { listAdminAuditEvents } = require(controllerPath);
  Module._load = originalLoad;

  const res = mockResponse();
  await listAdminAuditEvents({ query: { page: 1, limit: 10 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].eventId, 'evt-1');
});

test('listAdminAuditEvents redacts retirement mapping without changing other events or stored data', async () => {
  const orderId = '507f1f77bcf86cd799439011';
  const priorPaymentId = 'pi_PRIVATE_SENTINEL_LIST';
  const retirementEvent = {
    eventId: 'evt-retirement',
    actionCode: 'release_terminal_payment_reference_retirement',
    targetType: 'Order',
    targetId: orderId,
    changeSummary: {
      priorPaymentId,
      classification: 'A1',
      priorPaymentStatus: 'refunded',
      futureSensitiveField: { reference: 'pi_FUTURE_SENTINEL' },
    },
  };
  const normalEvent = {
    eventId: 'evt-normal',
    actionCode: 'user.block',
    targetId: '507f1f77bcf86cd799439012',
    changeSummary: { priorPaymentId: 'pi_NORMAL_EVENT' },
  };
  const events = [retirementEvent, normalEvent];
  const { listAdminAuditEvents } = loadControllerWithAuditModel({
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            select: () => ({ lean: async () => events }),
          }),
        }),
      }),
    }),
    countDocuments: async () => events.length,
  });

  const res = mockResponse();
  await listAdminAuditEvents({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].targetId, '[REDACTED]');
  assert.equal(res.body.data[0].changeSummary.priorPaymentId, '[REDACTED]');
  assert.equal(res.body.data[0].changeSummary.classification, 'A1');
  assert.equal(res.body.data[0].changeSummary.priorPaymentStatus, 'refunded');
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(`${orderId}|${priorPaymentId}`));
  assert.doesNotMatch(JSON.stringify(res.body), /pi_FUTURE_SENTINEL/);
  assert.deepEqual(res.body.data[1], normalEvent);
  assert.equal(retirementEvent.targetId, orderId);
  assert.equal(retirementEvent.changeSummary.priorPaymentId, priorPaymentId);
});

test('getAdminAuditEventByEventId redacts retirement mapping in detail response', async () => {
  const orderId = '507f1f77bcf86cd799439013';
  const priorPaymentId = 'pi_PRIVATE_SENTINEL_DETAIL';
  const event = {
    eventId: 'evt-retirement-detail',
    actionCode: 'release_terminal_payment_reference_retirement',
    targetType: 'Order',
    targetId: orderId,
    changeSummary: {
      priorPaymentId,
      classification: 'B',
      stripeTerminalStatus: 'canceled',
    },
  };
  const { getAdminAuditEventByEventId } = loadControllerWithAuditModel({
    findOne: () => ({ select: () => ({ lean: async () => event }) }),
  });

  const res = mockResponse();
  await getAdminAuditEventByEventId({ params: { eventId: event.eventId } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.targetId, '[REDACTED]');
  assert.equal(res.body.data.changeSummary.priorPaymentId, '[REDACTED]');
  assert.equal(res.body.data.changeSummary.classification, 'B');
  assert.equal(res.body.data.changeSummary.stripeTerminalStatus, 'canceled');
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(`${orderId}|${priorPaymentId}`));
  assert.equal(event.targetId, orderId);
  assert.equal(event.changeSummary.priorPaymentId, priorPaymentId);
});
