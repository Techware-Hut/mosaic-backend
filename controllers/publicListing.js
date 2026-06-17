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

const getVisibleBusinessIds = async () => {
  const businesses = await Business.find({
    isActive: true,
  }).select('_id').lean();

  return businesses.map((business) => business._id.toString());
};

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
    } = req.query;

    const filters = {};
    const badgeValueMap = {
      silver: 'Silver',
      gold: 'Gold',
      platinum: 'Platinum',
      diamond: 'Diamond',
    };

    // Search
    if (search) {
      filters.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'services.name': { $regex: search, $options: 'i' } },
      ];
    }

    if (minorityType) filters.minorityType = minorityType;
    if (city) filters['contact.address'] = { $regex: city, $options: 'i' };

    const visibleBusinessIds = await getVisibleBusinessIds();
    if (!visibleBusinessIds.length) {
      return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
    }

    if (businessId) {
      if (!visibleBusinessIds.includes(String(businessId))) {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
      filters.businessId = businessId;
    } else {
      filters.businessId = { $in: visibleBusinessIds };
    }

    // Category filtering - accept both slug and ID
    if (categoryId) {
      filters.categoryId = categoryId;
    } else if (categorySlug) {
      const category = await ServiceCategory.findOne({ slug: categorySlug });
      if (category) {
        filters.categoryId = category._id;
      } else {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
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

    // Badge filtering via Business badge
    if (badge) {
      const requestedBadges = (Array.isArray(badge) ? badge : [badge])
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .map((value) => badgeValueMap[value] || value);

      const badgeBusinesses = await Business.find({
        isActive: true,
        badge: { $in: requestedBadges }
      }).select('_id').lean();

      const badgeBusinessIds = badgeBusinesses.map((b) => b._id.toString());

      if (!badgeBusinessIds.length) {
        return res.json({
          success: true,
          total: 0,
          page: parseInt(page),
          totalPages: 0,
          data: [],
        });
      }

      if (filters.businessId) {
        if (!badgeBusinessIds.includes(String(filters.businessId))) {
          return res.json({
            success: true,
            total: 0,
            page: parseInt(page),
            totalPages: 0,
            data: [],
          });
        }
      } else {
        filters.businessId = { $in: badgeBusinessIds };
      }
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };
    if (sort === 'reviews') sortOption = { totalReviews: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let services = await Service.find(filters)
      .select('title services averageRating totalReviews slug description contact.address coverImage location price businessId')
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const serviceBusinessIds = [...new Set(
      services
        .map((service) => service.businessId?.toString())
        .filter(Boolean)
    )];

    const serviceBusinesses = await Business.find({
      _id: { $in: serviceBusinessIds },
      isActive: true,
    })
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
      
      return {
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
            twitter: vendorInfo?.twitter || businessInfo?.socialLinks?.twitter || null
          },
          contactPerson: {
            name: vendorInfo?.primaryContactName || null,
            designation: vendorInfo?.primaryContactDesignation || null
          },
          badge: businessInfo?.badge || null
        }
      };
    });

    const total = await Service.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
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
      .populate('categories.categoryId', 'name')
      .populate('ownerId', 'businessName');

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

    const visibleBusiness = await Business.findOne({
      _id: service.businessId?._id,
      isActive: true,
    }).select('_id').lean();

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
        service: serviceData,
        business: business, // ✅ now includes badge
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
    } = req.query;

    const filters = {};
    const badgeValueMap = {
      silver: 'Silver',
      gold: 'Gold',
      platinum: 'Platinum',
      diamond: 'Diamond',
    };

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

    if (businessId) filters.businessId = businessId;

    // Category filtering
    if (categoryId) {
      filters.categoryId = categoryId;
    } else if (categorySlug) {
      const category = await FoodCategory.findOne({ slug: categorySlug });
      if (!category) {
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
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
    if (price) {
      const priceRange = price.split('-');
      if (priceRange.length === 2) {
        const minPrice = parseFloat(priceRange[0]);
        const maxPrice = parseFloat(priceRange[1]);
        filters.price = { $gte: minPrice, $lte: maxPrice };
      }
    } else {
      filters.price = { $gte: 0, $lte: 200 };
    }

    // Badge filtering
    if (badge) {
      const requestedBadges = (Array.isArray(badge) ? badge : [badge])
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .map((value) => badgeValueMap[value] || value);

      const badgeBusinesses = await Business.find({
        badge: { $in: requestedBadges }
      }).select('_id').lean();

      const badgeBusinessIds = badgeBusinesses.map((b) => b._id);

      if (!badgeBusinessIds.length) {
        return res.json({
          success: true,
          total: 0,
          page: parseInt(page),
          totalPages: 0,
          data: [],
        });
      }

      filters.businessId = { $in: badgeBusinessIds };
    }

    // Sorting
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch foods with business info
const foodItems = await Food.find(filters)
  .select('title description price slug coverImage businessId')
  .populate({
    path: 'businessId',
    select: 'businessName phone email description badge logo', // <- include badge here
  })
  .sort(sortOption)
  .skip(skip)
  .limit(parseInt(limit))
  .lean();

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

    const visibleBusiness = await Business.findOne({
      _id: food.businessId?._id,
      isActive: true,
    }).select('_id').lean();

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
        food: foodData,
        business: business, // includes badge
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

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildKeywordRegex = (value = '') => new RegExp(escapeRegex(value.trim()), 'i');

const buildFlexibleMatchRegex = (value = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/[-_,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ').filter(Boolean);

  if (tokens.length > 1) {
    return new RegExp(tokens.map(escapeRegex).join('[\\s,-]*'), 'i');
  }

  if (normalized.length >= 5) {
    return new RegExp(normalized.split('').map(escapeRegex).join('[\\s,-]*'), 'i');
  }

  return new RegExp(escapeRegex(normalized), 'i');
};

const resolveBusinessIdsByKeyword = async (keyword) => {
  const keywordRegex = buildFlexibleMatchRegex(keyword);
  if (!keywordRegex) {
    return [];
  }

  const [businessMatches, vendorMatches] = await Promise.all([
    Business.find({
      isActive: true,
      $or: [
        { businessName: keywordRegex },
        { description: keywordRegex },
        { tags: keywordRegex },
      ],
    }).select('_id').lean(),
    VendorOnboardingStage1.find({
      businessId: { $exists: true, $ne: null },
      $or: [
        { businessName: keywordRegex },
        { businessBio: keywordRegex },
      ],
    }).select('businessId').lean(),
  ]);

  return [...new Set([
    ...businessMatches.map((item) => item._id.toString()),
    ...vendorMatches.map((item) => item.businessId?.toString()).filter(Boolean),
  ])].map((id) => new mongoose.Types.ObjectId(id));
};

const resolveBusinessIdsForPublicSearch = async ({ location, minorityType }) => {
  if (!location && !minorityType) {
    return null;
  }

  const normalizedMinority = minorityType.replace(/-/g, ' ').trim();
  const locationRegex = location ? buildFlexibleMatchRegex(location) : null;
  const minorityRegex = minorityType ? buildFlexibleMatchRegex(normalizedMinority) : null;

  let minorityTypeIds = [];
  if (minorityType) {
    if (mongoose.Types.ObjectId.isValid(minorityType)) {
      minorityTypeIds.push(new mongoose.Types.ObjectId(minorityType));
    }

    const minorityMatches = await MinorityType.find({
      name: minorityRegex,
      isActive: true,
    }).select('_id').lean();

    minorityTypeIds.push(...minorityMatches.map((item) => item._id));
    minorityTypeIds = [...new Set(minorityTypeIds.map((id) => id.toString()))]
      .map((id) => new mongoose.Types.ObjectId(id));
  }

  const matchedSets = [];

  if (locationRegex) {
    const [businessLocationMatches, vendorLocationMatches] = await Promise.all([
      Business.find({
        isActive: true,
        $or: [
          { businessName: locationRegex },
          { 'address.street': locationRegex },
          { 'address.city': locationRegex },
          { 'address.state': locationRegex },
          { 'address.country': locationRegex },
        ],
      }).select('_id').lean(),
      VendorOnboardingStage1.find({
        businessId: { $exists: true, $ne: null },
        $or: [
          { businessName: locationRegex },
          { 'address.street': locationRegex },
          { 'address.city': locationRegex },
          { 'address.state': locationRegex },
          { 'address.country': locationRegex },
        ],
      }).select('businessId').lean(),
    ]);

    const locationIds = new Set([
      ...businessLocationMatches.map((item) => item._id.toString()),
      ...vendorLocationMatches.map((item) => item.businessId?.toString()).filter(Boolean),
    ]);

    matchedSets.push(locationIds);
  }

  if (minorityType) {
    const [businessMinorityMatches, vendorMinorityMatches] = await Promise.all([
      Business.find({
        isActive: true,
        ...(minorityTypeIds.length ? { minorityType: { $in: minorityTypeIds } } : { _id: null }),
      }).select('_id').lean(),
      VendorOnboardingStage1.find({
        businessId: { $exists: true, $ne: null },
        minorityCategories: { $elemMatch: { $regex: minorityRegex } },
      }).select('businessId').lean(),
    ]);

    const minorityIds = new Set([
      ...businessMinorityMatches.map((item) => item._id.toString()),
      ...vendorMinorityMatches.map((item) => item.businessId?.toString()).filter(Boolean),
    ]);

    matchedSets.push(minorityIds);
  }

  if (!matchedSets.length) {
    return null;
  }

  const [firstSet, ...restSets] = matchedSets;
  const intersectedIds = [...firstSet].filter((id) => restSets.every((set) => set.has(id)));

  if (!intersectedIds.length) {
    return [];
  }

  return intersectedIds.map((id) => new mongoose.Types.ObjectId(id));
};

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
    } = req.query;

    const filters = { isDeleted: false, isPublished: true };
    const badgeValueMap = {
      silver: 'Silver',
      gold: 'Gold',
      platinum: 'Platinum',
      diamond: 'Diamond',
    };

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
        return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
      }
      filters.businessId = businessId;
    } else {
      filters.businessId = { $in: visibleBusinessIds };
    }

    // Category filtering - accept both slug and ID
    if (categoryId) {
      filters.categoryId = categoryId;
    } else if (categorySlug) {
      const category = await ProductCategory.findOne({ slug: categorySlug });
      if (category) filters.categoryId = category._id;
      else return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
    }

    // Subcategory filtering - accept both slug and ID
    if (subcategoryId) {
      filters.subcategoryId = subcategoryId;
    } else if (subcategorySlug) {
      const subcategory = await ProductSubcategory.findOne({ slug: subcategorySlug });
      if (subcategory) filters.subcategoryId = subcategory._id;
      else return res.json({ success: true, total: 0, page: parseInt(page), totalPages: 0, data: [] });
    }

    if (offers === 'true') filters.features = { $in: ['Offers Available'] };
    if (outOfStock === 'true') filters.stockQuantity = { $lte: 0 };

    // Price filtering
    // if (price) {
    //   const priceRange = price.split('-');
    //   if (priceRange.length === 2) {
    //     const minPrice = parseFloat(priceRange[0]);
    //     const maxPrice = parseFloat(priceRange[1]);
    //     filters.price = { $gte: minPrice, $lte: maxPrice };
    //   }
    // } else {
    //   filters.price = { $gte: 0, $lte: 200 };
    // }
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

    // Badge filtering via Business badge
    if (badge) {
      const requestedBadges = (Array.isArray(badge) ? badge : [badge])
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .map((value) => badgeValueMap[value] || value);

      const badgeBusinesses = await Business.find({
        isActive: true,
        badge: { $in: requestedBadges }
      }).select('_id').lean();

      const badgeBusinessIds = badgeBusinesses.map((b) => b._id.toString());

      if (!badgeBusinessIds.length) {
        return res.json({
          success: true,
          total: 0,
          page: parseInt(page),
          totalPages: 0,
          data: [],
        });
      }

      if (filters.businessId) {
        if (!badgeBusinessIds.includes(String(filters.businessId))) {
          return res.json({
            success: true,
            total: 0,
            page: parseInt(page),
            totalPages: 0,
            data: [],
          });
        }
      } else {
        filters.businessId = { $in: badgeBusinessIds };
      }
    }

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let products = await Product.find(filters)
      .select('title description coverImage slug brand categoryId subcategoryId price businessId')
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const businessIds = [...new Set(
      products
        .map((product) => product.businessId?.toString())
        .filter(Boolean)
    )];

    const businesses = await Business.find({
      _id: { $in: businessIds },
      isActive: true,
    })
      .select('_id badge')
      .lean();

    const badgeByBusinessId = new Map(
      businesses.map((business) => [business._id.toString(), business.badge || null])
    );

    products = products.map((product) => ({
      _id: product._id,
      title: product.title,
      description: product.description,
      coverImage: product.coverImage,
      slug: product.slug,
      brand: product.brand,
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId,
      price: product.price,
      badge: badgeByBusinessId.get(product.businessId?.toString()) || null,
    }));

    const total = await Product.countDocuments(filters);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      total,
      page: parseInt(page),
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
    } = req.query;

    const filters = { isDeleted: false, isPublished: true };

    // Category filtering - accept both slug and ID
    if (categoryId) {
      filters.categoryId = categoryId;
    } else if (categorySlug) {
      const category = await ProductCategory.findOne({ slug: categorySlug });
      if (category) filters.categoryId = category._id;
      else return res.json({ success: true, total: 0, data: [] });
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
    if (offers === 'true') filters.features = { $in: ['Offers Available'] };
    if (outOfStock === 'true') filters.stockQuantity = { $lte: 0 };

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { averageRating: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // First get products without populating variants to avoid ObjectId errors
    let products = await Product.find(filters)
      .select('title description coverImage variants slug')
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
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
            console.log('Error fetching variants for product:', product._id, variantError.message);
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

    const total = await Product.countDocuments(filters);

    res.json({
      success: true,
      total: products.length,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: products,
    });

  } catch (err) {
    console.error('Error fetching products by filters:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};





// Route: /api/products/:productId
exports.getProductById = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId)
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

    const visibleBusiness = await Business.findOne({
      _id: product.businessId?._id,
      isActive: true,
    }).select('_id').lean();

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

    res.json({
      success: true,
      data: {
        ...product,
        businessId: product.businessId?._id,
        taxCategory: productTaxCategory,
        taxRate,
        taxIncluded: true,

        // Convert product price (Decimal128 → Number)
        price: product.price ? Number(product.price) : null,
        ...productTaxPricing,

        // Clean business object (id + name)
        business: {
          businessId: product.businessId?._id,
          businessName: product.businessId?.businessName
        },

        variants: variants.map(({ _id, ...rest }) => {
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
        })
      }
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

    const business = await Business.findOne({
      _id: businessId,
      isActive: true,
    })
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
        business,
        vendorDetails: vendorOnboarding || null
      }
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

    const visibleBusiness = await Business.findOne({
      _id: businessId,
      isActive: true,
    }).select('_id').lean();

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

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.find(filters)
      .select('title description coverImage slug brand price averageRating totalReviews')
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Product.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: products
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
    const {
      keyword = '',
      search = '',
      location = '',
      minorityType = '',
      limit = 10,
    } = req.query;

    const trimmedKeyword = String(keyword || search || '').trim();
    const trimmedLocation = String(location || '').trim();
    const trimmedMinorityType = String(minorityType || '').trim();
    const parsedLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));

    const [filteredBusinessIds, keywordBusinessIds] = await Promise.all([
      resolveBusinessIdsForPublicSearch({
        location: trimmedLocation,
        minorityType: trimmedMinorityType,
      }),
      trimmedKeyword ? resolveBusinessIdsByKeyword(trimmedKeyword) : Promise.resolve([]),
    ]);

    if (Array.isArray(filteredBusinessIds) && !filteredBusinessIds.length) {
      return res.json({
        success: true,
        filters: {
          keyword: trimmedKeyword,
          location: trimmedLocation,
          minorityType: trimmedMinorityType,
        },
        totals: {
          all: 0,
          products: 0,
          services: 0,
          foods: 0,
        },
        data: {
          products: [],
          services: [],
          foods: [],
        },
      });
    }

    const keywordRegex = trimmedKeyword ? buildKeywordRegex(trimmedKeyword) : null;

    let allowedBusinessIds = null;
    let useBusinessKeywordOnly = false;

    if (Array.isArray(filteredBusinessIds)) {
      allowedBusinessIds = filteredBusinessIds;
    }

    if (Array.isArray(allowedBusinessIds) && keywordBusinessIds.length) {
      const allowedSet = new Set(allowedBusinessIds.map((id) => id.toString()));
      allowedBusinessIds = keywordBusinessIds.filter((id) => allowedSet.has(id.toString()));
      useBusinessKeywordOnly = true;
    } else if (!Array.isArray(allowedBusinessIds) && keywordBusinessIds.length) {
      allowedBusinessIds = keywordBusinessIds;
      useBusinessKeywordOnly = true;
    }

    const baseBusinessFilter = Array.isArray(allowedBusinessIds)
      ? { businessId: { $in: allowedBusinessIds } }
      : {};

    if (Array.isArray(allowedBusinessIds) && !allowedBusinessIds.length) {
      return res.json({
        success: true,
        filters: {
          keyword: trimmedKeyword,
          location: trimmedLocation,
          minorityType: trimmedMinorityType,
        },
        totals: {
          all: 0,
          products: 0,
          services: 0,
          foods: 0,
        },
        data: {
          products: [],
          services: [],
          foods: [],
        },
      });
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

    if (keywordRegex) {
      const productKeywordOr = [
        { title: keywordRegex },
        { description: keywordRegex },
        { brand: keywordRegex },
      ];

      const serviceKeywordOr = [
        { title: keywordRegex },
        { description: keywordRegex },
        { 'services.name': keywordRegex },
        { 'services.description': keywordRegex },
      ];

      const foodKeywordOr = [
        { title: keywordRegex },
        { description: keywordRegex },
        { businessName: keywordRegex },
        { foodType: keywordRegex },
        { brand: keywordRegex },
      ];

      if (!useBusinessKeywordOnly) {
        productFilter.$or = productKeywordOr;
        serviceFilter.$or = serviceKeywordOr;
        foodFilter.$or = foodKeywordOr;
      }
    }

    const [products, services, foods] = await Promise.all([
      Product.find(productFilter)
        .select('title description coverImage slug brand price businessId')
        .populate({
          path: 'businessId',
          select: 'businessName logo badge address minorityType',
          populate: {
            path: 'minorityType',
            select: 'name',
          },
        })
        .sort({ createdAt: -1 })
        .limit(parsedLimit)
        .lean(),
      Service.find(serviceFilter)
        .select('title description services coverImage slug price location contact businessId averageRating totalReviews')
        .populate({
          path: 'businessId',
          select: 'businessName logo badge address minorityType',
          populate: {
            path: 'minorityType',
            select: 'name',
          },
        })
        .sort({ createdAt: -1 })
        .limit(parsedLimit)
        .lean(),
      Food.find(foodFilter)
        .select('title description coverImage slug price businessId foodType brand')
        .populate({
          path: 'businessId',
          select: 'businessName logo badge address minorityType',
          populate: {
            path: 'minorityType',
            select: 'name',
          },
        })
        .sort({ createdAt: -1 })
        .limit(parsedLimit)
        .lean(),
    ]);

    return res.json({
      success: true,
      filters: {
        keyword: trimmedKeyword,
        location: trimmedLocation,
        minorityType: trimmedMinorityType,
      },
      totals: {
        all: products.length + services.length + foods.length,
        products: products.length,
        services: services.length,
        foods: foods.length,
      },
      data: {
        products,
        services,
        foods,
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

