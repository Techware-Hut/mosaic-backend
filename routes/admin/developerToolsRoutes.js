const express = require('express');
const router = express.Router();

const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');
const developerTools = require('../../controllers/admin/developerTools.controller');

router.use(authenticate, isAdmin);

// GET /api/admin/developer/businesses
router.get('/businesses', developerTools.listDeveloperBusinesses);

// POST /api/admin/developer/businesses/bulk-status
router.post('/businesses/bulk-status', developerTools.bulkUpdateDeveloperBusinessStatus);

// POST /api/admin/developer/businesses/bulk-delete
router.post('/businesses/bulk-delete', developerTools.bulkDeleteDeveloperBusinesses);

// PATCH /api/admin/developer/business/:id/status
router.patch('/business/:id/status', developerTools.toggleDeveloperBusinessStatus);

// DELETE /api/admin/developer/business/:id
router.delete('/business/:id', developerTools.deleteDeveloperBusiness);

// POST /api/admin/developer/cleanup  (dryRun default true)
router.post('/cleanup', developerTools.cleanupDeveloperBusinesses);

module.exports = router;
