const Product = require('../../models/Product');
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require('../../utils/audit/actionRegistry');
const {
  recordAdminAuditSuccess,
  buildFieldChangeSummary,
} = require('../../services/adminAuditService');

// Toggle product featured status
exports.toggleProductFeatured = async (req, res) => {
  try {
    const { productId } = req.params;
    const { isFeatured } = req.body;

    const existingProduct = await Product.findOne({
      _id: productId,
      isDeleted: false
    });

    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let nextFeaturedValue;

    if (typeof isFeatured === 'boolean') {
      nextFeaturedValue = isFeatured;
    } else if (isFeatured === 'true' || isFeatured === 'false') {
      nextFeaturedValue = isFeatured === 'true';
    } else {
      nextFeaturedValue = !existingProduct.isFeatured;
    }

    const previousFeatured = existingProduct.isFeatured;
    existingProduct.isFeatured = nextFeaturedValue;
    await existingProduct.save();

    await recordAdminAuditSuccess(req, {
      actionCode: nextFeaturedValue
        ? ADMIN_AUDIT_ACTIONS.PRODUCT_FEATURE
        : ADMIN_AUDIT_ACTIONS.PRODUCT_UNFEATURE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.PRODUCT,
      targetId: existingProduct._id,
      changeSummary: buildFieldChangeSummary(
        { isFeatured: previousFeatured },
        { isFeatured: existingProduct.isFeatured },
        ['isFeatured']
      ),
    });

    res.status(200).json({
      message: `Product ${nextFeaturedValue ? 'featured' : 'unfeatured'} successfully`,
      product: {
        _id: existingProduct._id,
        title: existingProduct.title,
        isFeatured: existingProduct.isFeatured
      }
    });
  } catch (error) {
    console.error('Error toggling product featured status:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get all products for admin management
exports.getAllProducts = async (req, res) => {
  try {
    const { page = 1, limit = 20, featured } = req.query;
    const skip = (page - 1) * limit;

    const filter = { isDeleted: false };
    if (featured !== undefined) {
      filter.isFeatured = featured === 'true';
    }

    const products = await Product.find(filter)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('businessId', 'businessName')
      .select('title coverImage isFeatured isPublished isActive description price createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filter);

    res.status(200).json({
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalProducts: total
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
