// controllers/businessController.js
const Business = require("../../models/Business");
const { sendBusinessStatusEmail } = require("../../utils/approvalMail");
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require("../../utils/audit/actionRegistry");
const {
  recordAdminAuditSuccess,
  recordAdminAuditFailure,
  buildFieldChangeSummary,
} = require("../../services/adminAuditService");
const {
  isPublicMarketplaceBusiness,
} = require("../../lib/marketplace/businessEligibility");
const { normalizeBusinessTags } = require("../../lib/admin/businessTags");

const parseBoolean = (value) => {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
};

exports.getAllBusinesses = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // default 10
    const page = parseInt(req.query.page) || 1; // default 1

    const skip = (page - 1) * limit;

    // Fetch paginated businesses
    const filter = {};

    if (req.query.isActive !== undefined) {
      const activeFilter = parseBoolean(req.query.isActive);
      if (activeFilter === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid isActive filter. Use true or false.",
        });
      }
      filter.isActive = activeFilter;
    }

    if (req.query.isApproved !== undefined) {
      const approvedFilter = parseBoolean(req.query.isApproved);
      if (approvedFilter === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid isApproved filter. Use true or false.",
        });
      }
      filter.isApproved = approvedFilter;
    }

    const businesses = await Business.find(filter)
      .populate("owner", "name email mobile")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Total count (for frontend pagination)
    const [totalBusinesses, activeBusinesses, inactiveBusinesses, notApprovedCount] = await Promise.all([
      Business.countDocuments(filter),
      Business.countDocuments({ ...filter, isActive: true }),
      Business.countDocuments({ ...filter, isActive: false }),
      Business.countDocuments({ ...filter, isApproved: false }),
    ]);

    return res.status(200).json({
      success: true,
      data: businesses,
      message: "Businesses retrieved successfully",
      totalBusinesses,
      activeBusinesses,
      inactiveBusinesses,
      notApprovedCount,
      currentPage: page,
      totalPages: Math.ceil(totalBusinesses / limit),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};


exports.toggleBusinessStatus = async (req, res) => {
  try {
    const business = await Business.findById(req.params.id)
      .select("owner businessName slug listingType email isApproved isActive onboardingStatus")
      .populate("owner", "name email");

    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found." });
    }

    const nextIsApproved = true;
    const previousIsApproved = business.isApproved;
    const previousIsActive = business.isActive;

    // ✅ Only allow toggling to APPROVED if onboardingStatus === 'completed'
    if (nextIsApproved) {
      const onboarding = String(business.onboardingStatus || "").toLowerCase();
      if (onboarding !== "completed") {
        await recordAdminAuditFailure(req, {
          actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_APPROVE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
          targetId: business._id,
          note: "Cannot approve this business until onboarding is completed.",
          changeSummary: buildFieldChangeSummary(
            {},
            { onboardingStatus: business.onboardingStatus || null },
            ["onboardingStatus"]
          ),
        });
        return res.status(400).json({
          success: false,
          message: "Cannot approve this business until onboarding is completed.",
          data: { onboardingStatus: business.onboardingStatus || null },
        });
      }
    }

    // Toggle approval + active
    business.isApproved = nextIsApproved;
    business.isActive = nextIsApproved ? true : false;

    await business.save();

    const statusText = "approved and activated";

    // ---- Email to both owner and business email (deduped) ----
    try {
      const ownerEmail = business?.owner?.email || null;
      const bizEmail = business?.email || null;
      const recipients = [...new Set([ownerEmail, bizEmail].filter(Boolean))]; // dedupe + drop falsy

      if (recipients.length > 0) {
        // neutral greeting if sending to multiple recipients
        const vendorName =
          recipients.length > 1
            ? (business?.owner?.name || business.businessName || "there") : (business.businessName || "there");

        await sendBusinessStatusEmail({
          to: recipients, // string or string[] supported by Nodemailer
          vendorName,
          business: {
            name: business.businessName,
            slug: business.slug,
            type: business.listingType, // 'service' | 'product' | 'food'
          },
          action: nextIsApproved ? "approved" : "blocked",
          adminNote: !nextIsApproved ? (req.body?.reason || "") : undefined, // optional when blocking
        });
      } else {
        console.warn("No recipient email found for business", business._id.toString());
      }
    } catch (mailErr) {
      console.error("Email send failed (toggleBusinessStatus):", mailErr);
      // don't fail API due to email issues
    }
    // ---------------------------------------------------------

    await recordAdminAuditSuccess(req, {
      actionCode: nextIsApproved
        ? ADMIN_AUDIT_ACTIONS.BUSINESS_APPROVE
        : ADMIN_AUDIT_ACTIONS.BUSINESS_DISAPPROVE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: business._id,
      changeSummary: buildFieldChangeSummary(
        { isApproved: previousIsApproved, isActive: previousIsActive },
        { isApproved: business.isApproved, isActive: business.isActive },
        ["isApproved", "isActive"]
      ),
      note: !nextIsApproved ? req.body?.reason || req.body?.adminNote || null : null,
    });

    return res.status(200).json({
      success: true,
      message: `Business has been ${statusText} successfully.`,
      data: business,
      publicMarketplaceEligible: isPublicMarketplaceBusiness(business),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.updateBusinessProfile = async (req, res) => {
  try {
    const body = req.body || {};
    const hasBusinessName = Object.prototype.hasOwnProperty.call(body, "businessName");
    const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
    const hasTags = Object.prototype.hasOwnProperty.call(body, "tags");

    if (!hasBusinessName && !hasDescription && !hasTags) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one of businessName, description, or tags.",
      });
    }

    if (hasTags && !Array.isArray(body.tags)) {
      return res.status(400).json({
        success: false,
        message: "tags must be an array of strings.",
      });
    }

    const business = await Business.findById(req.params.id).select(
      "businessName description tags"
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found.",
      });
    }

    const before = {
      businessName: business.businessName,
      description: business.description || "",
      tags: Array.isArray(business.tags) ? [...business.tags] : [],
    };

    if (hasBusinessName) {
      const nextName = String(body.businessName || "").trim();
      if (!nextName) {
        return res.status(400).json({
          success: false,
          message: "businessName cannot be empty.",
        });
      }
      business.businessName = nextName;
    }

    if (hasDescription) {
      business.description = String(body.description || "").trim();
    }

    if (hasTags) {
      business.tags = normalizeBusinessTags(body.tags);
    }

    await business.save();

    const after = {
      businessName: business.businessName,
      description: business.description || "",
      tags: Array.isArray(business.tags) ? [...business.tags] : [],
    };

    const changedFields = ["businessName", "description", "tags"].filter((field) => {
      if (field === "tags") {
        return JSON.stringify(before.tags) !== JSON.stringify(after.tags);
      }
      return before[field] !== after[field];
    });

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: business._id,
      changeSummary: buildFieldChangeSummary(before, after, changedFields),
    });

    return res.status(200).json({
      success: true,
      message: "Business profile updated successfully.",
      data: {
        _id: business._id,
        businessName: business.businessName,
        description: business.description || "",
        tags: business.tags || [],
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.updateBusinessTags = async (req, res) => {
  try {
    if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, "tags")) {
      return res.status(400).json({
        success: false,
        message: "tags is required and must be an array of strings.",
      });
    }

    if (!Array.isArray(req.body.tags)) {
      return res.status(400).json({
        success: false,
        message: "tags must be an array of strings.",
      });
    }

    const business = await Business.findById(req.params.id).select(
      "businessName tags"
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found.",
      });
    }

    const previousTags = Array.isArray(business.tags) ? [...business.tags] : [];
    const nextTags = normalizeBusinessTags(req.body.tags);

    business.tags = nextTags;
    await business.save();

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_TAGS_UPDATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: business._id,
      changeSummary: buildFieldChangeSummary(
        { tags: previousTags },
        { tags: nextTags },
        ["tags"]
      ),
    });

    return res.status(200).json({
      success: true,
      message: "Business tags updated successfully.",
      data: {
        _id: business._id,
        businessName: business.businessName,
        tags: nextTags,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.updateBusinessFeatured = async (req, res) => {
  try {
    const nextFeatured = parseBoolean(req.body?.isFeatured);
    if (nextFeatured === null) {
      return res.status(400).json({
        success: false,
        message: "isFeatured is required and must be true or false.",
      });
    }

    const business = await Business.findById(req.params.id).select(
      "businessName isFeatured"
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found.",
      });
    }

    const previousFeatured = Boolean(business.isFeatured);
    business.isFeatured = nextFeatured;
    await business.save();

    await recordAdminAuditSuccess(req, {
      actionCode: nextFeatured
        ? ADMIN_AUDIT_ACTIONS.BUSINESS_FEATURE
        : ADMIN_AUDIT_ACTIONS.BUSINESS_UNFEATURE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: business._id,
      changeSummary: buildFieldChangeSummary(
        { isFeatured: previousFeatured },
        { isFeatured: business.isFeatured },
        ["isFeatured"]
      ),
    });

    return res.status(200).json({
      success: true,
      message: `Business ${nextFeatured ? "featured" : "unfeatured"} successfully.`,
      data: {
        _id: business._id,
        businessName: business.businessName,
        isFeatured: business.isFeatured,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.patchBusinessActivationStatus = async (req, res) => {
  try {
    const business = await Business.findById(req.params.id)
      .populate("owner", "name email")
      .populate("adminStatusUpdatedBy", "name email");

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found.",
      });
    }

    const nextIsActive = parseBoolean(req.body.isActive);
    if (nextIsActive === null) {
      return res.status(400).json({
        success: false,
        message: "isActive is required and must be true or false.",
      });
    }

    const remark = String(
      req.body.remark || req.body.reason || req.body.adminNote || ""
    ).trim();

    if (!nextIsActive && !remark) {
      return res.status(400).json({
        success: false,
        message: "A remark is required when deactivating a business.",
      });
    }

    const previousIsActive = business.isActive;
    business.isActive = nextIsActive;
    business.adminStatusRemark = remark || business.adminStatusRemark || "";
    business.adminStatusUpdatedBy = req.user?._id || business.adminStatusUpdatedBy;
    business.adminStatusUpdatedAt = new Date();
    business.deactivatedAt = nextIsActive ? null : new Date();

    await business.save();

    if (previousIsActive && !nextIsActive) {
      try {
        const ownerEmail = business?.owner?.email || null;
        const bizEmail = business?.email || null;
        const recipients = [...new Set([ownerEmail, bizEmail].filter(Boolean))];

        if (recipients.length > 0) {
          const vendorName = business?.owner?.name || business.businessName || "there";

          await sendBusinessStatusEmail({
            to: recipients,
            vendorName,
            business: {
              name: business.businessName,
              slug: business.slug,
              type: business.listingType,
            },
            action: "deactivated",
            adminNote: remark,
          });
        }
      } catch (mailErr) {
        console.error("Email send failed (patchBusinessActivationStatus):", mailErr);
      }
    }

    await recordAdminAuditSuccess(req, {
      actionCode: nextIsActive
        ? ADMIN_AUDIT_ACTIONS.BUSINESS_ACTIVATE
        : ADMIN_AUDIT_ACTIONS.BUSINESS_DEACTIVATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: business._id,
      changeSummary: buildFieldChangeSummary(
        { isActive: previousIsActive },
        { isActive: business.isActive },
        ["isActive"]
      ),
      note: remark || null,
    });

    const publicMarketplaceEligible = isPublicMarketplaceBusiness(business);
    const activationMessage = nextIsActive && !publicMarketplaceEligible
      ? "Business has been activated, but it will remain hidden until it is approved."
      : `Business has been ${nextIsActive ? "activated" : "deactivated"} successfully.`;

    return res.status(200).json({
      success: true,
      message: activationMessage,
      data: business,
      publicMarketplaceEligible,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};
