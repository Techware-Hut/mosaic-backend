const ProductSubcategory = require('../models/ProductSubcategory');
const ServiceSubcategory = require('../models/ServiceSubcategory');
const FoodSubcategory = require('../models/FoodSubcategory');
const ProductCategory = require('../models/ProductCategory');
const ServiceCategory = require('../models/ServiceCategory');
const FoodCategory = require('../models/FoodCategory');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Service = require('../models/Service');
const {
  findPublicCategory,
} = require('../utils/categoryVisibility');

// Get Product Subcategories by Category ID or Slug

exports.getProductSubcategories = async (req, res) => {
  try {
    const { categoryIdOrSlug } = req.params;
    let categoryId = categoryIdOrSlug;

    if (!mongoose.Types.ObjectId.isValid(categoryIdOrSlug)) {
      const category = await findPublicCategory(ProductCategory, { slug: categoryIdOrSlug });
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
      categoryId = category._id;
    } else {
      const category = await findPublicCategory(ProductCategory, { id: categoryIdOrSlug });
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
    }

    const subcategories = await ProductSubcategory.find({ category: categoryId })
      .select('_id name slug')
      .lean();

    const counts = await Product.aggregate([
      {
        $match: {
          categoryId: new mongoose.Types.ObjectId(categoryId),
          isDeleted: false,
          isPublished: true
        }
      },
      {
        $group: {
          _id: "$subcategoryId",
          totalProducts: { $sum: 1 }
        }
      }
    ]);

    const countMap = {};
    counts.forEach(item => {
      countMap[item._id?.toString()] = item.totalProducts;
    });

    const updatedSubcategories = subcategories.map(sub => ({
      ...sub,
      totalProducts: countMap[sub._id.toString()] || 0
    }));

    res.json({
      success: true,
      data: updatedSubcategories, // 👈 SAME structure as before
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


//old one without count

// exports.getProductSubcategories = async (req, res) => {
//   try {
//     const { categoryIdOrSlug } = req.params;
//     let categoryId = categoryIdOrSlug;

//     // Check if it's a slug (not a valid ObjectId)
//     if (!mongoose.Types.ObjectId.isValid(categoryIdOrSlug)) {
//       const category = await ProductCategory.findOne({ slug: categoryIdOrSlug });
//       if (!category) {
//         return res.status(404).json({ success: false, message: 'Category not found' });
//       }
//       categoryId = category._id;
//     }

//     const subcategories = await ProductSubcategory.find({ category: categoryId })
//       .select('_id name slug')
//       .sort({ name: 1 });

//     res.json({ success: true, data: subcategories });
//   } catch (err) {
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// Get Service Subcategories by Category ID or Slug


exports.getServiceSubcategories = async (req, res) => {
  try {
    const { categoryIdOrSlug } = req.params;
    let categoryId = categoryIdOrSlug;

    if (!mongoose.Types.ObjectId.isValid(categoryIdOrSlug)) {
      const category = await findPublicCategory(ServiceCategory, { slug: categoryIdOrSlug });
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
      categoryId = category._id;
    } else {
      const category = await findPublicCategory(ServiceCategory, { id: categoryIdOrSlug });
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
    }

    const subcategories = await ServiceSubcategory.find({ category: categoryId })
      .select('_id name slug')
      .sort({ name: 1 })
      .lean();

    // Aggregate service counts per subcategory
    const counts = await Service.aggregate([
      {
        $match: {
          categoryId: new mongoose.Types.ObjectId(categoryId),
          isPublished: true
        }
      },
      {
        $group: {
          _id: "$subcategoryId",
          totalServices: { $sum: 1 }
        }
      }
    ]);

    const countMap = {};
    counts.forEach(item => {
      countMap[item._id?.toString()] = item.totalServices;
    });

    const updatedSubcategories = subcategories.map(sub => ({
      ...sub,
      totalServices: countMap[sub._id.toString()] || 0
    }));

    res.json({
      success: true,
      data: updatedSubcategories, // 👈 SAME structure
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// exports.getServiceSubcategories = async (req, res) => {
//   try {
//     const { categoryIdOrSlug } = req.params;
//     let categoryId = categoryIdOrSlug;

//     // Check if it's a slug (not a valid ObjectId)
//     if (!mongoose.Types.ObjectId.isValid(categoryIdOrSlug)) {
//       const category = await ServiceCategory.findOne({ slug: categoryIdOrSlug });
//       if (!category) {
//         return res.status(404).json({ success: false, message: 'Category not found' });
//       }
//       categoryId = category._id;
//     }

//     const subcategories = await ServiceSubcategory.find({ category: categoryId })
//       .select('_id name slug')
//       .sort({ name: 1 });

//     res.json({ success: true, data: subcategories });
//   } catch (err) {
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// Get Food Subcategories by Category ID or Slug
exports.getFoodSubcategories = async (req, res) => {
  try {
    const { categoryIdOrSlug } = req.params;
    let categoryId = categoryIdOrSlug;

    // Check if it's a slug (not a valid ObjectId)
    if (!mongoose.Types.ObjectId.isValid(categoryIdOrSlug)) {
      const category = await findPublicCategory(FoodCategory, { slug: categoryIdOrSlug });
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
      categoryId = category._id;
    } else {
      const category = await findPublicCategory(FoodCategory, { id: categoryIdOrSlug });
      if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
    }

    const subcategories = await FoodSubcategory.find({ category: categoryId })
      .select('_id name slug')
      .sort({ name: 1 });

    res.json({ success: true, data: subcategories });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
