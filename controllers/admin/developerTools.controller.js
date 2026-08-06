const Business = require('../../models/Business');
const Product = require('../../models/Product');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const {
  hardDeleteBusinessCascade,
} = require('../../lib/admin/cascadeDeleteBusiness');
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require('../../utils/audit/actionRegistry');
const {
  recordAdminAuditSuccess,
  recordAdminAuditFailure,
} = require('../../services/adminAuditService');
const {
  isPublicMarketplaceBusiness,
} = require('../../lib/marketplace/businessEligibility');

const DEFAULT_CLEANUP_PATTERNS = ['test', 'satish'];

const parseBoolean = (value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePatterns(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const patterns = raw
    .map((p) => String(p ?? '').trim())
    .filter((p) => p.length > 0);
  return patterns.length ? patterns : [...DEFAULT_CLEANUP_PATTERNS];
}

function buildNameEmailPatternFilter(patterns) {
  const ors = [];
  for (const pattern of patterns) {
    const rx = new RegExp(escapeRegex(pattern), 'i');
    ors.push({ businessName: rx }, { email: rx });
  }
  return ors.length ? { $or: ors } : {};
}

async function attachListingCounts(businesses) {
  return Promise.all(
    businesses.map(async (biz) => {
      const id = biz._id;
      const [productCount, serviceCount, foodCount] = await Promise.all([
        Product.countDocuments({ businessId: id, isDeleted: { $ne: true } }),
        Service.countDocuments({ businessId: id }),
        Food.countDocuments({ businessId: id }),
      ]);
      const listingCount =
        biz.listingType === 'service'
          ? serviceCount
          : biz.listingType === 'food'
            ? foodCount
            : productCount;

      const plain = typeof biz.toObject === 'function' ? biz.toObject() : { ...biz };
      return {
        ...plain,
        productCount,
        serviceCount,
        foodCount,
        listingCount,
        publicMarketplaceEligible: isPublicMarketplaceBusiness(plain),
      };
    })
  );
}

exports.listDeveloperBusinesses = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.isActive !== undefined) {
      const activeFilter = parseBoolean(req.query.isActive);
      if (activeFilter === null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid isActive filter. Use true or false.',
        });
      }
      filter.isActive = activeFilter;
    }

    if (req.query.listingType) {
      filter.listingType = String(req.query.listingType).trim();
    }

    const search = String(req.query.search || '').trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ businessName: rx }, { email: rx }, { slug: rx }];
    }

    if (req.query.cleanupMatch === 'true' || req.query.cleanupMatch === '1') {
      const patterns = normalizePatterns(req.query.patterns);
      Object.assign(filter, buildNameEmailPatternFilter(patterns));
    }

    const [rows, total] = await Promise.all([
      Business.find(filter)
        .populate('owner', 'name email mobile')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Business.countDocuments(filter),
    ]);

    const data = await attachListingCounts(rows);

    return res.status(200).json({
      success: true,
      data,
      total,
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      defaultCleanupPatterns: DEFAULT_CLEANUP_PATTERNS,
    });
  } catch (error) {
    console.error('listDeveloperBusinesses:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list businesses for developer tools.',
    });
  }
};

exports.toggleDeveloperBusinessStatus = async (req, res) => {
  try {
    const business = await Business.findById(req.params.id).populate(
      'owner',
      'name email'
    );
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    const nextIsActive = parseBoolean(req.body.isActive);
    if (nextIsActive === null) {
      return res.status(400).json({
        success: false,
        message: 'isActive is required and must be true or false.',
      });
    }

    const remark = String(
      req.body.remark || req.body.reason || 'Toggled from Admin Dev Tools.'
    ).trim();

    if (!nextIsActive && !remark) {
      return res.status(400).json({
        success: false,
        message: 'A remark is required when deactivating a business.',
      });
    }

    const previousIsActive = business.isActive;
    business.isActive = nextIsActive;
    business.adminStatusRemark = remark;
    business.adminStatusUpdatedBy = req.user?._id || null;
    business.adminStatusUpdatedAt = new Date();
    business.deactivatedAt = nextIsActive ? null : new Date();
    await business.save();

    await recordAdminAuditSuccess(req, {
      actionCode: nextIsActive
        ? ADMIN_AUDIT_ACTIONS.BUSINESS_ACTIVATE
        : ADMIN_AUDIT_ACTIONS.BUSINESS_DEACTIVATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: business._id,
      note: `Dev Tools: ${remark}`,
    });

    return res.status(200).json({
      success: true,
      message: `Business ${nextIsActive ? 'activated' : 'deactivated'} successfully.`,
      data: {
        _id: business._id,
        isActive: business.isActive,
        previousIsActive,
        publicMarketplaceEligible: isPublicMarketplaceBusiness(business),
      },
    });
  } catch (error) {
    console.error('toggleDeveloperBusinessStatus:', error);
    await recordAdminAuditFailure(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_DEACTIVATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: req.params.id,
      note: error.message,
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to update business status.',
    });
  }
};

