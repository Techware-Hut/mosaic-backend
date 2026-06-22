const express = require('express');
const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');
const {
  listAdminAuditEvents,
  getAdminAuditEventByEventId,
} = require('../../controllers/admin/adminAudit.controller');

const router = express.Router();

router.use(authenticate, isAdmin);

router.get('/', listAdminAuditEvents);
router.get('/:eventId', getAdminAuditEventByEventId);

module.exports = router;
