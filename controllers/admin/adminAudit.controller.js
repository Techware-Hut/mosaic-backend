const AdminAuditEvent = require('../../models/AdminAuditEvent');

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
      data: events,
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
      data: event,
    });
  } catch (error) {
    console.error('getAdminAuditEventByEventId error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit event',
    });
  }
};
