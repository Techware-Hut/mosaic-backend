const FoodCategory = require('../models/FoodCategory');
const ProductCategory = require('../models/ProductCategory');
const ServiceCategory = require('../models/ServiceCategory');
const ProductSubcategory = require('../models/ProductSubcategory');
const ServiceSubcategory = require('../models/ServiceSubcategory');
const FoodSubcategory = require('../models/FoodSubcategory');
const CategoryRequest = require('../models/CategoryRequest');
const Product = require('../models/Product');
const Service = require('../models/Service');
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require('../utils/audit/actionRegistry');
const {
  recordAdminAuditSuccess,
  recordAdminAuditFailure,
  buildFieldChangeSummary,
} = require('../services/adminAuditService');

const CATEGORY_MODEL_MAP = {
  product: {
    categoryModel: ProductCategory,
    subcategoryModel: ProductSubcategory,
    approvedCategoryModel: 'ProductCategory',
    approvedSubcategoryModel: 'ProductSubcategory',
  },
  service: {
    categoryModel: ServiceCategory,
    subcategoryModel: ServiceSubcategory,
    approvedCategoryModel: 'ServiceCategory',
    approvedSubcategoryModel: 'ServiceSubcategory',
  },
  food: {
    categoryModel: FoodCategory,
    subcategoryModel: FoodSubcategory,
    approvedCategoryModel: 'FoodCategory',
    approvedSubcategoryModel: 'FoodSubcategory',
  },
};

const escapeRegex = (value = '') =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCategoryType = (value) =>
  String(value || 'product').trim().toLowerCase();

const findByNameInsensitive = async (Model, name, extraFilter = {}) =>
  Model.findOne({
    ...extraFilter,
    name: {
      $regex: `^${escapeRegex(String(name).trim())}$`,
      $options: 'i',
    },
  });

const buildCreatePayload = (Model, payload) =>
  Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => value !== undefined && Model.schema.path(key)
    )
  );


  const getAllCategoriesAdmin = async (req, res) => {
  try {
    // Fetch all categories (latest first)
    const foodCategories = await FoodCategory.find().sort({ createdAt: -1 });
    const serviceCategories = await ServiceCategory.find().sort({ createdAt: -1 });
    const productCategories = await ProductCategory.find().sort({ createdAt: -1 });

    // Fetch all subcategories
    const productSubcategories = await ProductSubcategory.find();
    const serviceSubcategories = await ServiceSubcategory.find();
    const foodSubcategories = await FoodSubcategory.find();

    // Create subcategory maps
    const createSubcategoryMap = (subcategories) => {
      const map = {};
      for (const sub of subcategories) {
        const catId = sub.category.toString();
        if (!map[catId]) map[catId] = [];
        map[catId].push({
          _id: sub._id,
          name: sub.name,
          slug: sub.slug,
          description: sub.description,
        });
      }
      return map;
    };

    const productSubMap = createSubcategoryMap(productSubcategories);
    const serviceSubMap = createSubcategoryMap(serviceSubcategories);
    const foodSubMap = createSubcategoryMap(foodSubcategories);

    // Add subcategories to categories
    const productWithSubcategories = productCategories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      img: cat.img,
      subcategories: productSubMap[cat._id.toString()] || [],
    }));

    const serviceWithSubcategories = serviceCategories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      img: cat.img,
      subcategories: serviceSubMap[cat._id.toString()] || [],
    }));

    const foodWithSubcategories = foodCategories.map((cat) => ({
      _id: cat._id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      subcategories: foodSubMap[cat._id.toString()] || [],
    }));

    return res.status(200).json({
      success: true,
      data: {
        foodCategories: foodWithSubcategories,
        serviceCategories: serviceWithSubcategories,
        productCategories: productWithSubcategories,
      },
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching categories",
      error: error.message,
    });
  }
};


// const getAllCategoriesAdmin = async (req, res) => {
//   try {
//     // Fetch all categories
//     const foodCategories = await FoodCategory.find();
//     const serviceCategories = await ServiceCategory.find();
//     const productCategories = await ProductCategory.find();

