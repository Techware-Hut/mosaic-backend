const ProductCategory = require('../../models/ProductCategory');
const ProductSubcategory = require('../../models/ProductSubcategory');
const deleteCloudinaryFile = require('../../utils/deleteCloudinaryFile');
const {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} = require('../../utils/audit/actionRegistry');
const {
  recordAdminAuditSuccess,
  buildFieldChangeSummary,
} = require('../../services/adminAuditService');

// ✅ Create Product Category
exports.createProductCategory = async (req, res) => {
  try {
    const { name, description, img } = req.body;

    const existing = await ProductCategory.findOne({ name });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }

    const category = new ProductCategory({
      name,
      description,
      img, // ✅ Directly saving image URL
    });

    await category.save();

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.CATEGORY_CREATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATEGORY,
      targetId: category._id,
      changeSummary: buildFieldChangeSummary({}, { name: category.name }, ['name']),
    });

    return res.status(201).json({ success: true, data: category });
  } catch (err) {
    console.error('Create Product Category Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Update Product Category
exports.updateProductCategory = async (req, res) => {
  try {
    const { name, description, img } = req.body;

    const category = await ProductCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const beforeName = category.name;
    category.name = name || category.name;
    category.description = description || category.description;
    category.img = img || category.img;

    await category.save();

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.CATEGORY_UPDATE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATEGORY,
      targetId: category._id,
      changeSummary: buildFieldChangeSummary({ name: beforeName }, { name: category.name }, ['name']),
    });

    return res.status(200).json({ success: true, data: category });
  } catch (err) {
    console.error('Update Product Category Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Delete Product Category
exports.deleteProductCategory = async (req, res) => {
  try {
    const category = await ProductCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Delete category image from S3 (if exists)
    if (category.img) {
      await deleteCloudinaryFile(category.img);
    }

    // Delete all subcategories under this category
    await ProductSubcategory.deleteMany({ category: category._id });

    // Finally, delete the category itself
    await category.deleteOne();

    await recordAdminAuditSuccess(req, {
      actionCode: ADMIN_AUDIT_ACTIONS.CATEGORY_DELETE,
      targetType: ADMIN_AUDIT_TARGET_TYPES.CATEGORY,
      targetId: category._id,
      changeSummary: buildFieldChangeSummary({ name: category.name }, {}, ['name']),
    });

    return res.status(200).json({ success: true, message: 'Category and related subcategories deleted successfully' });
  } catch (err) {
    console.error('Delete Product Category Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ Get All Product Categories
exports.getAllProductCategories = async (req, res) => {
  try {
    const categories = await ProductCategory.find().sort({ createdAt: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (err) {
    console.error('Fetch Categories Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


exports.getProductCategoryById = async (req, res) => {
  try {
    const category = await ProductCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    return res.status(200).json({ success: true, category });
  } catch (err) {
    console.error('Fetch Category Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};