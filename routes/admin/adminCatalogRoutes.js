const express = require('express');
const authenticate = require('../../middlewares/authenticate');
const isAdmin = require('../../middlewares/isAdmin');
const {
  listCatalog,
  getCatalogItem,
  updateCatalogItem,
  patchCatalogActive,
  deleteCatalogItem,
  auditCatalog,
} = require('../../controllers/admin/adminCatalog.controller');

const router = express.Router();

router.get('/audit', authenticate, isAdmin, auditCatalog);
router.get('/:type/:id', authenticate, isAdmin, getCatalogItem);
router.put('/:type/:id', authenticate, isAdmin, updateCatalogItem);
router.patch('/:type/:id/active', authenticate, isAdmin, patchCatalogActive);
router.delete('/:type/:id', authenticate, isAdmin, deleteCatalogItem);
router.get('/', authenticate, isAdmin, listCatalog);

module.exports = router;
