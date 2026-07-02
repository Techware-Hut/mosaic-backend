const mongoose = require('mongoose');
const Service = require('../models/Service');
const Review = require('../models/Review');
const ServiceCategory = require('../models/ServiceCategory');
const ServiceSubcategory = require('../models/ServiceSubcategory');
const Business = require('../models/Business');
const VendorOnboardingStage1 = require('../models/VendorOnboardingStage1');
const {
  getResolvedTaxCategory,
  getTaxRateForCategory,
  buildTaxAwareAmounts,
} = require('../utils/vendorTax');
const {
  toPublicListingCard,
  toPublicListingDetail,
  toPublicBusinessCard,
} = require('../lib/listing/publicListingDto');
const {
  parsePublicSearchQuery,
  detectUnsupportedGeoParams,
  shouldIncludeListingType,
  resolveBusinessIdsByKeyword,
  resolveCombinedBusinessFilters,
  intersectBusinessIdSets,
  loadVerifiedByBusinessIds,
  loadTagsByBusinessIds,
  narrowVisibleBusinessIds,
  mergeBusinessIdFilter,
  applyBadgeBusinessIdFilter,
  buildKeywordRegex,
} = require('../lib/listing/publicSearchFilters');
const {
  publicMarketplaceBusinessFilter,
} = require('../lib/marketplace/businessEligibility');
const {
  findPublicCategory,
} = require('../utils/categoryVisibility');

const getVisibleBusinessIds = async () => {
  const businesses = await Business.find(
    publicMarketplaceBusinessFilter()
  ).select('_id').lean();

  return businesses.map((business) => business._id.toString());
};

const PUBLIC_LIST_MAX_LIMIT = 50;

function clipListPagination(page, limit, defaultLimit = 10) {
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const limitN = Math.max(
    1,
    Math.min(PUBLIC_LIST_MAX_LIMIT, parseInt(limit, 10) || defaultLimit)
  );
  return { page: pageN, limit: limitN, skip: (pageN - 1) * limitN };
};

const emptyListResponse = (page = 1) => ({
  success: true,
  total: 0,
  page: parseInt(page, 10),
  totalPages: 0,
  data: [],
});

async function applyBusinessScopeToFilters(filters, visibleBusinessIds, query, explicitBusinessId, options = {}) {
  const narrowed = await narrowVisibleBusinessIds(visibleBusinessIds, query, options);
  if (narrowed.empty) return { empty: true };

  const merged = mergeBusinessIdFilter(explicitBusinessId || filters.businessId, narrowed.businessIds);
  if (merged.empty) return { empty: true };

  filters.businessId = merged.filter;
  return { empty: false };
}

async function mapProductsWithBusinessMeta(products, listingType = 'product') {
  const businessIds = [...new Set(
    products
      .map((item) => {
        const id = item.businessId?._id || item.businessId;
        return id ? String(id) : null;
      })
      .filter(Boolean)
  )];

  const [verifiedMap, tagsMap, businesses] = await Promise.all([
    loadVerifiedByBusinessIds(businessIds),
    loadTagsByBusinessIds(businessIds),
    Business.find(publicMarketplaceBusinessFilter({ _id: { $in: businessIds } }))
      .select('_id badge tags')
      .lean(),
  ]);

  const badgeByBusinessId = new Map(
    businesses.map((business) => [business._id.toString(), business.badge || null])
  );

  return products.map((product) => {
    const businessKey = product.businessId?._id
      ? String(product.businessId._id)
      : String(product.businessId || '');
    const cardOptions = { listingType };
    if (verifiedMap.has(businessKey)) cardOptions.verified = verifiedMap.get(businessKey);

    const enriched = {
      ...product,
      badge: badgeByBusinessId.get(businessKey) || product.badge || null,
    };

    if (product.businessId && typeof product.businessId === 'object' && tagsMap.has(businessKey)) {
      enriched.businessId = { ...product.businessId, tags: tagsMap.get(businessKey) };
    } else if (tagsMap.has(businessKey)) {
      enriched.tags = tagsMap.get(businessKey);
    }

    return toPublicListingCard(enriched, cardOptions);
  });
}