exports.deleteDeveloperBusiness = async (req, res) => {
  try {
    const force =
      parseBoolean(req.query.force) === true ||
      parseBoolean(req.body?.force) === true;

    const result = await hardDeleteBusinessCascade(req.params.id, { force });

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_HARD_DELETE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: result.business._id,
      note: `Hard deleted "${result.business.businessName}" (force=${force}). Orders retained: ${result.ordersRetained}.`,
      changeSummary: result.cleanup,
    });

    return res.status(200).json({
      success: true,
      message: 'Business hard-deleted. Associated listings cleaned up.',
      data: result,
    });
  } catch (error) {
    const status = error.status || 500;
    await recordAdminAuditFailure(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_HARD_DELETE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
      targetId: req.params.id,
      note: error.message,
    });

    if (status === 404 || status === 409) {
      return res.status(status).json({
        success: false,
        code: error.code,
        message: error.message,
        orderCount: error.orderCount,
      });
    }

    console.error('deleteDeveloperBusiness:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to hard-delete business.',
    });
  }
};

exports.cleanupDeveloperBusinesses = async (req, res) => {
  try {
    const patterns = normalizePatterns(req.body?.patterns ?? req.query?.patterns);
    const dryRun = parseBoolean(req.body?.dryRun ?? req.query?.dryRun) !== false;
    const force = parseBoolean(req.body?.force ?? req.query?.force) === true;

    const filter = buildNameEmailPatternFilter(patterns);
    const matches = await Business.find(filter)
      .select('businessName email listingType isActive isApproved createdAt')
      .sort({ createdAt: -1 })
      .limit(200);

    if (dryRun) {
      const data = await attachListingCounts(matches);
      return res.status(200).json({
        success: true,
        dryRun: true,
        patterns,
        matched: data.length,
        data,
        message: 'Dry run only — no records deleted. Resend with dryRun=false to delete.',
      });
    }

    const deleted = [];
    const skipped = [];

    for (const biz of matches) {
      try {
        const result = await hardDeleteBusinessCascade(biz._id, { force });
        deleted.push({
          _id: result.business._id,
          businessName: result.business.businessName,
          email: result.business.email,
          ordersRetained: result.ordersRetained,
          cleanup: result.cleanup,
        });

        await recordAdminAuditSuccess(req, {
          actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_HARD_DELETE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
          targetId: result.business._id,
          note: `Cleanup batch patterns=[${patterns.join(', ')}] force=${force}`,
          changeSummary: result.cleanup,
        });
      } catch (err) {
        skipped.push({
          _id: biz._id,
          businessName: biz.businessName,
          email: biz.email,
          code: err.code || 'ERROR',
          message: err.message,
          orderCount: err.orderCount,
        });
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: false,
      patterns,
      deletedCount: deleted.length,
      skippedCount: skipped.length,
      deleted,
      skipped,
      message: `Hard-deleted ${deleted.length} business(es); skipped ${skipped.length}.`,
    });
  } catch (error) {
    console.error('cleanupDeveloperBusinesses:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to run developer cleanup.',
    });
  }
};

exports.DEFAULT_CLEANUP_PATTERNS = DEFAULT_CLEANUP_PATTERNS;

function normalizeBusinessIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of raw) {
    const id = String(value ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

exports.bulkUpdateDeveloperBusinessStatus = async (req, res) => {
  try {
    const businessIds = normalizeBusinessIds(req.body?.businessIds);
    if (!businessIds.length) {
      return res.status(400).json({
        success: false,
        message: 'businessIds must be a non-empty array.',
      });
    }
    if (businessIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'A maximum of 100 businesses can be updated at once.',
      });
    }

    const nextIsActive = parseBoolean(req.body?.isActive);
    if (nextIsActive === null) {
      return res.status(400).json({
        success: false,
        message: 'isActive is required and must be true or false.',
      });
    }

    const remark = String(
      req.body?.remark ||
        (nextIsActive
          ? 'Bulk activated from Admin Dev Tools.'
          : 'Bulk deactivated from Admin Dev Tools.')
    ).trim();

    if (!nextIsActive && !remark) {
      return res.status(400).json({
        success: false,
        message: 'A remark is required when deactivating businesses.',
      });
    }

    const updated = [];
    const skipped = [];

    for (const id of businessIds) {
      try {
        const business = await Business.findById(id);
        if (!business) {
          skipped.push({ _id: id, code: 'NOT_FOUND', message: 'Business not found.' });
          continue;
        }

        const previousIsActive = business.isActive;
        business.isActive = nextIsActive;
        business.adminStatusRemark = remark;
        business.adminStatusUpdatedBy = req.user?._id || null;
        business.adminStatusUpdatedAt = new Date();
        business.deactivatedAt = nextIsActive ? null : new Date();
        await business.save();

        await recordAdminAuditSuccess(req, {
          actionCode: nextIsActive
            ? ADMIN_AUDIT_ACTIONS.BUSINESS_ACTIVATE
            : ADMIN_AUDIT_ACTIONS.BUSINESS_DEACTIVATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
          targetId: business._id,
          note: `Dev Tools bulk status: ${remark}`,
        });

        updated.push({
          _id: business._id,
          businessName: business.businessName,
          previousIsActive,
          isActive: business.isActive,
        });
      } catch (err) {
        skipped.push({
          _id: id,
          code: 'ERROR',
          message: err.message || 'Failed to update status.',
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `${nextIsActive ? 'Activated' : 'Deactivated'} ${updated.length} business(es); skipped ${skipped.length}.`,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      updated,
      skipped,
    });
  } catch (error) {
    console.error('bulkUpdateDeveloperBusinessStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to bulk-update business status.',
    });
  }
};

exports.bulkDeleteDeveloperBusinesses = async (req, res) => {
  try {
    const businessIds = normalizeBusinessIds(req.body?.businessIds);
    if (!businessIds.length) {
      return res.status(400).json({
        success: false,
        message: 'businessIds must be a non-empty array.',
      });
    }
    if (businessIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'A maximum of 100 businesses can be deleted at once.',
      });
    }

    const force = parseBoolean(req.body?.force) === true;
    const deleted = [];
    const skipped = [];

    for (const id of businessIds) {
      try {
        const result = await hardDeleteBusinessCascade(id, { force });
        deleted.push({
          _id: result.business._id,
          businessName: result.business.businessName,
          email: result.business.email,
          ordersRetained: result.ordersRetained,
          cleanup: result.cleanup,
        });

        await recordAdminAuditSuccess(req, {
          actionCode: ADMIN_AUDIT_ACTIONS.BUSINESS_HARD_DELETE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.BUSINESS,
          targetId: result.business._id,
          note: `Dev Tools bulk hard-delete (force=${force}). Orders retained: ${result.ordersRetained}.`,
          changeSummary: result.cleanup,
        });
      } catch (err) {
        skipped.push({
          _id: id,
          code: err.code || 'ERROR',
          message: err.message || 'Failed to delete business.',
          orderCount: err.orderCount,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Hard-deleted ${deleted.length} business(es); skipped ${skipped.length}.`,
      deletedCount: deleted.length,
      skippedCount: skipped.length,
      force,
      deleted,
      skipped,
    });
  } catch (error) {
    console.error('bulkDeleteDeveloperBusinesses:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to bulk-delete businesses.',
    });
  }
};
