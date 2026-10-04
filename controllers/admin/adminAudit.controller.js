const AdminAuditEvent = require('../../models/AdminAuditEvent');

const RETIREMENT_ACTION = 'release_terminal_payment_reference_retirement';
const REDACTED = '[REDACTED]';

function redactRetirementEvent(event) {
  if (event.actionCode !== RETIREMENT_ACTION) return event;

  // An allowlist keeps future audit fields from accidentally exposing the
  // restricted order-to-payment mapping through this normal admin API.
  const source = event.changeSummary;
  const changeSummary = { priorPaymentId: REDACTED };
  for (const field of [
    'classification', 'priorPaymentStatus', 'priorOrderStatus',
    'stripeTerminalStatus', 'reason', 'reconciledAt',
  ]) {
    if (source && typeof source[field] === 'string') changeSummary[field] = source[field];
  }
  return {
    ...event,
    targetId: REDACTED,
    changeSummary,
  };
}

exports.listAdminAuditEvents = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.actionCode) filter.actionCode = String(req.query.actionCode).trim();
    if (req.query.targetType) filter.targetType = String(req.query.targetType).trim();
    if (req.query.targetId) filter.targetId = String(req.query.targetId).trim();
    if (req.query.requestId) filter.requestId = String(req.query.requestId).trim();
    if (req.query.outcome === 'success' || req.query.outcome === 'failure') {
      filter.outcome = req.query.outcome;
    }

    const [events, total] = await Promise.all([
      AdminAuditEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'eventId createdAt actorUserId actorRole actionCode targetType targetId changeSummary requestId outcome note'
        )
        .lean(),
      AdminAuditEvent.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: events.map(redactRetirementEvent),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('listAdminAuditEvents error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin audit events',
    });
  }
};

exports.getAdminAuditEventByEventId = async (req, res) => {
  try {
    const event = await AdminAuditEvent.findOne({ eventId: req.params.eventId })
      .select(
        'eventId createdAt actorUserId actorRole actionCode targetType targetId changeSummary requestId outcome note'
      )
      .lean();

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Audit event not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: redactRetirementEvent(event),
    });
  } catch (error) {
    console.error('getAdminAuditEventByEventId error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit event',
    });
  }
};
