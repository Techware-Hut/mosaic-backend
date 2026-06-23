const Product = require('../models/Product');
const Business = require('../models/Business');
const { toPublicListingCard } = require('../lib/listing/publicListingDto');
const {
  publicMarketplaceBusinessFilter,
} = require('../lib/marketplace/businessEligibility');

const FEATURED_MAX_LIMIT = 50;

async function getVisibleBusinessIds() {
  const businesses = await Business.find(
    publicMarketplaceBusinessFilter()
  ).select('_id').lean();
  return businesses.map((business) => business._id);
}

// Get featured products (public API)
exports.getFeaturedProducts = async (req, res) => {
  try {
    const pageN = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitN = Math.max(
      1,
      Math.min(FEATURED_MAX_LIMIT, parseInt(req.query.limit, 10) || 12)
    );
    const skip = (pageN - 1) * limitN;

    const visibleBusinessIds = await getVisibleBusinessIds();
    if (!visibleBusinessIds.length) {
      return res.status(200).json({
        products: [],
        pagination: {
          currentPage: pageN,
          totalPages: 0,
          totalProducts: 0,
        },
      });
    }

    const query = {
      isFeatured: true,
      isPublished: true,
      isDeleted: false,
      businessId: { $in: visibleBusinessIds },
    };

    const products = await Product.find(query)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('businessId', 'businessName location')
      .select('title slug description coverImage minorityType price createdAt categoryId subcategoryId businessId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitN);

    const transformedProducts = products.map((product) => {
      const productObj = product.toObject();
      return toPublicListingCard(
        {
          ...productObj,
          category: productObj.categoryId,
          subcategory: productObj.subcategoryId,
          business: productObj.businessId,
        },
        { listingType: 'product' }
      );
    });

    const total = await Product.countDocuments(query);

    res.status(200).json({
      products: transformedProducts,
      pagination: {
        currentPage: pageN,
        totalPages: Math.ceil(total / limitN),
        totalProducts: total,
      },
    });
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
