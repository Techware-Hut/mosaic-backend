const Service = require('../models/Service');
const Review = require('../models/Review');
const ServiceCategory = require('../models/ServiceCategory');

exports.getAllPrivateServicesForBusiness = async (req, res) => {
  try {
    const {
      search = '',
      city,
      state,
      country,
      minorityType,
      categorySlug,
      businessId,
      sort,
      openNow,
      onlineBooking,
      offers,
      page = 1,
      limit = 10,
      showUnpublished = 'false', // Query param to show unpublished services
    } = req.query;

    // Validate that businessId is provided
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business ID is required' });
    }

    const filters = { businessId: businessId, ownerId: req.user._id };

    // Search filter
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'services.name': { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['contact.address'] = { $regex: city, $options: 'i' };

    // Category Slug to categoryId conversion
    if (categorySlug) {
      const category = await ServiceCategory.findOne({ slug: categorySlug });
      if (category) {
        filters.categoryId = category._id;
      } else {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
    }

    if (onlineBooking === 'true') filters.features = { $in: ['Online Booking'] };
    if (offers === 'true') filters.features = { $in: ['Offers Available'] };

    // If showUnpublished is true, include unpublished services
    if (showUnpublished === 'true') {
      filters.isPublished = false; // Show unpublished services only
    }

    // Sorting logic
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };
    if (sort === 'reviews') sortOption = { totalReviews: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const services = await Service.find(filters)
      .select('title services averageRating totalReviews slug description contact.address coverImage isPublished')
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments({ ...filters }); // Already present

    // Clone the filters without mutating original
    const publishedFilter = { ...filters, isPublished: true };
    const unpublishedFilter = { ...filters, isPublished: false };

    const publishedCount = await Service.countDocuments(publishedFilter);
    const unpublishedCount = await Service.countDocuments(unpublishedFilter);

    res.json({
      success: true,
      total,
      publishedCount,
      unpublishedCount,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: services,
    });
  } catch (err) {
    console.error('Error fetching private services:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};




// GET /api/public/services/:slug

exports.getServiceBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const service = await Service.findOne({ slug })
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('ownerId', 'name');

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // 👉 Fetch related reviews
    const reviews = await Review.find({
      listingId: service._id,
      listingType: 'service',
    })
      .populate('userId', 'name profileImage'); // Adjust fields as needed

    res.status(200).json({
      success: true,
      data: {
        service,
        reviews,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};




// controllers/publicListing.js
const Food = require('../models/Food');
const FoodCategory = require('../models/FoodCategory');

exports.getAllFood = async (req, res) => {
  try {
    const {
      search = '',
      city,
      state,
      country,
      minorityType,
      categorySlug,
      businessId,
      sort,
      offers,
      page = 1,
      limit = 10,
      outOfStock = false,
      showUnpublished = 'false',  // New query parameter for unpublished filter
    } = req.query;

    // Validate that businessId is provided
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business ID is required' });
    }

    const filters = { businessId: businessId, ownerId: req.user._id }; // Updated to use req.user._id

    // Search filter
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    // Filter by minorityType, city, state, and country
    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['address.city'] = { $regex: city, $options: 'i' };
    if (state) filters['address.state'] = { $regex: state, $options: 'i' };
    if (country) filters['address.country'] = { $regex: country, $options: 'i' };

    // Category Slug to categoryId conversion
    if (categorySlug) {
      const category = await FoodCategory.findOne({ slug: categorySlug });
      if (category) {
        filters.categoryId = category._id;
      } else {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
    }

    // Offers filter
    if (offers === 'true') filters.features = { $in: ['Offers Available'] };

    // Out of stock filter
    if (outOfStock === 'true') {
      filters.stockQuantity = { $lte: 0 };  // Assuming stockQuantity tracks available stock
    }

    // Unpublished filter
    if (showUnpublished === 'true') {
      filters.isPublished = false;  // Only return unpublished food items
    }

    // Sorting logic
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    // Pagination logic
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetching food items based on filters
    const foodItems = await Food.find(filters)
      .select('title description price slug coverImage')
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Food.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: foodItems,
    });
  } catch (err) {
    console.error('Error fetching food items:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};





const ProductVariant = require('../models/ProductVariant');
const Product = require('../models/Product');
const ProductCategory = require('../models/ProductCategory');


// exports.getAllProducts = async (req, res) => {
//   try {
//     const {
//       search = '',
//       city,
//       state,
//       country,
//       minorityType,
//       categorySlug,
//       businessId,
//       sort,
//       offers,
//       page = 1,
//       limit = 10,
//       outOfStock = false,
//       showUnpublished = 'false',
//     } = req.query;

//     if (!businessId) {
//       return res.status(400).json({ success: false, message: 'Business ID is required' });
//     }

//     const filters = { businessId: businessId, ownerId: req.user._id };

//     // Search filter
//     if (search) {
//       filters.$or = [
//         { 'productId.title': { $regex: search, $options: 'i' } },
//         { 'productId.description': { $regex: search, $options: 'i' } },
//       ];
//     }

//     if (minorityType) filters.minorityType = minorityType;
//     if (city) filters['address.city'] = { $regex: city, $options: 'i' };
//     if (state) filters['address.state'] = { $regex: state, $options: 'i' };
//     if (country) filters['address.country'] = { $regex: country, $options: 'i' };

//     if (categorySlug) {
//       const category = await ProductCategory.findOne({ slug: categorySlug });
//       if (category) {
//         filters.categoryId = category._id;
//       } else {
//         return res.json({ success: true, total: 0, page: 1, totalPages: 0, data: [] });
//       }
//     }

//     if (offers === 'true') filters.features = { $in: ['Offers Available'] };
//     if (outOfStock === 'true') filters['sizes.stock'] = { $lte: 0 };

//     if (showUnpublished === 'true') {
//       filters.isPublished = false;
//     }

//     // Sorting logic
//     let sortOption = { createdAt: -1 };
//     if (sort === 'price_asc') sortOption = { 'sizes.price': 1 };
//     if (sort === 'price_desc') sortOption = { 'sizes.price': -1 };
//     if (sort === 'rating') sortOption = { averageRating: -1 };

//     const pageNum = parseInt(page) || 1;
//     const limitNum = parseInt(limit) || 10;
//     const skip = (pageNum - 1) * limitNum;

//     // Fetch product variants
//     const productVariants = await ProductVariant.find(filters)
//       .select('color sizes isPublished images totalReviews averageRating')
//       .populate('productId', 'title description coverImage')
//       .sort(sortOption)
//       .lean();

//     // ✅ Flatten sizes to size-level records
//     const flattenedSizes = productVariants.flatMap((variant) =>
//       variant.sizes.map((size) => ({
//         _id: variant._id, // ProductVariant ID
//         sizeId: size._id, // ✅ Add Size ID explicitly
//         color: variant.color,
//         isPublished: variant.isPublished,
//         images: variant.images,
//         averageRating: variant.averageRating,
//         totalReviews: variant.totalReviews,
//         productId: variant.productId,
//         size: size.size,
//         sku: size.sku,
//         stock: size.stock,
//         price: size.price ? Number(size.price) : 0, // ✅ Convert Decimal128 to Number
//         salePrice: size.salePrice ? Number(size.salePrice) : null, // ✅ Convert & Include salePrice
//         discountEndDate: size.discountEndDate || null,
//       }))
//     );


//     const total = flattenedSizes.length;
//     const sellableCount = flattenedSizes.filter((item) => item.stock > 0).length;

//     // ✅ Paginate at size level
//     const paginatedData = flattenedSizes.slice(skip, skip + limitNum);

//     res.json({
//       success: true,
//       total,
//       sellableCount,
//       page: pageNum,
//       totalPages: Math.ceil(total / limitNum),
//       data: paginatedData,
//     });
//   } catch (err) {
//     console.error('Error fetching product sizes:', err);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };


exports.getAllProducts = async (req, res) => {
  try {
    const {
      search = '',
      city,
      state,
      country,
      minorityType,
      categorySlug,
      businessId,
      sort,
      offers,
      page = 1,
      limit = 10,
      outOfStock = false,
      showUnpublished = 'false',
    } = req.query;

    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business ID is required' });
    }

    const filters = { businessId, ownerId: req.user._id };

    if (search) {
      filters.$or = [
        { 'productId.title': { $regex: search, $options: 'i' } },
        { 'productId.description': { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['address.city'] = { $regex: city, $options: 'i' };
    if (state) filters['address.state'] = { $regex: state, $options: 'i' };
    if (country) filters['address.country'] = { $regex: country, $options: 'i' };

    if (categorySlug) {
      const category = await ProductCategory.findOne({ slug: categorySlug });
      if (category) {
        filters.categoryId = category._id;
      } else {
        return res.json({ success: true, total: 0, sellableCount: 0, page: 1, totalPages: 0, data: [] });
      }
    }

    if (offers === 'true') filters.features = { $in: ['Offers Available'] };
    if (outOfStock === 'true') filters['sizes.stock'] = { $lte: 0 };
    if (showUnpublished === 'true') filters.isPublished = false;
    filters.isDeleted = false;


    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { 'sizes.price': 1 };
    if (sort === 'price_desc') sortOption = { 'sizes.price': -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const productVariants = await ProductVariant.find(filters)
      .select('color label sizes isPublished images totalReviews averageRating')
      .populate('productId', 'title description coverImage')
      .sort(sortOption)
      .lean();

    const groupedProductsMap = {};
    let sellableCount = 0;

    for (const variant of productVariants) {
      const productId = variant.productId?._id?.toString();
      if (!productId) continue;

      if (!groupedProductsMap[productId]) {
        groupedProductsMap[productId] = {
          _id: productId,
          title: variant.productId.title,
          description: variant.productId.description,
          coverImage: variant.productId.coverImage,
          variants: [],
        };
      }

      const sizes = variant.sizes.map(size => ({
        sizeId: size._id,
        size: size.size,
        sku: size.sku,
        stock: size.stock,
        price: size.price ? Number(size.price) : 0,
        salePrice: size.salePrice ? Number(size.salePrice) : null,
        discountEndDate: size.discountEndDate || null,
      }));

      groupedProductsMap[productId].variants.push({
        variantId: variant._id,
        color: variant.color,
        label: variant.label,
        isPublished: variant.isPublished,
        images: variant.images,
        averageRating: variant.averageRating,
        totalReviews: variant.totalReviews,
        sizes,
      });

      // ✅ Count if this variant is sellable
      if (
        variant.sizes.some(s => s.stock > 0)
      ) {
        sellableCount++;
      }
    }

    const groupedProducts = Object.values(groupedProductsMap);
    const total = groupedProducts.length;
    const totalVariants = productVariants.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const totalPages = Math.ceil(total / limitNum);

    const paginatedData = groupedProducts.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      total,
      totalVariants,
      sellableCount,
      page: pageNum,
      totalPages,
      data: paginatedData,
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
