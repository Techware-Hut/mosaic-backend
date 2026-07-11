const Product = require('../../models/Product');
const ProductVariant = require('../../models/ProductVariant');
const Service = require('../../models/Service');
const Food = require('../../models/Food');
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require('../../utils/audit/actionRegistry');
const {
  recordAdminAuditSuccess,
  buildFieldChangeSummary,
} = require('../../services/adminAuditService');
const {
  CATALOG_AUDIT_FLAGS,
  matchesRequestedFlags,
  buildAuditItem,
} = require('../../lib/admin/catalogAudit');
const { parseListingPrice } = require('../../lib/marketplace/listingPricePolicy');
const {
  hasActiveFoodBookings,
  hasActiveServiceBookings,
} = require('../../utils/bookingDeleteGuards');

const CATALOG_TYPES = Object.freeze(['product', 'service', 'food']);

const MODEL_BY_TYPE = Object.freeze({
  product: Product,
  service: Service,
  food: Food,
});

const ALLOWED_UPDATE_FIELDS = Object.freeze({
  product: ['title', 'description', 'price', 'coverImage', 'isActive', 'isPublished', 'adminRemark'],
  service: ['title', 'description', 'price', 'coverImage', 'isActive', 'isPublished', 'adminRemark'],
  food: ['title', 'description', 'price', 'coverImage', 'isActive', 'isPublished', 'adminRemark'],
});

