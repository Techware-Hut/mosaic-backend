const ServiceCategory = require('../../models/ServiceCategory');
const deleteCloudinaryFile = require('../../utils/deleteCloudinaryFile');
const {
  assertValidCategoryName,
  buildPublicCategoryFilter,
  filterPublicCategories,
  getCategoryVisibilityFields,
} = require('../../utils/categoryVisibility');


exports.getServiceCategories = async (req, res) => {
  try {
    const categories = filterPublicCategories(
      await ServiceCategory.find(buildPublicCategoryFilter()).sort({ createdAt: -1 }).lean()
    );
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createServiceCategory = async (req, res) => {
  try {
    const { name, description, img } = req.body;
    const normalizedName = assertValidCategoryName(name);
    const category = new ServiceCategory({
      name: normalizedName,
      description,
      img,
      ...getCategoryVisibilityFields(req.body),
    });
    await category.save();
    res.status(201).json({ success: true, category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.updateServiceCategory = async (req, res) => {
  try {
    const { name, description, img } = req.body;
    const updates = {
      description,
      img,
      ...getCategoryVisibilityFields(req.body),
    };
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      updates.name = assertValidCategoryName(name);
    }

    const category = await ServiceCategory.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    res.json({ success: true, category });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.deleteServiceCategory = async (req, res) => {
  try {
    const category = await ServiceCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Delete image from S3 if exists
    if (category.img) {
      await deleteCloudinaryFile(category.img);
    }

    await category.deleteOne(); // Use deleteOne instead of findByIdAndDelete to reuse the fetched object

    res.json({ success: true, message: 'Category and image deleted successfully' });
  } catch (err) {
    console.error('Delete Service Category Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