//     // Fetch all subcategories
//     const productSubcategories = await ProductSubcategory.find();
//     const serviceSubcategories = await ServiceSubcategory.find();
//     const foodSubcategories = await FoodSubcategory.find();

//     // Create subcategory maps
//     const createSubcategoryMap = (subcategories) => {
//       const map = {};
//       for (const sub of subcategories) {
//         const catId = sub.category.toString();
//         if (!map[catId]) map[catId] = [];
//         map[catId].push({
//           _id: sub._id,
//           name: sub.name,
//           slug: sub.slug,
//           description: sub.description,
//         });
//       }
//       return map;
//     };

//     const productSubMap = createSubcategoryMap(productSubcategories);
//     const serviceSubMap = createSubcategoryMap(serviceSubcategories);
//     const foodSubMap = createSubcategoryMap(foodSubcategories);

//     // Add subcategories to categories
//     const productWithSubcategories = productCategories.map((cat) => ({
//       _id: cat._id,
//       name: cat.name,
//       slug: cat.slug,
//       description: cat.description,
//       img: cat.img,
//       subcategories: productSubMap[cat._id.toString()] || [],
//     }));

//     const serviceWithSubcategories = serviceCategories.map((cat) => ({
//       _id: cat._id,
//       name: cat.name,
//       slug: cat.slug,
//       description: cat.description,
//       img: cat.img,
//       subcategories: serviceSubMap[cat._id.toString()] || [],
//     }));

//     const foodWithSubcategories = foodCategories.map((cat) => ({
//       _id: cat._id,
//       name: cat.name,
//       slug: cat.slug,
//       description: cat.description,
//       subcategories: foodSubMap[cat._id.toString()] || [],
//     }));

//     return res.status(200).json({
//       success: true,
//       data: {
//         foodCategories: foodWithSubcategories,
//         serviceCategories: serviceWithSubcategories,
//         productCategories: productWithSubcategories,
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching categories:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Error fetching categories',
//       error: error.message,
//     });
//   }
// };



// const createCategoryRequest = async (req, res) => {
//   try {
//     const {
//       categoryName,
//       subcategoryName,
//       description,
//       categoryType = 'product',
//     } = req.body;

//     if (!categoryName || !subcategoryName || !description) {
//       return res.status(400).json({
//         success: false,
//         message: 'Category name, subcategory name, and description are required',
//       });
//     }

//     const normalizedCategoryType = normalizeCategoryType(categoryType);
//     if (!CATEGORY_MODEL_MAP[normalizedCategoryType]) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid category type. Allowed values: product, service, food',
//       });
//     }

//     const trimmedCategoryName = String(categoryName).trim();
//     const trimmedSubcategoryName = String(subcategoryName).trim();

//     const existingPendingRequest = await CategoryRequest.findOne({
//       requestedBy: req.user._id,
//       categoryType: normalizedCategoryType,
//       status: 'pending',
//       categoryName: {
//         $regex: `^${escapeRegex(trimmedCategoryName)}$`,
//         $options: 'i',
//       },
//       subcategoryName: {
//         $regex: `^${escapeRegex(trimmedSubcategoryName)}$`,
//         $options: 'i',
//       },
//     });

//     if (existingPendingRequest) {
//       return res.status(409).json({
//         success: false,
//         message: 'You already have a pending request for this category and subcategory',
//       });
//     }

//     const categoryRequest = await CategoryRequest.create({
//       requestedBy: req.user._id,
//       categoryType: normalizedCategoryType,
//       categoryName: trimmedCategoryName,
//       subcategoryName: trimmedSubcategoryName,
//       description: String(description).trim(),
//     });

//     return res.status(201).json({
//       success: true,
//       message: 'Category request submitted successfully',
//       data: categoryRequest,
//     });
//   } catch (error) {
//     console.error('Error creating category request:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Error creating category request',
//       error: error.message,
//     });
//   }
// };

