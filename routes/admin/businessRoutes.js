// routes/businessRoutes.js
const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const isAdmin = require("../../middlewares/isAdmin");
const businessController = require("../../controllers/admin/business.Controller");

// Route to get all businesses, protected by authentication and admin check
router.get("/", authenticate, isAdmin, businessController.getAllBusinesses);

router.post(
  "/approve/:id", 
  authenticate, 
  isAdmin, 
  businessController.toggleBusinessStatus
);

router.patch(
  "/status/:id",
  authenticate,
  isAdmin,
  businessController.patchBusinessActivationStatus
);

router.put(
  "/:id/tags",
  authenticate,
  isAdmin,
  businessController.updateBusinessTags
);

router.patch(
  "/:id/featured",
  authenticate,
  isAdmin,
  businessController.updateBusinessFeatured
);

router.put(
  "/:id",
  authenticate,
  isAdmin,
  businessController.updateBusinessProfile
);

module.exports = router;