function normalizeCatalogType(value) {
  const type = String(value || '').trim().toLowerCase();
  return CATALOG_TYPES.includes(type) ? type : null;
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function parsePageLimit(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function parseRequestedFlags(rawFlags) {
  if (!rawFlags) return [];
  const values = Array.isArray(rawFlags) ? rawFlags : String(rawFlags).split(',');
  return values
    .map((flag) => String(flag || '').trim().toLowerCase())
    .filter((flag) => CATALOG_AUDIT_FLAGS.includes(flag));
}

function getModel(type) {
  return MODEL_BY_TYPE[type] || null;
}

function baseListFilter(type) {
  if (type === 'product') {
    return { isDeleted: false };
  }
  return {};
}

function applyActivePublishedFilters(filter, query = {}) {
  const isActive = parseBoolean(query.isActive);
  const isPublished = parseBoolean(query.isPublished);

  if (isActive === true) {
    filter.isActive = { $ne: false };
  } else if (isActive === false) {
    filter.isActive = false;
  }

  if (isPublished === true) {
    filter.isPublished = true;
  } else if (isPublished === false) {
    filter.isPublished = false;
  }

  return filter;
}

async function loadVariantsByProductId(productIds = []) {
  const map = new Map();
  if (!productIds.length) return map;

  const variants = await ProductVariant.find({
    productId: { $in: productIds },
    isDeleted: { $ne: true },
  })
    .select('productId price salePrice isPublished isDeleted')
    .lean();

  for (const variant of variants) {
    const key = String(variant.productId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(variant);
  }

  return map;
}

function serializePrice(value) {
  const parsed = parseListingPrice(value);
  return parsed !== null ? parsed : null;
}

function serializeListing(listing, type) {
  const business = listing.businessId;
  return {
    listingType: type,
    _id: listing._id,
    title: listing.title,
    description: listing.description,
    price: serializePrice(listing.price),
    coverImage: listing.coverImage,
    isPublished: Boolean(listing.isPublished),
    isActive: listing.isActive !== false,
    isFeatured: type === 'product' ? Boolean(listing.isFeatured) : false,
    adminRemark: listing.adminRemark || '',
    businessId: business?._id || listing.businessId || null,
    businessName: business?.businessName || null,
    categoryId: listing.categoryId || null,
    subcategoryId: listing.subcategoryId || null,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

function pickAllowedUpdates(type, body = {}) {
  const allowed = ALLOWED_UPDATE_FIELDS[type] || [];
  const updates = {};

  for (const field of allowed) {
    if (body[field] === undefined) continue;

    if (field === 'isActive' || field === 'isPublished') {
      const parsed = parseBoolean(body[field]);
      if (parsed !== null) updates[field] = parsed;
      continue;
    }

    if (field === 'price') {
      const parsed = Number(body[field]);
      if (Number.isFinite(parsed) && parsed >= 0) updates[field] = parsed;
      continue;
    }

    if (typeof body[field] === 'string') {
      updates[field] = body[field].trim();
    }
  }

  return updates;
}

exports.listCatalog = async (req, res) => {
  try {
    const type = normalizeCatalogType(req.query.type);
    const types = type ? [type] : CATALOG_TYPES;
    const { page, limit, skip } = parsePageLimit(req.query);

    const rows = [];

    for (const listingType of types) {
      const Model = getModel(listingType);
      const filter = applyActivePublishedFilters(baseListFilter(listingType), req.query);

      const items = await Model.find(filter)
        .populate('businessId', 'businessName')
        .populate('categoryId', 'name')
        .populate('subcategoryId', 'name')
        .sort({ updatedAt: -1 })
        .lean();

      for (const item of items) {
        rows.push(serializeListing(item, listingType));
      }
    }

    rows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const total = rows.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPages);
    const safeSkip = (safePage - 1) * limit;
    const paged = rows.slice(safeSkip, safeSkip + limit);

    return res.status(200).json({
      success: true,
      data: {
        items: paged,
        pagination: {
          currentPage: safePage,
          totalPages,
          total,
          limit,
        },
      },
    });
  } catch (error) {
    console.error('listCatalog error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load catalog listings.' });
  }
};

exports.getCatalogItem = async (req, res) => {
  try {
    const type = normalizeCatalogType(req.params.type);
    if (!type) {
      return res.status(400).json({ success: false, message: 'Invalid listing type.' });
    }

    const Model = getModel(type);
    const listing = await Model.findOne({
      _id: req.params.id,
      ...(type === 'product' ? { isDeleted: false } : {}),
    })
      .populate('businessId', 'businessName')
      .lean();

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }

    return res.status(200).json({
      success: true,
      data: serializeListing(listing, type),
    });
  } catch (error) {
    console.error('getCatalogItem error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load listing.' });
  }
};

exports.updateCatalogItem = async (req, res) => {
  try {
    const type = normalizeCatalogType(req.params.type);
    if (!type) {
      return res.status(400).json({ success: false, message: 'Invalid listing type.' });
    }

    const Model = getModel(type);
    const listing = await Model.findOne({
      _id: req.params.id,
      ...(type === 'product' ? { isDeleted: false } : {}),
    });

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }

    const before = {
      title: listing.title,
      description: listing.description,
      price: listing.price,
      coverImage: listing.coverImage,
      isActive: listing.isActive !== false,
      isPublished: Boolean(listing.isPublished),
      adminRemark: listing.adminRemark || '',
    };

    const updates = pickAllowedUpdates(type, req.body || {});
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    if (updates.isActive === false) {
      updates.isPublished = false;
    }

    Object.assign(listing, updates);
    listing.adminModeratedAt = new Date();
    listing.adminModeratedBy = req.user?._id || req.user?.id;

    await listing.save();

    const after = {
      title: listing.title,
      description: listing.description,
      price: listing.price,
      coverImage: listing.coverImage,
      isActive: listing.isActive !== false,
      isPublished: Boolean(listing.isPublished),
      adminRemark: listing.adminRemark || '',
    };

    const actionCode = updates.isActive === false
      ? ADMIN_AUDIT_ACTIONS.CATALOG_DEACTIVATE
      : updates.isActive === true
        ? ADMIN_AUDIT_ACTIONS.CATALOG_ACTIVATE
        : ADMIN_AUDIT_ACTIONS.CATALOG_UPDATE;

    await recordAdminAuditSuccess(req, {
      actionCode,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATALOG_LISTING,
      targetId: listing._id,
      changeSummary: buildFieldChangeSummary(before, after, Object.keys(updates)),
      note: updates.adminRemark || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Listing updated successfully.',
      data: serializeListing(listing.toObject(), type),
    });
  } catch (error) {
    console.error('updateCatalogItem error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update listing.' });
  }
};

exports.patchCatalogActive = async (req, res) => {
  req.body = {
    isActive: req.body?.isActive,
    adminRemark: req.body?.adminRemark || req.body?.remark || req.body?.reason,
  };
  return exports.updateCatalogItem(req, res);
};