const createCategoryRequest = async (req, res) => {
  try {
    const {
      categoryName,
      subcategoryName,
      description,
      categoryType = 'product',
    } = req.body;

    if (!categoryName || !subcategoryName || !description) {
      return res.status(400).json({
        success: false,
        message: 'Category name, subcategory name, and description are required',
      });
    }

    const normalizedCategoryType = normalizeCategoryType(categoryType);
    if (!CATEGORY_MODEL_MAP[normalizedCategoryType]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category type. Allowed values: product, service, food',
      });
    }

    const trimmedCategoryName = String(categoryName).trim();
    const trimmedSubcategoryName = String(subcategoryName).trim();

    // Check for existing pending requests
    const existingPendingRequest = await CategoryRequest.findOne({
      requestedBy: req.user._id,
      categoryType: normalizedCategoryType,
      status: 'pending',
      categoryName: {
        $regex: `^${escapeRegex(trimmedCategoryName)}$`,
        $options: 'i',
      },
      subcategoryName: {
        $regex: `^${escapeRegex(trimmedSubcategoryName)}$`,
        $options: 'i',
      },
    });

    if (existingPendingRequest) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending request for this category and subcategory',
      });
    }

    // Create the new category request
    const categoryRequest = await CategoryRequest.create({
      requestedBy: req.user._id,
      categoryType: normalizedCategoryType,
      categoryName: trimmedCategoryName,
      subcategoryName: trimmedSubcategoryName,
      description: String(description).trim(),
    });

    // --- Send admin email notification ---
    try {
      const { sendAdminVendorCategoryRequestEmail } = require('../utils/WellcomeMailer'); // adjust path as needed
      await sendAdminVendorCategoryRequestEmail({
        adminEmail: process.env.ADMIN_EMAIL,
        requestId: categoryRequest._id,
        businessName: req.user.businessName || 'N/A', // make sure req.user has businessName
        requestedCategory: `${trimmedCategoryName} / ${trimmedSubcategoryName}`,
      });
    } catch (emailError) {
      console.error('Error sending admin email for category request:', emailError);
      // optionally continue without failing the request
    }

    return res.status(201).json({
      success: true,
      message: 'Category request submitted successfully',
      data: categoryRequest,
    });
  } catch (error) {
    console.error('Error creating category request:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating category request',
      error: error.message,
    });
  }
};

const getAllCategoryRequests = async (req, res) => {
  try {
    const filter = {};
    const { status, categoryType } = req.query;

    if (status) {
      filter.status = String(status).trim().toLowerCase();
    }

    if (categoryType) {
      const normalizedCategoryType = normalizeCategoryType(categoryType);
      if (!CATEGORY_MODEL_MAP[normalizedCategoryType]) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category type. Allowed values: product, service, food',
        });
      }
      filter.categoryType = normalizedCategoryType;
    }

    const requests = await CategoryRequest.find(filter)
      .populate('requestedBy', 'name email mobile role')
      .populate('approvedBy', 'name email')
      .populate('approvedCategory')
      .populate('approvedSubcategory')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error('Error fetching category requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching category requests',
      error: error.message,
    });
  }
};

const getMyCategoryRequests = async (req, res) => {
  try {
    const { status, categoryType } = req.query;
    const filter = { requestedBy: req.user._id };

    if (status) {
      filter.status = String(status).trim().toLowerCase();
    }

    if (categoryType) {
      const normalizedCategoryType = normalizeCategoryType(categoryType);
      if (!CATEGORY_MODEL_MAP[normalizedCategoryType]) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category type. Allowed values: product, service, food',
        });
      }
      filter.categoryType = normalizedCategoryType;
    }

    const requests = await CategoryRequest.find(filter)
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('approvedCategory')
      .populate('approvedSubcategory')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error('Error fetching vendor category requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching vendor category requests',
      error: error.message,
    });
  }
};

