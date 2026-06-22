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

    const nextIsApproved = !business.isApproved;
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

    const statusText = nextIsApproved ? "approved and activated" : "disapproved and deactivated";

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

    return res.status(200).json({
      success: true,
      message: `Business has been ${nextIsActive ? "activated" : "deactivated"} successfully.`,
      data: business,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};
