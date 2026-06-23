const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const servicePath = path.resolve(__dirname, '../../services/adminAuditService.js');
const modelPath = path.resolve(__dirname, '../../models/AdminAuditEvent.js');

const ACTOR_ID = '507f1f77bcf86cd799439011';

function mockReq(overrides = {}) {
  return {
    user: { _id: ACTOR_ID, role: 'admin' },
    headers: { 'x-request-id': 'req-test-001' },
    requestId: 'req-generated-001',
    ...overrides,
  };
}

test('recordAdminAuditSuccess creates event with request ID from header', async () => {
  const created = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/AdminAuditEvent')) {
      return {
        create: async (doc) => {
          created.push(doc);
          return { ...doc, _id: 'audit001' };
        },
      };
    }
    if (request.endsWith('instrument')) {
      return { isSentryEnabled: () => false };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[servicePath];
  const { recordAdminAuditSuccess } = require(servicePath);

  const result = await recordAdminAuditSuccess(mockReq(), {
    actionCode: 'user.block',
    targetType: 'user',
    targetId: '507f1f77bcf86cd799439099',
    changeSummary: { fields: ['isBlocked'], before: { isBlocked: false }, after: { isBlocked: true } },
  });

  Module._load = originalLoad;
  delete require.cache[servicePath];

  assert.equal(result.recorded, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].requestId, 'req-test-001');
  assert.equal(created[0].outcome, 'success');
  assert.equal(String(created[0].actorUserId), ACTOR_ID);
});

test('recordAdminAuditFailure stores failure outcome', async () => {
  const created = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/AdminAuditEvent')) {
      return {
        create: async (doc) => {
          created.push(doc);
          return doc;
        },
      };
    }
    if (request.endsWith('instrument')) {
      return { isSentryEnabled: () => false };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[servicePath];
  const { recordAdminAuditFailure } = require(servicePath);

  const result = await recordAdminAuditFailure(mockReq({ headers: {} }), {
    actionCode: 'business.approve',
    targetType: 'business',
    targetId: 'biz001',
    note: 'Onboarding incomplete',
  });

  Module._load = originalLoad;
  delete require.cache[servicePath];

  assert.equal(result.recorded, true);
  assert.equal(created[0].outcome, 'failure');
  assert.equal(created[0].requestId, 'req-generated-001');
});

test('audit storage failure does not throw and returns recorded false', async () => {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('models/AdminAuditEvent')) {
      return {
        create: async () => {
          throw new Error('mongo down');
        },
      };
    }
    if (request.endsWith('instrument')) {
      return { isSentryEnabled: () => false, captureMessage: () => {} };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[servicePath];
  const { recordAdminAuditSuccess } = require(servicePath);

  const result = await recordAdminAuditSuccess(mockReq(), {
    actionCode: 'user.unblock',
    targetType: 'user',
    targetId: 'user001',
  });

  Module._load = originalLoad;
  delete require.cache[servicePath];

  assert.equal(result.recorded, false);
  assert.match(result.error.message, /mongo down/);
});

test('missing actor skips audit without throwing', async () => {
  delete require.cache[servicePath];
  const { recordAdminAuditSuccess } = require(servicePath);

  const result = await recordAdminAuditSuccess({ headers: {} }, {
    actionCode: 'user.block',
    targetType: 'user',
    targetId: 'user001',
  });

  assert.equal(result.recorded, false);
});

test('AdminAuditEvent model declares immutable mutation guards', () => {
  const AdminAuditEvent = require(modelPath);
  const source = require('fs').readFileSync(modelPath, 'utf8');

  assert.match(AdminAuditEvent.IMMUTABLE_ERROR, /immutable/i);
  assert.match(source, /pre\('updateOne', blockMutation\)/);
  assert.match(source, /pre\('deleteOne', blockMutation\)/);
  assert.match(source, /updatedAt:\s*false/);
});