const approveCategoryRequest = async (req, res) => {
  try {
    const categoryRequest = await CategoryRequest.findById(req.params.id);

    if (!categoryRequest) {
      return res.status(404).json({
        success: false,
        message: 'Category request not found',
      });
    }

    if (categoryRequest.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Category request is already approved',
      });
    }

    const modelConfig = CATEGORY_MODEL_MAP[categoryRequest.categoryType];
    if (!modelConfig) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported category type on request',
      });
    }

    let category = await findByNameInsensitive(
      modelConfig.categoryModel,
      categoryRequest.categoryName
    );

    if (!category) {
      category = await modelConfig.categoryModel.create(
        buildCreatePayload(modelConfig.categoryModel, {
          name: categoryRequest.categoryName,
          description: categoryRequest.description,
        })
      );
    }

    let subcategory = await findByNameInsensitive(
      modelConfig.subcategoryModel,
      categoryRequest.subcategoryName,
      { category: category._id }
    );

    if (!subcategory) {
      subcategory = await modelConfig.subcategoryModel.create(
        buildCreatePayload(modelConfig.subcategoryModel, {
          name: categoryRequest.subcategoryName,
          description: categoryRequest.description,
          category: category._id,
        })
      );
    }

    categoryRequest.status = 'approved';
    categoryRequest.approvedBy = req.user._id;
    categoryRequest.approvedAt = new Date();
    categoryRequest.rejectedBy = undefined;
    categoryRequest.rejectedAt = undefined;
    categoryRequest.rejectionReason = undefined;
    categoryRequest.approvedCategoryModel = modelConfig.approvedCategoryModel;
    categoryRequest.approvedCategory = category._id;
    categoryRequest.approvedSubcategoryModel = modelConfig.approvedSubcategoryModel;
    categoryRequest.approvedSubcategory = subcategory._id;

    await categoryRequest.save();

    const approvedRequest = await CategoryRequest.findById(categoryRequest._id)
      .populate('requestedBy', 'name email mobile role')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('approvedCategory')
      .populate('approvedSubcategory');

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.CATEGORY_REQUEST_APPROVE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATEGORY_REQUEST,
      targetId: categoryRequest._id,
      changeSummary: buildFieldChangeSummary(
        { status: 'pending' },
        { status: categoryRequest.status },
        ['status']
      ),
    });

    return res.status(200).json({
      success: true,
      message: 'Category request approved successfully',
      data: approvedRequest,
    });
  } catch (error) {
    console.error('Error approving category request:', error);
    return res.status(500).json({
      success: false,
      message: 'Error approving category request',
      error: error.message,
    });
  }
};

const rejectCategoryRequest = async (req, res) => {
  try {
    const categoryRequest = await CategoryRequest.findById(req.params.id);

    if (!categoryRequest) {
      return res.status(404).json({
        success: false,
        message: 'Category request not found',
      });
    }

    if (categoryRequest.status === 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Approved category request cannot be rejected',
      });
    }

    if (categoryRequest.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Category request is already rejected',
      });
    }

    const { rejectionReason } = req.body;
    const previousStatus = categoryRequest.status;

    categoryRequest.status = 'rejected';
    categoryRequest.rejectedBy = req.user._id;
    categoryRequest.rejectedAt = new Date();
    categoryRequest.rejectionReason = rejectionReason
      ? String(rejectionReason).trim()
      : undefined;

    await categoryRequest.save();

    const rejectedRequest = await CategoryRequest.findById(categoryRequest._id)
      .populate('requestedBy', 'name email mobile role')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('approvedCategory')
      .populate('approvedSubcategory');

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.CATEGORY_REQUEST_REJECT,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATEGORY_REQUEST,
      targetId: categoryRequest._id,
      changeSummary: buildFieldChangeSummary(
        { status: previousStatus },
        { status: 'rejected' },
        ['status']
      ),
      note: categoryRequest.rejectionReason || null,
    });

    return res.status(200).json({
      success: true,
      message: 'Category request rejected successfully',
      data: rejectedRequest,
    });
  } catch (error) {
    console.error('Error rejecting category request:', error);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting category request',
      error: error.message,
    });
  }
};

// Controller to get all categories
const getAllCategories = async (req, res) => {
  try {
    
    const foodCategories = await FoodCategory.find();
    const productCategories = await ProductCategory.find();
    const serviceCategories = await ServiceCategory.find();
    

    return res.status(200).json({
      success: true,
      data: {
        foodCategories,
        productCategories,
        serviceCategories,
      },
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message,
    });
  }
};

