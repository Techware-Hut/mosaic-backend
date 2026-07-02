const FoodCategory = require('../../models/FoodCategory');
const {
  assertValidCategoryName,
  buildPublicCategoryFilter,
  filterPublicCategories,
  getCategoryVisibilityFields,
} = require('../../utils/categoryVisibility');


exports.createFoodCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    const normalizedName = assertValidCategoryName(name);

    const existing = await FoodCategory.findOne({ name: normalizedName });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }

    const category = await FoodCategory.create({
      name: normalizedName,
      description,
      ...getCategoryVisibilityFields(req.body),
    });

    res.status(201).json({ success: true, data: category });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};


exports.getFoodCategories = async (req, res) => {
  try {
    const categories = filterPublicCategories(
      await FoodCategory.find(buildPublicCategoryFilter()).sort({ createdAt: -1 }).lean()
    );
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.updateFoodCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    const category = await FoodCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      category.name = assertValidCategoryName(name);
    }
    category.description = description || category.description;
    Object.assign(category, getCategoryVisibilityFields(req.body));

    await category.save();

    res.json({ success: true, data: category });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};


exports.deleteFoodCategory = async (req, res) => {
  try {
    const category = await FoodCategory.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
