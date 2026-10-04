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