const getProductCategories = async (req, res) => {
  try {
    const productCategories = await ProductCategory.find().lean();

    // Aggregate product counts
    const counts = await Product.aggregate([
      {
        $match: { isDeleted: false, isPublished: true }
      },
      {
        $group: {
          _id: "$categoryId",
          totalProducts: { $sum: 1 }
        }
      }
    ]);

    // Convert to map for quick lookup
    const countMap = {};
    counts.forEach(item => {
      countMap[item._id.toString()] = item.totalProducts;
    });

    // Add totalProducts field to each category
    const updatedCategories = productCategories.map(cat => ({
      ...cat,
      totalProducts: countMap[cat._id.toString()] || 0
    }));

    return res.status(200).json({
      success: true,
      data: {
        productCategories: updatedCategories, // 👈 SAME structure as before
      },
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching product categories',
      error: error.message,
    });
  }
};



// const getProductCategories = async (req, res) => {
//   try {
//     const productCategories = await ProductCategory.find();
//     return res.status(200).json({
//       success: true,
//       data: {
//         productCategories,
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching categories:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Error fetching product categories',
//       error: error.message,
//     });
//   }
// };


const getServiceCategories = async (req, res) => {
  try {
    const serviceCategories = await ServiceCategory.find().lean();

    // Aggregate service counts
    const counts = await Service.aggregate([
      {
        $match: { isPublished: true }
      },
      {
        $group: {
          _id: "$categoryId",
          totalServices: { $sum: 1 }
        }
      }
    ]);

    // Convert to map
    const countMap = {};
    counts.forEach(item => {
      countMap[item._id.toString()] = item.totalServices;
    });

    // Attach totalServices field
    const updatedCategories = serviceCategories.map(cat => ({
      ...cat,
      totalServices: countMap[cat._id.toString()] || 0
    }));

    return res.status(200).json({
      success: true,
      data: {
        serviceCategories: updatedCategories, // 👈 SAME structure
      },
    });

  } catch (error) {
    console.error('Error fetching service categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching service categories',
      error: error.message,
    });
  }
};


// const getServiceCategories = async (req, res) => {
//   try {
//     const serviceCategories = await ServiceCategory.find();
//     return res.status(200).json({
//       success: true,
//       data: {
//         serviceCategories,
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching service categories:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Error fetching service categories',
//       error: error.message,
//     });
//   }
// };

const getFoodCategories = async (req, res) => {
  try {
    const foodCategories = await FoodCategory.find();
    return res.status(200).json({
      success: true,
      data: {
        foodCategories,
      },
    });
  } catch (error) {
    console.error('Error fetching food categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching food categories',
      error: error.message,
    });
  }
};





const getProductSubcategories = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!categoryId) {
      return res.status(400).json({
        success: false,
        message: "Category ID is required.",
      });
    }

    const subcategories = await ProductSubcategory.find({ category: categoryId }).select(
      "_id name"
    );

    return res.status(200).json({
      success: true,
      data: subcategories,
    });
  } catch (error) {
    console.error("Error fetching product subcategories:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching product subcategories.",
    });
  }
};


const listSubcategories = async (req, res) => {
  try {
    const { categorySlug, categoryId, q } = req.query;

    let catId = categoryId;
    if (!catId && categorySlug) {
      const cat = await ProductCategory.findOne(
        { slug: String(categorySlug) },
        { _id: 1 }
      ).lean();
      if (!cat) return res.status(404).json({ error: 'Unknown category slug' });
      catId = String(cat._id);
    }

    const filter = {};
    if (catId) filter.category = catId;
    if (q) filter.name = { $regex: String(q), $options: 'i' };

    const subs = await ProductSubcategory
      .find(filter, { _id: 1, name: 1, slug: 1, category: 1 })
      .sort({ name: 1 })
      .lean();

    return res.json(subs);
  } catch (err) {
    console.error('listSubcategories error:', err);
    return res.status(500).json({ error: 'Failed to fetch subcategories' });
  }
};





module.exports = {
  getAllCategoriesAdmin,
  createCategoryRequest,
  getAllCategoryRequests,
  getMyCategoryRequests,
  approveCategoryRequest,
  rejectCategoryRequest,
  getAllCategories,
  getProductCategories,
  getServiceCategories,
  getFoodCategories,
  getProductSubcategories,
  listSubcategories,
};
