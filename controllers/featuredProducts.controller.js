const Product = require('../models/Product');
const { toPublicListingCard } = require('../lib/listing/publicListingDto');

// Get featured products (public API)
exports.getFeaturedProducts = async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const skip = (page - 1) * limit;

    const products = await Product.find({
      isFeatured: true,
      isPublished: true,
      isDeleted: false
    })
    .populate('categoryId', 'name')
    .populate('subcategoryId', 'name')
    .populate('businessId', 'businessName location')
    .select('title slug description coverImage minorityType price createdAt categoryId subcategoryId businessId')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

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

    const total = await Product.countDocuments({
      isFeatured: true,
      isPublished: true,
      isDeleted: false
    });

    res.status(200).json({
      products: transformedProducts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalProducts: total
      }
    });
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ error: 'Server error' });
  }
};