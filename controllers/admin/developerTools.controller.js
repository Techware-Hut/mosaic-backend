const crypto = require('crypto');
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

// Kept for API compatibility (`defaultCleanupPatterns` in the list response).
// Intentionally empty: cleanup never falls back to implicit patterns, so an
// empty request can't match a broad set of businesses by accident.
const DEFAULT_CLEANUP_PATTERNS = [];
const MIN_CLEANUP_PATTERN_LENGTH = 4;
const MAX_CLEANUP_PATTERNS = 10;
const MAX_CLEANUP_BATCH = 200;

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
  return raw
    .map((p) => String(p ?? '').trim())
    .filter((p) => p.length > 0);
}

/**
 * Validate cleanup patterns. Returns { patterns } or { error } (400 message).
 * No implicit defaults: callers must name the patterns explicitly.
 */
function validateCleanupPatterns(input) {
  const patterns = [...new Set(normalizePatterns(input))];
  if (!patterns.length) {
    return {
      code: 'PATTERNS_REQUIRED',
      error:
        'At least one cleanup pattern is required. Default patterns are no longer applied.',
    };
  }
  if (patterns.length > MAX_CLEANUP_PATTERNS) {
    return {
      code: 'INVALID_PATTERNS',
      error: `A maximum of ${MAX_CLEANUP_PATTERNS} cleanup patterns is allowed.`,
    };
  }
  const tooShort = patterns.filter((p) => p.length < MIN_CLEANUP_PATTERN_LENGTH);
  if (tooShort.length) {
    return {
      code: 'INVALID_PATTERNS',
      error: `Each cleanup pattern must be at least ${MIN_CLEANUP_PATTERN_LENGTH} characters (got: ${tooShort.join(', ')}).`,
    };
  }
  const emailLike = patterns.filter(isEmailOrDomainFragment);
  if (emailLike.length) {
    return {
      code: 'PATTERN_EMAIL_LIKE',
      error: `Cleanup patterns must not be email/domain fragments that match many addresses (got: ${emailLike.join(', ')}).`,
    };
  }
  return { patterns };
}

// Fragments shared by large numbers of email addresses / domains.
const EMAIL_PROVIDER_TOKENS = [
  'gmail',
  'googlemail',
  'yahoo',
  'outlook',
  'hotmail',
  'icloud',
  'protonmail',
  'proton.me',
  'live.com',
  'msn.com',
  'aol.com',
];
const EMAIL_GENERIC_TOKENS = new Set(['mail', 'email', 'e-mail', 'www.']);
const TLD_FRAGMENT = /\.(com|net|org|edu|gov|info|biz|io|co|us|uk|ca|me|app|dev)\b/i;

function isEmailOrDomainFragment(pattern) {
  const p = String(pattern).toLowerCase();
  if (p.includes('@')) return true;
  if (EMAIL_GENERIC_TOKENS.has(p)) return true;
  if (TLD_FRAGMENT.test(p)) return true;
  return EMAIL_PROVIDER_TOKENS.some((token) => p.includes(token));
}

// Refuse cleanups whose patterns match more than this share of all businesses.
// Only enforced above a small absolute count so small (e.g. staging) databases can
// still remove a handful of QA records.
const MAX_CLEANUP_MATCH_SHARE = 0.25;
const BROAD_MATCH_MIN_COUNT = 10;

function isPatternTooBroad(matchedCount, totalBusinesses) {
  return (
    matchedCount > BROAD_MATCH_MIN_COUNT &&
    totalBusinesses > 0 &&
    matchedCount > totalBusinesses * MAX_CLEANUP_MATCH_SHARE
  );
}

function sortedIdStrings(docs) {
  return docs.map((d) => String(d._id)).sort();
}

/** sha256 over the sorted matched ids; binds a delete to the exact dry-run set. */
function computeMatchToken(sortedIds) {
  return crypto.createHash('sha256').update(sortedIds.join(',')).digest('hex');
}

/**
 * Parse the dry-run match count the caller confirms. Returns a non-negative
 * integer, or null when the value is missing, empty or not a non-negative
 * integer (the apply path requires it, so null is always a refusal there).
 */
