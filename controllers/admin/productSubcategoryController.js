const ProductSubcategory = require('../../models/ProductSubcategory');

// ✅ Create
exports.createProductSubcategory = async (req, res) => {
    try {
        const { name, description, categoryId } = req.body;

        if (!name || !categoryId) {
            return res.status(400).json({ success: false, message: 'Name and Category ID are required' });
        }

        const newSub = new ProductSubcategory({
            name,
            description,
            category: categoryId,
        });

        await newSub.save();

        res.status(201).json({ success: true, data: newSub });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        console.error('Create Subcategory Error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ✅ Get All
exports.getProductSubcategories = async (req, res) => {
    try {
        const { categoryId } = req.query;

        const filter = {};
        if (categoryId) {
            filter.category = categoryId;
        }

        const subs = await ProductSubcategory.find(filter).populate('category', 'name');

        res.json({ success: true, data: subs });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        console.error('Get Subcategories Error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};


// ✅ Update
exports.updateProductSubcategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, categoryId } = req.body;

        const updated = await ProductSubcategory.findByIdAndUpdate(
            id,
            { name, description, category: categoryId },
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Subcategory not found' });
        }

        res.json({ success: true, data: updated });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        console.error('Update Subcategory Error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ✅ Delete
exports.deleteProductSubcategory = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await ProductSubcategory.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Subcategory not found' });
        }

        res.json({ success: true, message: 'Subcategory deleted' });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        console.error('Delete Subcategory Error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