exports.deleteCatalogItem = async (req, res) => {
  try {
    const type = normalizeCatalogType(req.params.type);
    if (!type) {
      return res.status(400).json({ success: false, message: 'Invalid listing type.' });
    }

    const adminRemark = String(
      req.body?.adminRemark || req.body?.remark || req.body?.reason || ''
    ).trim();

    if (!adminRemark) {
      return res.status(400).json({
        success: false,
        message: 'adminRemark is required to delete a listing.',
      });
    }

    const Model = getModel(type);
    const listing = await Model.findOne({
      _id: req.params.id,
      ...(type === 'product' ? { isDeleted: false } : {}),
    });

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }

    const before = {
      title: listing.title,
      isActive: listing.isActive !== false,
      isPublished: Boolean(listing.isPublished),
      isDeleted: Boolean(listing.isDeleted),
    };

    let archivedDueToBookings = false;
    let removed = false;
    let archived = false;

    if (type === 'service') {
      const hasActiveBookings = await hasActiveServiceBookings({
        serviceId: listing._id,
        ownerId: listing.ownerId,
      });
      if (hasActiveBookings) {
        listing.isActive = false;
        listing.isPublished = false;
        listing.adminRemark = adminRemark;
        listing.adminModeratedAt = new Date();
        listing.adminModeratedBy = req.user?._id || req.user?.id;
        await listing.save();
        archivedDueToBookings = true;
        archived = true;
      }
    }

    if (!archivedDueToBookings && type === 'food') {
      const hasActiveBookings = await hasActiveFoodBookings({
        foodId: listing._id,
        ownerId: listing.ownerId,
      });
      if (hasActiveBookings) {
        listing.isActive = false;
        listing.isPublished = false;
        listing.adminRemark = adminRemark;
        listing.adminModeratedAt = new Date();
        listing.adminModeratedBy = req.user?._id || req.user?.id;
        await listing.save();
        archivedDueToBookings = true;
        archived = true;
      }
    }

    if (!archivedDueToBookings) {
      if (type === 'product') {
        listing.isDeleted = true;
        listing.isActive = false;
        listing.isPublished = false;
        listing.adminRemark = adminRemark;
        listing.adminModeratedAt = new Date();
        listing.adminModeratedBy = req.user?._id || req.user?.id;
        await listing.save();

        await ProductVariant.updateMany(
          { productId: listing._id },
          { $set: { isDeleted: true } }
        );
        archived = true;
      } else {
        await listing.deleteOne();
        removed = true;
      }
    }

    await recordAdminAuditSuccess(req, {
      actionCode: archivedDueToBookings
        ? ADMIN_AUDIT_ACTIONS.CATALOG_DEACTIVATE
        : ADMIN_AUDIT_ACTIONS.CATALOG_DELETE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATALOG_LISTING,
      targetId: listing._id,
      changeSummary: buildFieldChangeSummary(before, {
        title: before.title,
        isActive: false,
        isPublished: false,
        isDeleted: archived && type === 'product',
      }, ['isActive', 'isPublished', 'isDeleted']),
      note: archivedDueToBookings
        ? `${adminRemark} (archived instead of deleted due to active bookings)`
        : adminRemark,
    });

    return res.status(200).json({
      success: true,
      message: archivedDueToBookings
        ? 'Listing has active bookings and was archived (hidden) instead of permanently removed.'
        : 'Listing deleted successfully.',
      data: {
        listingType: type,
        id: String(listing._id),
        archived: archived || type === 'product',
        removed,
        archivedDueToBookings,
      },
    });
  } catch (error) {
    console.error('deleteCatalogItem error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete listing.' });
  }
};

exports.auditCatalog = async (req, res) => {
  try {
    const type = normalizeCatalogType(req.query.type);
    const types = type ? [type] : CATALOG_TYPES;
    const requestedFlags = parseRequestedFlags(req.query.flags);
    const { page, limit, skip } = parsePageLimit(req.query);

    const auditRows = [];

    for (const listingType of types) {
      const Model = getModel(listingType);
      const filter = applyActivePublishedFilters(baseListFilter(listingType), req.query);

      const listings = await Model.find(filter)
        .populate('businessId', 'businessName')
        .sort({ updatedAt: -1 })
        .lean();

      let variantsByProductId = new Map();
      if (listingType === 'product' && listings.length) {
        variantsByProductId = await loadVariantsByProductId(listings.map((item) => item._id));
      }

      for (const listing of listings) {
        const options = listingType === 'product'
          ? { variants: variantsByProductId.get(String(listing._id)) || [] }
          : {};
        const item = buildAuditItem(listing, listingType, options);
        if (!matchesRequestedFlags(item.flags, requestedFlags)) continue;
        auditRows.push(item);
      }
    }

    auditRows.sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1, none: 0 };
      const diff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
      if (diff !== 0) return diff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const summary = {
      total: auditRows.length,
      byType: auditRows.reduce((acc, row) => {
        acc[row.listingType] = (acc[row.listingType] || 0) + 1;
        return acc;
      }, {}),
      byFlag: CATALOG_AUDIT_FLAGS.reduce((acc, flag) => {
        acc[flag] = auditRows.filter((row) => row.flags.includes(flag)).length;
        return acc;
      }, {}),
    };

    const total = auditRows.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPages);
    const safeSkip = (safePage - 1) * limit;
    const paged = auditRows.slice(safeSkip, safeSkip + limit);

    return res.status(200).json({
      success: true,
      data: {
        summary,
        items: paged,
        pagination: {
          currentPage: safePage,
          totalPages,
          total,
          limit,
        },
      },
    });
  } catch (error) {
    console.error('auditCatalog error:', error);
    return res.status(500).json({ success: false, message: 'Failed to audit catalog listings.' });
  }
};

module.exports.CATALOG_TYPES = CATALOG_TYPES;