function parseExpectedCount(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (text === '') return null;
  const n = typeof value === 'number' ? value : Number(text);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
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
      // cleanupMatch requires explicit patterns (same rules as /cleanup) so the
      // preview list always reflects exactly what a cleanup would target.
      const { patterns, error, code } = validateCleanupPatterns(req.query.patterns);
      if (error) {
        return res.status(400).json({ success: false, code, message: error });
      }
      const patternFilter = buildNameEmailPatternFilter(patterns);
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, patternFilter];
        delete filter.$or;
      } else {
        Object.assign(filter, patternFilter);
      }
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
    const { patterns, error: patternError, code: patternCode } = validateCleanupPatterns(
      req.body?.patterns ?? req.query?.patterns
    );
    if (patternError) {
      return res.status(400).json({ success: false, code: patternCode, message: patternError });
    }
    const dryRun = parseBoolean(req.body?.dryRun ?? req.query?.dryRun) !== false;
    const force = parseBoolean(req.body?.force ?? req.query?.force) === true;

    const filter = buildNameEmailPatternFilter(patterns);
    const [matchedCount, totalBusinesses] = await Promise.all([
      Business.countDocuments(filter),
      Business.countDocuments({}),
    ]);

    if (isPatternTooBroad(matchedCount, totalBusinesses)) {
      return res.status(400).json({
        success: false,
        code: 'PATTERN_TOO_BROAD',
        message: `Patterns match ${matchedCount} of ${totalBusinesses} businesses (more than ${Math.round(
          MAX_CLEANUP_MATCH_SHARE * 100
        )}%). Use more specific patterns.`,
        matchedCount,
        totalBusinesses,
      });
    }

    if (dryRun) {
      const matches = await Business.find(filter)
        .select('businessName email listingType isActive isApproved createdAt')
        .sort({ createdAt: -1 })
        .limit(MAX_CLEANUP_BATCH);
      const data = await attachListingCounts(matches);
      const exceedsBatchLimit = matchedCount > MAX_CLEANUP_BATCH;
      const matchedIds = exceedsBatchLimit ? [] : sortedIdStrings(matches);
      return res.status(200).json({
        success: true,
        dryRun: true,
        patterns,
        matched: matchedCount,
        matchedCount,
        maxBatch: MAX_CLEANUP_BATCH,
        exceedsBatchLimit,
        matchedIds,
        matchToken: exceedsBatchLimit ? null : computeMatchToken(matchedIds),
        data,
        message: exceedsBatchLimit
          ? `Dry run only — no records deleted. ${matchedCount} matches exceed the ${MAX_CLEANUP_BATCH}-business cleanup limit; narrow the patterns.`
          : 'Dry run only — no records deleted. To delete, resend with dryRun=false plus the matchToken and expectedCount (matchedCount) from this dry run.',
      });
    }

    const matchToken =
      typeof (req.body?.matchToken ?? req.query?.matchToken) === 'string'
        ? String(req.body?.matchToken ?? req.query?.matchToken).trim()
        : '';
    if (!matchToken) {
      return res.status(400).json({
        success: false,
        code: 'MATCH_TOKEN_REQUIRED',
        message: 'matchToken from a dry run is required when dryRun=false.',
        matchedCount,
      });
    }

    const rawExpected = req.body?.expectedCount ?? req.query?.expectedCount;
    const expectedCount = parseExpectedCount(rawExpected);
    if (expectedCount === null) {
      return res.status(400).json({
        success: false,
        code: 'EXPECTED_COUNT_REQUIRED',
        message:
          'expectedCount (a non-negative integer: the matchedCount from the dry run) is required when dryRun=false.',
        matchedCount,
      });
    }
    if (expectedCount !== matchedCount) {
      return res.status(409).json({
        success: false,
        code: 'EXPECTED_COUNT_MISMATCH',
        message: `Matched ${matchedCount} business(es) but expectedCount was ${expectedCount}. Nothing was deleted — run a new dry run and confirm again.`,
        matchedCount,
        expectedCount,
      });
    }
    if (matchedCount > MAX_CLEANUP_BATCH) {
      return res.status(400).json({
        success: false,
        code: 'TOO_MANY_MATCHES',
        message: `Patterns match ${matchedCount} businesses; a single cleanup may delete at most ${MAX_CLEANUP_BATCH}. Narrow the patterns.`,
        matchedCount,
      });
    }

    // Re-query the exact id set and require it to be the one the dry run saw.
    const current = await Business.find(filter)
      .select('_id')
      .limit(MAX_CLEANUP_BATCH + 1)
      .lean();
    const currentIds = sortedIdStrings(current);
    if (
      currentIds.length > MAX_CLEANUP_BATCH ||
      computeMatchToken(currentIds) !== matchToken
    ) {
      return res.status(409).json({
        success: false,
        code: 'MATCH_SET_CHANGED',
        message:
          'The set of matching businesses changed since the dry run. Nothing was deleted — run a new dry run and confirm again.',
        matchedCount: currentIds.length,
      });
    }

    const deleted = [];
    const skipped = [];

    for (const id of currentIds) {
      try {
        // Re-check each business still matches the patterns right before deleting it.
        const stillMatches = await Business.exists({ _id: id, ...filter });
        if (!stillMatches) {
          skipped.push({
            _id: id,
            code: 'NO_LONGER_MATCHES',
            message: 'Business no longer matches the cleanup patterns; not deleted.',
          });
          continue;
        }

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
          note: `Cleanup batch patterns=[${patterns.join(', ')}] force=${force}`,
          changeSummary: result.cleanup,
        });
      } catch (err) {
        skipped.push({
          _id: id,
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
      matchedCount: currentIds.length,
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
exports.MIN_CLEANUP_PATTERN_LENGTH = MIN_CLEANUP_PATTERN_LENGTH;
exports.MAX_CLEANUP_PATTERNS = MAX_CLEANUP_PATTERNS;
exports.validateCleanupPatterns = validateCleanupPatterns;
exports.computeMatchToken = computeMatchToken;

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