exports.getAllServices = async (req, res) => {
  try {
    const {
      search = '',
      city,
      state,
      country,
      minorityType,
      categorySlug,
      categoryId,
      subcategorySlug,
      subcategoryId,
      businessId,
      sort,
      openNow,
      onlineBooking,
      offers,
      page = 1,
      limit = 10,
      price,
      badge,
      tag,
      tags,
      zip,
      verified,
    } = req.query;

    const filters = { isPublished: true };

    // Search
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'services.name': { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;

    const visibleBusinessIds = await getVisibleBusinessIds();
    if (!visibleBusinessIds.length) {
      return res.json(emptyListResponse(page));
    }

    if (businessId) {
      if (!visibleBusinessIds.includes(String(businessId))) {
        return res.json(emptyListResponse(page));
      }
      filters.businessId = businessId;
    } else {
      filters.businessId = { $in: visibleBusinessIds };
    }

    const scoped = await applyBusinessScopeToFilters(
      filters,
      visibleBusinessIds,
      req.query,
      businessId,
      { includeLocation: true }
    );
    if (scoped.empty) {
      return res.json(emptyListResponse(page));
    }

    // Category filtering - accept both slug and ID
    if (categoryId || categorySlug) {
      const category = await findPublicCategory(ServiceCategory, {
        id: categoryId,
        slug: categorySlug,
      });
      if (!category) {
        return res.json(emptyListResponse(page));
      }
      filters.categoryId = category._id;
    }

    // Subcategory filtering - accept both slug and ID
    if (subcategoryId) {
      filters.subcategoryId = subcategoryId;
    } else if (subcategorySlug) {
      const subcategory = await ServiceSubcategory.findOne({ slug: subcategorySlug });
      if (subcategory) {
        filters.subcategoryId = subcategory._id;
      } else {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
    }

    if (onlineBooking === 'true') filters.features = { $in: ['Online Booking'] };
    if (offers === 'true') filters.features = { $in: ['Offers Available'] };

    // Price filtering
    if (price) {
      const priceRange = price.split('-');
      if (priceRange.length === 2) {
        const minPrice = parseFloat(priceRange[0]);
        const maxPrice = parseFloat(priceRange[1]);
        filters.price = { $gte: minPrice, $lte: maxPrice };
      }
    }

    const badgeScoped = await applyBadgeBusinessIdFilter(filters, badge);
    if (badgeScoped.empty) {
      return res.json(emptyListResponse(page));
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };
    if (sort === 'reviews') sortOption = { totalReviews: -1 };

    const { page: pageN, limit: limitN, skip } = clipListPagination(page, limit);

    let services = await Service.find(filters)
      .select('title services averageRating totalReviews slug description contact.address coverImage location price businessId')
      .sort(sortOption)
      .skip(skip)
      .limit(limitN)
      .lean();

    const serviceBusinessIds = [...new Set(
      services
        .map((service) => service.businessId?.toString())
        .filter(Boolean)
    )];

    const serviceBusinesses = await Business.find(
      publicMarketplaceBusinessFilter({ _id: { $in: serviceBusinessIds } })
    )
      .select('_id businessName description logo email phone address socialLinks badge')
      .lean();

    const vendorDetails = await VendorOnboardingStage1.find({ businessId: { $in: serviceBusinessIds } })
      .select('businessId businessBio primaryContactName primaryContactDesignation website facebook instagram linkedin twitter businessEmail businessPhone')
      .lean();

    const businessDetailsMap = new Map(
      serviceBusinesses.map((business) => [business._id.toString(), business])
    );

    const vendorDetailsMap = new Map(
      vendorDetails.map((vendor) => [vendor.businessId?.toString(), vendor])
    );

    services = services.map((service) => {
      const businessId = service.businessId?.toString();
      const businessInfo = businessDetailsMap.get(businessId);
      const vendorInfo = vendorDetailsMap.get(businessId);

      return toPublicListingCard(
        {
          ...service,
          businessDetails: {
            businessName: businessInfo?.businessName || null,
            description: businessInfo?.description || null,
            bio: vendorInfo?.businessBio || null,
            logo: businessInfo?.logo || null,
            email: businessInfo?.email || vendorInfo?.businessEmail || null,
            phone: businessInfo?.phone || vendorInfo?.businessPhone || null,
            address: businessInfo?.address || null,
            socialLinks: {
              website: vendorInfo?.website || businessInfo?.socialLinks?.website || null,
              facebook: vendorInfo?.facebook || businessInfo?.socialLinks?.facebook || null,
              instagram: vendorInfo?.instagram || businessInfo?.socialLinks?.instagram || null,
              linkedin: vendorInfo?.linkedin || businessInfo?.socialLinks?.linkedin || null,
              twitter: vendorInfo?.twitter || businessInfo?.socialLinks?.twitter || null,
            },
            contactPerson: {
              name: vendorInfo?.primaryContactName || null,
              designation: vendorInfo?.primaryContactDesignation || null,
            },
            badge: businessInfo?.badge || null,
          },
        },
        { listingType: 'service' }
      );
    });

    const total = await Service.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: pageN,
      totalPages: Math.ceil(total / limitN),
      data: services,
    });
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// GET /api/public/services/:slug

exports.getServiceBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const service = await Service.findOne({ slug, isPublished: true })
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate('ownerId', 'name');

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const visibleBusiness = await Business.findOne(
      publicMarketplaceBusinessFilter({ _id: service.businessId })
    ).select('_id').lean();

    if (!visibleBusiness) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const reviews = await Review.find({
      listingId: service._id,
      listingType: 'service',
    })
      .populate('userId', 'name profileImage');

    const serviceData = service.toObject();

    res.status(200).json({
      success: true,
      data: {
        service: toPublicListingDetail(serviceData, { listingType: 'service' }),
        reviews,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findById(id)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate({
        path: 'businessId',
        select: `
          _id
          businessName
          slug
          description
          logo
          coverImage
          email
          phone
          address
          socialLinks
          badge
        `,
      });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    if (service.isPublished !== true) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    const visibleBusiness = await Business.findOne(
      publicMarketplaceBusinessFilter({ _id: service.businessId?._id })
    ).select('_id').lean();

    if (!visibleBusiness) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    const vendorInfo = await VendorOnboardingStage1.findOne({
      businessId: service.businessId?._id,
    })
      .select('website address refundPolicyDocument termsDocument googleReviewLink')
      .lean();

    const business = service.businessId?.toObject
      ? service.businessId.toObject()
      : service.businessId;

    const resolvedAddress = business?.address || vendorInfo?.address || null;
    const resolvedWebsite =
      business?.socialLinks?.website || vendorInfo?.website || null;

    if (business) {
      business.address = resolvedAddress;
      business.website = resolvedWebsite;
      business.refundPolicyDocument = vendorInfo?.refundPolicyDocument || null;
      business.termsDocument = vendorInfo?.termsDocument || null;
      business.googleReviewLink = vendorInfo?.googleReviewLink || null;
      business.socialLinks = {
        ...(business.socialLinks || {}),
        website: resolvedWebsite,
      };
    }

    const serviceData = service.toObject();
    delete serviceData.businessId;

    res.status(200).json({
      success: true,
      data: {
        service: toPublicListingDetail(serviceData, { listingType: 'service' }),
        business: business ? toPublicBusinessCard(business) : null,
      },
    });

  } catch (err) {
    console.error("Get Service By ID Error:", err);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// exports.getServiceById = async (req, res) => {
//   try {
//     const { id } = req.params;

//     console.log("Incoming ID:", id);

//     const service = await Service.findById(id);

//     console.log("Found Service:", service);

//     if (!service) {
//       return res.status(404).json({
//         success: false,
//         message: 'Service not found',
//       });
//     }

//     res.status(200).json({
//       success: true,
//       data: service,
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//     });
//   }
// };




// controllers/publicListing.js



const Food = require('../models/Food');
const FoodCategory = require('../models/FoodCategory');
const FoodSubcategory = require('../models/FoodSubcategory');

exports.getAllFood = async (req, res) => {
  try {
    const {
      search = '',
      city,
      state,
      country,
      minorityType,
      categorySlug,
      categoryId,
      subcategorySlug,
      subcategoryId,
      businessId,
      sort,
      offers,
      page = 1,
      limit = 10,
      outOfStock = false,
      price,
      badge,
      tag,
      tags,
      zip,
      verified,
    } = req.query;

    const filters = { isPublished: true };

    // Search filter
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['address.city'] = { $regex: city, $options: 'i' };
    if (state) filters['address.state'] = { $regex: state, $options: 'i' };
    if (country) filters['address.country'] = { $regex: country, $options: 'i' };

    const visibleBusinessIds = await getVisibleBusinessIds();
    if (!visibleBusinessIds.length) {
      return res.json(emptyListResponse(page));
    }

    if (businessId) {
      if (!visibleBusinessIds.includes(String(businessId))) {
        return res.json(emptyListResponse(page));
      }
      filters.businessId = businessId;
    } else {
      filters.businessId = { $in: visibleBusinessIds };
    }

    const scoped = await applyBusinessScopeToFilters(
      filters,
      visibleBusinessIds,
      req.query,
      businessId,
      { includeLocation: false }
    );
    if (scoped.empty) {
      return res.json(emptyListResponse(page));
    }

    // Category filtering
    if (categoryId || categorySlug) {
      const category = await findPublicCategory(FoodCategory, {
        id: categoryId,
        slug: categorySlug,
      });
      if (!category) {
        return res.json(emptyListResponse(page));
      }
      filters.categoryId = category._id;
    }

    // Subcategory filtering
    if (subcategoryId) {
      filters.subcategoryId = subcategoryId;
    } else if (subcategorySlug) {
      const subcategory = await FoodSubcategory.findOne({ slug: subcategorySlug });
      if (!subcategory) {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
      filters.subcategoryId = subcategory._id;
    }

    // Offers
    if (offers === 'true') filters.features = { $in: ['Offers Available'] };

    // Out of stock
    if (outOfStock === 'true') {
      filters.stockQuantity = { $lte: 0 };
    }

    // Price
    if (price === 'all') {
      // Explicit opt-out of default MVP price window
    } else if (price) {
      const priceRange = price.split('-');
      if (priceRange.length === 2) {
        const minPrice = parseFloat(priceRange[0]);
        const maxPrice = parseFloat(priceRange[1]);
        filters.price = { $gte: minPrice, $lte: maxPrice };
      }
    } else {
      filters.price = { $gte: 0, $lte: 200 };
    }

    const badgeScoped = await applyBadgeBusinessIdFilter(filters, badge);
    if (badgeScoped.empty) {
      return res.json(emptyListResponse(page));
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const { page: pageN, limit: limitN, skip } = clipListPagination(page, limit);

    // Fetch foods with business info
const foodItems = await Food.find(filters)
  .select('title description price slug coverImage businessId')
  .populate({
    path: 'businessId',
    select: 'businessName phone email description badge logo', // <- include badge here
  })
  .sort(sortOption)
  .skip(skip)
  .limit(limitN)
  .lean();

    const total = await Food.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: pageN,
      totalPages: Math.ceil(total / limitN),
      data: foodItems.map((food) => toPublicListingCard(food, { listingType: 'food' })),
    });

  } catch (err) {
    console.error('Error fetching food items:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};  



exports.getFoodById = async (req, res) => {
  try {
    const { id } = req.params;

    const food = await Food.findById(id)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .populate({
        path: 'businessId',
        select: `
          _id
          businessName
          slug
          description
          logo
          coverImage
          email
          phone
          address
          socialLinks
          badge
        `,
      });

    if (!food) {
      return res.status(404).json({
        success: false,
        message: 'Food item not found',
      });
    }

    const visibleBusiness = await Business.findOne(
      publicMarketplaceBusinessFilter({ _id: food.businessId?._id })
    ).select('_id').lean();

    if (!visibleBusiness) {
      return res.status(404).json({
        success: false,
        message: 'Food item not found',
      });
    }

    const vendorInfo = await VendorOnboardingStage1.findOne({
      businessId: food.businessId?._id,
    })
      .select('website address refundPolicyDocument termsDocument googleReviewLink')
      .lean();

    const business = food.businessId?.toObject
      ? food.businessId.toObject()
      : food.businessId;

    const resolvedAddress = business?.address || vendorInfo?.address || null;
    const resolvedWebsite =
      business?.socialLinks?.website || vendorInfo?.website || null;

    if (business) {
      business.address = resolvedAddress;
      business.website = resolvedWebsite;
      business.refundPolicyDocument = vendorInfo?.refundPolicyDocument || null;
      business.termsDocument = vendorInfo?.termsDocument || null;
      business.googleReviewLink = vendorInfo?.googleReviewLink || null;
      business.socialLinks = {
        ...(business.socialLinks || {}),
        website: resolvedWebsite,
      };
    }

    const foodData = food.toObject();
    delete foodData.businessId;

    res.status(200).json({
      success: true,
      data: {
        food: toPublicListingDetail(foodData, { listingType: 'food' }),
        business: business ? toPublicBusinessCard(business) : null,
      },
    });

  } catch (err) {
    console.error("Get Food By ID Error:", err);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// exports.getAllFood = async (req, res) => {
//   try {
//     const {
//       search = '',
//       city,
//       state,
//       country,
//       minorityType,
//       categorySlug,
//       categoryId,
//       subcategorySlug,
//       subcategoryId,
//       businessId,
//       sort,
//       offers,
//       page = 1,
//       limit = 10,
//       outOfStock = false,
//       price,
//       badge,
//     } = req.query;

//     const filters = {};
//     const badgeValueMap = {
//       silver: 'Silver',
//       gold: 'Gold',
//       platinum: 'Platinum',
//       diamond: 'Diamond',
//     };

//     // Search filter
//     if (search) {
//       filters.$or = [
//         { title: { $regex: search, $options: 'i' } },
//         { description: { $regex: search, $options: 'i' } },
//       ];
//     }

//     // Filter by minorityType, city, state, and country
//     if (minorityType) filters.minorityType = minorityType;
//     if (city) filters['address.city'] = { $regex: city, $options: 'i' };
//     if (state) filters['address.state'] = { $regex: state, $options: 'i' };
//     if (country) filters['address.country'] = { $regex: country, $options: 'i' };

//     // Filter by businessId
//     if (businessId) filters.businessId = businessId;

//     // Category filtering - accept both slug and ID
//     if (categoryId) {
//       filters.categoryId = categoryId;
//     } else if (categorySlug) {
//       const category = await FoodCategory.findOne({ slug: categorySlug });
//       if (category) {
//         filters.categoryId = category._id;
//       } else {
//         return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
//       }
//     }

//     // Subcategory filtering - accept both slug and ID
//     if (subcategoryId) {
//       filters.subcategoryId = subcategoryId;
//     } else if (subcategorySlug) {
//       const subcategory = await FoodSubcategory.findOne({ slug: subcategorySlug });
//       if (subcategory) {
//         filters.subcategoryId = subcategory._id;
//       } else {
//         return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
//       }
//     }

//     // Offers filter
//     if (offers === 'true') filters.features = { $in: ['Offers Available'] };

//     // Out of stock filter
//     if (outOfStock === 'true') {
//       filters.stockQuantity = { $lte: 0 };  // Assuming stockQuantity tracks available stock
//     }

//     // Price filtering
//     if (price) {
//       const priceRange = price.split('-');
//       if (priceRange.length === 2) {
//         const minPrice = parseFloat(priceRange[0]);
//         const maxPrice = parseFloat(priceRange[1]);
//         filters.price = { $gte: minPrice, $lte: maxPrice };
//       }
//     } else {
//       filters.price = { $gte: 0, $lte: 200 };
//     }

//     // Badge filtering via Business badge
//     if (badge) {
//       const requestedBadges = (Array.isArray(badge) ? badge : [badge])
//         .flatMap((value) => String(value || '').split(','))
//         .map((value) => value.trim().toLowerCase())
//         .filter(Boolean)
//         .map((value) => badgeValueMap[value] || value);

//       const badgeBusinesses = await Business.find({
//         badge: { $in: requestedBadges }
//       }).select('_id').lean();

//       const badgeBusinessIds = badgeBusinesses.map((b) => b._id.toString());

//       if (!badgeBusinessIds.length) {
//         return res.json({
//           success: true,
//           total: 0,
//           page: parseInt(page),
//           totalPages: 0,
//           data: [],
//         });
//       }

//       if (filters.businessId) {
//         if (!badgeBusinessIds.includes(String(filters.businessId))) {
//           return res.json({
//             success: true,
//             total: 0,
//             page: parseInt(page),
//             totalPages: 0,
//             data: [],
//           });
//         }
//       } else {
//         filters.businessId = { $in: badgeBusinessIds };
//       }
//     }

//     // Sorting logic
//     let sortOption = { createdAt: -1 };
//     if (sort === 'price_asc') sortOption = { price: 1 };
//     if (sort === 'price_desc') sortOption = { price: -1 };
//     if (sort === 'rating') sortOption = { averageRating: -1 };

//     // Pagination logic
//     const skip = (parseInt(page) - 1) * parseInt(limit);

//     // Fetching food items based on filters
//     let foodItems = await Food.find(filters)
//       .select('title description price slug coverImage businessId')
//       .sort(sortOption)
//       .skip(skip)
//       .limit(parseInt(limit))
//       .lean();

//     const foodBusinessIds = [...new Set(
//       foodItems
//         .map((food) => food.businessId?.toString())
//         .filter(Boolean)
//     )];

//     const foodBusinesses = await Business.find({ _id: { $in: foodBusinessIds } })
//       .select('_id badge')
//       .lean();

//     const foodBadgeByBusinessId = new Map(
//       foodBusinesses.map((business) => [business._id.toString(), business.badge || null])
//     );

//     foodItems = foodItems.map((food) => ({
//       ...food,
//       badge: foodBadgeByBusinessId.get(food.businessId?.toString()) || null,
//     }));

//     const total = await Food.countDocuments(filters);

//     res.json({
//       success: true,
//       total,
//       page: parseInt(page),
//       totalPages: Math.ceil(total / limit),
//       data: foodItems,
//     });
//   } catch (err) {
//     console.error('Error fetching food items:', err);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };



const ProductVariant = require('../models/ProductVariant');
const Product = require('../models/Product');
const ProductCategory = require('../models/ProductCategory');
const ProductSubcategory = require('../models/ProductSubcategory');
const MinorityType = require('../models/MinorityType');

async function resolveCategoryIdForListingType(listingType, { categoryId, categorySlug }) {
  if (!categoryId && !categorySlug) return null;

  if (listingType === 'product') {
    const category = await findPublicCategory(ProductCategory, {
      id: categoryId,
      slug: categorySlug,
    });
    return category?._id || null;
  }
  if (listingType === 'service') {
    const category = await findPublicCategory(ServiceCategory, {
      id: categoryId,
      slug: categorySlug,
    });
    return category?._id || null;
  }
  if (listingType === 'food') {
    const category = await findPublicCategory(FoodCategory, {
      id: categoryId,
      slug: categorySlug,
    });
    return category?._id || null;
  }
  return null;
}

exports.getAllProducts = async (req, res) => {
  try {
    const {
      search = '',
      city,
      state,
      country,
      minorityType,
      categorySlug,
      categoryId,
      subcategorySlug,
      subcategoryId,
      businessId,
      sort,
      offers,
      page = 1,
      limit = 10,
      outOfStock = false,
      price,
      badge,
      tag,
      tags,
      zip,
      verified,
    } = req.query;

    const filters = { isDeleted: false, isPublished: true };

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['address.city'] = { $regex: city, $options: 'i' };
    if (state) filters['address.state'] = { $regex: state, $options: 'i' };
    if (country) filters['address.country'] = { $regex: country, $options: 'i' };

    const visibleBusinessIds = await getVisibleBusinessIds();
    if (!visibleBusinessIds.length) {
      return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
    }
    if (businessId) {
      if (!visibleBusinessIds.includes(String(businessId))) {
        return res.json(emptyListResponse(page));
      }
      filters.businessId = businessId;
    } else {
      filters.businessId = { $in: visibleBusinessIds };
    }

    const scoped = await applyBusinessScopeToFilters(
      filters,
      visibleBusinessIds,
      req.query,
      businessId,
      { includeLocation: false }
    );
    if (scoped.empty) {
      return res.json(emptyListResponse(page));
    }

    // Category filtering - accept both slug and ID
    if (categoryId || categorySlug) {
      const category = await findPublicCategory(ProductCategory, {
        id: categoryId,
        slug: categorySlug,
      });
      if (!category) return res.json(emptyListResponse(page));
      filters.categoryId = category._id;
    }

    // Subcategory filtering - accept both slug and ID
    if (subcategoryId) {
      filters.subcategoryId = subcategoryId;
    } else if (subcategorySlug) {
      const subcategory = await ProductSubcategory.findOne({ slug: subcategorySlug });
      if (subcategory) filters.subcategoryId = subcategory._id;
      else return res.json(emptyListResponse(page));
    }

    if (offers === 'true') filters.features = { $in: ['Offers Available'] };
    if (outOfStock === 'true') filters.stockQuantity = { $lte: 0 };

    // Price filtering (only apply if user sends price query)
if (price) {
  const priceRange = price.split('-');

  if (priceRange.length === 2) {
    const minPrice = parseFloat(priceRange[0]);
    const maxPrice = parseFloat(priceRange[1]);

    if (!isNaN(minPrice) && !isNaN(maxPrice)) {
      filters.price = { $gte: minPrice, $lte: maxPrice };
    }
  }
}

    const badgeScoped = await applyBadgeBusinessIdFilter(filters, badge);
    if (badgeScoped.empty) {
      return res.json(emptyListResponse(page));
    }

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const { page: pageN, limit: limitN, skip } = clipListPagination(page, limit);

    let products = await Product.find(filters)
      .select('title description coverImage slug brand categoryId subcategoryId price businessId')
      .populate('businessId', 'businessName logo badge address tags')
      .sort(sortOption)
      .skip(skip)
      .limit(limitN)
      .lean();

    products = await mapProductsWithBusinessMeta(products, 'product');

    const total = await Product.countDocuments(filters);
    const totalPages = Math.ceil(total / limitN);

    res.json({
      success: true,
      total,
      page: pageN,
      totalPages,
      data: products,
    });

  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


exports.getProductsByFilters = async (req, res) => {
  try {
    const {
      categorySlug,
      categoryId,
      subcategorySlug,
      subcategoryId,
      search = '',
      city,
      state,
      country,
      minorityType,
      businessId,
      sort,
      offers,
      page = 1,
      limit = 10,
      outOfStock = false,
      tag,
      tags,
      zip,
      verified,
    } = req.query;

    const filters = { isDeleted: false, isPublished: true };

    // Category filtering - accept both slug and ID
    if (categoryId || categorySlug) {
      const category = await findPublicCategory(ProductCategory, {
        id: categoryId,
        slug: categorySlug,
      });
      if (!category) return res.json({ success: true, total: 0, data: [] });
      filters.categoryId = category._id;
    }

    // Subcategory filtering - accept both slug and ID
    if (subcategoryId) {
      filters.subcategoryId = subcategoryId;
    } else if (subcategorySlug) {
      const subcategory = await ProductSubcategory.findOne({ slug: subcategorySlug });
      if (subcategory) filters.subcategoryId = subcategory._id;
      else return res.json({ success: true, total: 0, data: [] });
    }

    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['address.city'] = { $regex: city, $options: 'i' };
    if (state) filters['address.state'] = { $regex: state, $options: 'i' };
    if (country) filters['address.country'] = { $regex: country, $options: 'i' };

    const visibleBusinessIds = await getVisibleBusinessIds();
    if (!visibleBusinessIds.length) {
      return res.json({ success: true, total: 0, data: [] });
    }
    if (businessId) {
      if (!visibleBusinessIds.includes(String(businessId))) {
        return res.json({ success: true, total: 0, data: [] });
      }
      filters.businessId = businessId;
    } else {
      filters.businessId = { $in: visibleBusinessIds };
    }

    const scoped = await applyBusinessScopeToFilters(
      filters,
      visibleBusinessIds,
      req.query,
      businessId,
      { includeLocation: false }
    );
    if (scoped.empty) {
      return res.json({ success: true, total: 0, data: [] });
    }

    if (offers === 'true') filters.features = { $in: ['Offers Available'] };
    if (outOfStock === 'true') filters.stockQuantity = { $lte: 0 };

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const { page: pageN, limit: limitN, skip } = clipListPagination(page, limit);

    // First get products without populating variants to avoid ObjectId errors
    let products = await Product.find(filters)
      .select('title description coverImage variants slug')
      .sort(sortOption)
      .skip(skip)
      .limit(limitN)
      .lean();

    // Manually fetch variants for each product
    for (let product of products) {
      if (product.variants && product.variants.length > 0) {
        // Check if variants are ObjectIds (references) or embedded objects
        const firstVariant = product.variants[0];
        if (typeof firstVariant === 'string' || (firstVariant && firstVariant.toString)) {
          // Variants are references - fetch them
          try {
            // Filter out invalid ObjectIds
            const validVariantIds = product.variants.filter(id => {
              if (typeof id === 'string') {
                return /^[0-9a-fA-F]{24}$/.test(id); // Valid ObjectId format
              }
              return true;
            });
            
            if (validVariantIds.length > 0) {
              const variants = await ProductVariant.find({
                _id: { $in: validVariantIds },
                isPublished: true,
                isDeleted: false
              }).select('color price salePrice sku images videos totalReviews averageRating sizes').lean();
              
              product.variants = variants.map(variant => {
                if (Array.isArray(variant.sizes)) {
                  variant.sizes = variant.sizes.map(size => ({
                    ...size,
                    price: parseFloat(size?.price?.$numberDecimal || size?.price || 0),
                    salePrice: parseFloat(size?.salePrice?.$numberDecimal || size?.salePrice || 0),
                  }));
                }
                return variant;
              });
            } else {
              product.variants = [];
            }
          } catch (variantError) {
            console.warn('Error fetching variants for product:', product._id, variantError.message);
            product.variants = [];
          }
        }
        // If variants are already embedded objects, keep them as is
      } else {
        product.variants = [];
      }
    }

    // Filter out products with no variants
    products = products.filter(product => product.variants && product.variants.length > 0);

    const filteredTotal = products.length;

    res.json({
      success: true,
      total: filteredTotal,
      page: pageN,
      totalPages: Math.ceil(filteredTotal / limitN) || 0,
      data: products.map((product) => toPublicListingCard(product, { listingType: 'product' })),
    });

  } catch (err) {
    console.error('Error fetching products by filters:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};





// Route: /api/public/product/:productId
exports.getProductById = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findOne({
      _id: productId,
      isPublished: true,
      isDeleted: false,
    })
      .populate({
        path: "businessId",
        select: "businessName owner taxSettings"
      })
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const visibleBusiness = await Business.findOne(
      publicMarketplaceBusinessFilter({ _id: product.businessId?._id })
    ).select('_id').lean();

    if (!visibleBusiness) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    const variants = await ProductVariant.find({
      productId,
      isPublished: true,
      isDeleted: false
    }).lean();

    const productTaxCategory = getResolvedTaxCategory(product);
    const taxRate = getTaxRateForCategory(
      product.businessId?.taxSettings,
      productTaxCategory
    );
    const productTaxPricing = buildTaxAwareAmounts({
      priceExclTax: product.price ? Number(product.price) : null,
      salePriceExclTax: null,
      taxRate,
    });

    const mappedVariants = variants.map(({ _id, ...rest }) => {
      const variantPrice = rest.price ? Number(rest.price) : 0;
      const variantSalePrice = rest.salePrice ? Number(rest.salePrice) : null;
      const variantTaxPricing = buildTaxAwareAmounts({
        priceExclTax: variantPrice,
        salePriceExclTax: variantSalePrice,
        taxRate,
      });

      return {
        variantId: _id,
        ...rest,
        price: variantPrice,
        salePrice: variantSalePrice,
        taxCategory: productTaxCategory,
        taxRate,
        taxIncluded: true,
        ...variantTaxPricing,
        sizes: Array.isArray(rest.sizes)
          ? rest.sizes.map((size) => {
              const sizePrice = size?.price ? Number(size.price) : 0;
              const sizeSalePrice = size?.salePrice ? Number(size.salePrice) : null;
              const sizeTaxPricing = buildTaxAwareAmounts({
                priceExclTax: sizePrice,
                salePriceExclTax: sizeSalePrice,
                taxRate,
              });

              return {
                ...size,
                price: sizePrice,
                salePrice: sizeSalePrice,
                taxCategory: productTaxCategory,
                taxRate,
                taxIncluded: true,
                ...sizeTaxPricing,
              };
            })
          : [],
      };
    });

    const normalizedPrice = product.price ? Number(product.price) : null;

    res.json({
      success: true,
      data: toPublicListingDetail(
        {
          ...product,
          businessId: product.businessId?._id,
          business: {
            businessId: product.businessId?._id,
            businessName: product.businessId?.businessName,
          },
        },
        {
          listingType: 'product',
          extras: {
            taxCategory: productTaxCategory,
            taxRate,
            taxIncluded: true,
            price: normalizedPrice,
            ...productTaxPricing,
            variants: mappedVariants,
          },
        }
      ),
    });

  } catch (err) {
    console.error("Error fetching product details:", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

// exports.getProductById = async (req, res) => {
//   try {
//     const { productId } = req.params;

//     const product = await Product.findById(productId).lean();

//     if (!product) {
//       return res.status(404).json({ success: false, message: 'Product not found' });
//     }
// const variants = await ProductVariant.find({ 
//   productId, 
//   isPublished: true, 
//   isDeleted: false 
// }).lean();

//     // const variants = await ProductVariant.find({ productId, isPublished: true, isDeleted: false })
//     //   .select('color label price sku weightInKg images videos allowBackorder totalReviews averageRating sizes')
//     //   .lean();

//     res.json({
//       success: true,
//       data: {
//         _id: product._id,
//         title: product.title,
//         description: product.description,
//         brand: product.brand,
//         categoryId: product.categoryId,
//         subcategoryId: product.subcategoryId,
//         businessId: product.businessId,
//         coverImage: product.coverImage,
//         specifications: product.specifications || [],
//         isPublished: product.isPublished,
//         variants: variants.map(variant => ({
//           variantId: variant._id,
//           color: variant.color,
//           label: variant.label,
//           allowBackorder: variant.allowBackorder,
//           images: variant.images,
//           videos: variant.videos,
//           averageRating: variant.averageRating,
//           totalReviews: variant.totalReviews,
//           sizes: variant.sizes?.map((size) => ({
//             sizeId: size._id,
//             size: size.size,
//             sku: size.sku,
//             stock: size.stock,
//             price: size.price ? Number(size.price) : 0,
//             salePrice: size.salePrice ? Number(size.salePrice) : null,
//             discountEndDate: size.discountEndDate ?? null,
//           })) || [],
//         }))
//       }
//     });

//   } catch (err) {
//     console.error('Error fetching product details:', err);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };



exports.getVendorProfile = async (req, res) => {
  try {
    const { businessId } = req.params;

    const business = await Business.findOne(
      publicMarketplaceBusinessFilter({ _id: businessId })
    )
    .select('businessName description logo coverImage email phone address socialLinks website listingType badge metrics businessHours')
    .lean();

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const vendorOnboarding = await VendorOnboardingStage1.findOne({
      businessId
    })
    .select('primaryContactName primaryContactDesignation businessBio website facebook instagram linkedin tiktok twitter businessEmail businessPhone alternatePhone address yearsInBusiness ownershipType employeesCount minorityCategories googleReviewLink communityServiceLink refundPolicyDocument termsDocument')
    .lean();

    res.json({
      success: true,
      data: {
        business: toPublicBusinessCard(business),
        vendorDetails: vendorOnboarding || null,
      },
    });

  } catch (err) {
    console.error('Error fetching vendor profile:', err);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.getProductsByBusinessId = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { page = 1, limit = 10, sort } = req.query;

    const visibleBusiness = await Business.findOne(
      publicMarketplaceBusinessFilter({ _id: businessId })
    ).select('_id').lean();

    if (!visibleBusiness) {
      return res.json({
        success: true,
        total: 0,
        page: parseInt(page),
        totalPages: 0,
        data: [],
      });
    }

    const filters = { 
      businessId, 
      isDeleted: false, 
      isPublished: true 
    };

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const { page: pageN, limit: limitN, skip } = clipListPagination(page, limit);

    const products = await Product.find(filters)
      .select('title description coverImage slug brand price averageRating totalReviews')
      .sort(sortOption)
      .skip(skip)
      .limit(limitN)
      .lean();

    const total = await Product.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: pageN,
      totalPages: Math.ceil(total / limitN),
      data: products.map((product) => toPublicListingCard(product, { listingType: 'product' })),
    });

  } catch (err) {
    console.error('Error fetching products by business ID:', err);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.searchPublicListings = async (req, res) => {
  try {
    const parsed = parsePublicSearchQuery(req.query);
    const unsupported = detectUnsupportedGeoParams(req.query);
    const emptyPayload = {
      success: true,
      filters: {
        keyword: parsed.keyword,
        location: parsed.location,
        city: parsed.city,
        state: parsed.state,
        country: parsed.country,
        zip: parsed.zip,
        minorityType: parsed.minorityType,
        categoryId: parsed.categoryId,
        categorySlug: parsed.categorySlug,
        tag: parsed.tag,
        tags: parsed.tags,
        verified: parsed.verified,
        listingType: parsed.listingType,
        page: parsed.page,
        limit: parsed.limit,
        unsupported,
      },
      totals: { all: 0, products: 0, services: 0, foods: 0 },
      data: { products: [], services: [], foods: [] },
    };

    const [combinedBusinessIds, keywordBusinessIds] = await Promise.all([
      resolveCombinedBusinessFilters({
        location: parsed.location,
        city: parsed.city,
        state: parsed.state,
        country: parsed.country,
        zip: parsed.zip,
        minorityType: parsed.minorityType,
        tag: parsed.tag,
        tags: parsed.tags,
        verified: parsed.verified,
      }),
      parsed.keyword ? resolveBusinessIdsByKeyword(parsed.keyword) : Promise.resolve([]),
    ]);

    if (Array.isArray(combinedBusinessIds) && !combinedBusinessIds.length) {
      return res.json(emptyPayload);
    }

    const keywordRegex = parsed.keyword ? buildKeywordRegex(parsed.keyword) : null;

    let allowedBusinessIds = combinedBusinessIds;
    let useBusinessKeywordOnly = false;

    if (Array.isArray(allowedBusinessIds) && keywordBusinessIds.length) {
      allowedBusinessIds = intersectBusinessIdSets(allowedBusinessIds, keywordBusinessIds);
      useBusinessKeywordOnly = true;
    } else if (!Array.isArray(allowedBusinessIds) && keywordBusinessIds.length) {
      allowedBusinessIds = keywordBusinessIds;
      useBusinessKeywordOnly = true;
    }

    if (!Array.isArray(allowedBusinessIds)) {
      allowedBusinessIds = await getVisibleBusinessIds();
      if (!allowedBusinessIds.length) {
        return res.json(emptyPayload);
      }
    }

    const baseBusinessFilter = Array.isArray(allowedBusinessIds)
      ? { businessId: { $in: allowedBusinessIds } }
      : {};

    if (Array.isArray(allowedBusinessIds) && !allowedBusinessIds.length) {
      return res.json(emptyPayload);
    }

    const productFilter = {
      isDeleted: false,
      isPublished: true,
      ...baseBusinessFilter,
    };
    const serviceFilter = {
      isPublished: true,
      ...baseBusinessFilter,
    };
    const foodFilter = {
      isPublished: true,
      ...baseBusinessFilter,
    };

    if (parsed.categoryId || parsed.categorySlug) {
      let resolvedAnyCategory = false;

      if (shouldIncludeListingType(parsed.listingType, 'product')) {
        const productCategoryId = await resolveCategoryIdForListingType('product', parsed);
        if (productCategoryId) {
          productFilter.categoryId = productCategoryId;
          resolvedAnyCategory = true;
        } else {
          productFilter._id = { $exists: false };
        }
      }
      if (shouldIncludeListingType(parsed.listingType, 'service')) {
        const serviceCategoryId = await resolveCategoryIdForListingType('service', parsed);
        if (serviceCategoryId) {
          serviceFilter.categoryId = serviceCategoryId;
          resolvedAnyCategory = true;
        } else {
          serviceFilter._id = { $exists: false };
        }
      }
      if (shouldIncludeListingType(parsed.listingType, 'food')) {
        const foodCategoryId = await resolveCategoryIdForListingType('food', parsed);
        if (foodCategoryId) {
          foodFilter.categoryId = foodCategoryId;
          resolvedAnyCategory = true;
        } else {
          foodFilter._id = { $exists: false };
        }
      }

      if (!resolvedAnyCategory) {
        return res.json(emptyPayload);
      }
    }

    if (keywordRegex && !useBusinessKeywordOnly) {
      if (shouldIncludeListingType(parsed.listingType, 'product')) {
        productFilter.$or = [
          { title: keywordRegex },
          { description: keywordRegex },
          { brand: keywordRegex },
        ];
      }
      if (shouldIncludeListingType(parsed.listingType, 'service')) {
        serviceFilter.$or = [
          { title: keywordRegex },
          { description: keywordRegex },
          { 'services.name': keywordRegex },
          { 'services.description': keywordRegex },
        ];
      }
      if (shouldIncludeListingType(parsed.listingType, 'food')) {
        foodFilter.$or = [
          { title: keywordRegex },
          { description: keywordRegex },
          { businessName: keywordRegex },
          { foodType: keywordRegex },
          { brand: keywordRegex },
        ];
      }
    }

    const skip = (parsed.page - 1) * parsed.limit;
    const businessPopulate = {
      path: 'businessId',
      select: 'businessName logo badge address minorityType tags',
      populate: { path: 'minorityType', select: 'name' },
    };

    const queryJobs = [];
    if (shouldIncludeListingType(parsed.listingType, 'product')) {
      queryJobs.push(
        Product.find(productFilter)
          .select('title description coverImage slug brand price businessId categoryId')
          .populate(businessPopulate)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsed.limit)
          .lean()
      );
    } else {
      queryJobs.push(Promise.resolve([]));
    }

    if (shouldIncludeListingType(parsed.listingType, 'service')) {
      queryJobs.push(
        Service.find(serviceFilter)
          .select('title description services coverImage slug price location contact businessId averageRating totalReviews categoryId')
          .populate(businessPopulate)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsed.limit)
          .lean()
      );
    } else {
      queryJobs.push(Promise.resolve([]));
    }

    if (shouldIncludeListingType(parsed.listingType, 'food')) {
      queryJobs.push(
        Food.find(foodFilter)
          .select('title description coverImage slug price businessId foodType brand categoryId')
          .populate(businessPopulate)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsed.limit)
          .lean()
      );
    } else {
      queryJobs.push(Promise.resolve([]));
    }

    const [products, services, foods] = await Promise.all(queryJobs);

    const allBusinessIds = [...products, ...services, ...foods]
      .map((item) => item.businessId?._id || item.businessId)
      .filter(Boolean)
      .map(String);
    const verifiedMap = await loadVerifiedByBusinessIds(allBusinessIds);

    const mapCards = (items, listingType) => items.map((item) => {
      const businessKey = item.businessId?._id
        ? String(item.businessId._id)
        : String(item.businessId || '');
      const options = { listingType };
      if (verifiedMap.has(businessKey)) options.verified = verifiedMap.get(businessKey);
      return toPublicListingCard(item, options);
    });

    const productCards = mapCards(products, 'product');
    const serviceCards = mapCards(services, 'service');
    const foodCards = mapCards(foods, 'food');

    return res.json({
      success: true,
      filters: emptyPayload.filters,
      totals: {
        all: productCards.length + serviceCards.length + foodCards.length,
        products: productCards.length,
        services: serviceCards.length,
        foods: foodCards.length,
      },
      data: {
        products: productCards,
        services: serviceCards,
        foods: foodCards,
      },
    });
  } catch (err) {
    console.error('Error searching public listings:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

