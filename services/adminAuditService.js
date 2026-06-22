const crypto = require('crypto');
const AdminAuditEvent = require('../models/AdminAuditEvent');
const { buildChangeSummary, sanitizeNote } = require('../utils/audit/redaction');

function getRequestIdFromRequest(req) {
  if (!req) return null;

  const headerId = req.headers?.['x-request-id'];
  if (typeof headerId === 'string' && headerId.trim()) {
    return headerId.trim().slice(0, 128);
  }

  if (typeof req.requestId === 'string' && req.requestId.trim()) {
    return req.requestId.trim().slice(0, 128);
  }

  return null;
}

function getActorFromRequest(req) {
  const actorUserId = req?.user?._id || req?.user?.id || null;
  const actorRole = req?.user?.role || 'unknown';

  return { actorUserId, actorRole };
}

/**
 * Persist an immutable admin audit event.
 * Returns { recorded: true, event } on success.
 * On storage failure, logs an operational alert and returns { recorded: false, error }.
 * Does not throw — primary admin actions must not fail because audit storage failed.
 */
async function recordAdminAuditEvent(req, payload) {
  const {
    actionCode,
    targetType,
    targetId,
    outcome,
    changeSummary = null,
    note = null,
    requestId = undefined,
  } = payload;

  const { actorUserId, actorRole } = getActorFromRequest(req);

  if (!actorUserId) {
    console.error('[admin-audit] missing actorUserId — audit event skipped', {
      actionCode,
      targetType,
      targetId,
      outcome,
    });
    return { recorded: false, error: new Error('Missing actor user') };
  }

  if (!actionCode || !targetType || !targetId || !outcome) {
    console.error('[admin-audit] invalid payload — audit event skipped', payload);
    return { recorded: false, error: new Error('Invalid audit payload') };
  }

  const eventDoc = {
    eventId: crypto.randomUUID(),
    actorUserId,
    actorRole,
    actionCode,
    targetType,
    targetId: String(targetId),
    changeSummary,
    requestId: requestId === undefined ? getRequestIdFromRequest(req) : requestId,
    outcome,
    note: sanitizeNote(note),
  };

  try {
    const event = await AdminAuditEvent.create(eventDoc);
    return { recorded: true, event };
  } catch (error) {
    console.error('[admin-audit] storage failure — primary action preserved', {
      actionCode,
      targetType,
      targetId,
      outcome,
      requestId: eventDoc.requestId,
      message: error.message,
    });

    try {
      const Sentry = require('../instrument');
      if (Sentry?.isSentryEnabled?.()) {
        Sentry.captureMessage('Admin audit storage failure', {
          level: 'error',
          tags: {
            action_code: actionCode,
            target_type: targetType,
            outcome,
          },
          extra: {
            targetId: String(targetId),
            requestId: eventDoc.requestId,
          },
        });
      }
    } catch (_sentryError) {
      // ignore Sentry failures
    }

    return { recorded: false, error };
  }
}

async function recordAdminAuditSuccess(req, payload) {
  return recordAdminAuditEvent(req, { ...payload, outcome: 'success' });
}

async function recordAdminAuditFailure(req, payload) {
  return recordAdminAuditEvent(req, { ...payload, outcome: 'failure' });
}

function buildFieldChangeSummary(before, after, fields) {
  return buildChangeSummary({ before, after, fields });
}

module.exports = {
  getRequestIdFromRequest,
  getActorFromRequest,
  recordAdminAuditEvent,
  recordAdminAuditSuccess,
  recordAdminAuditFailure,
  buildFieldChangeSummary,
};
