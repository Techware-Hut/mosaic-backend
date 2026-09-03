// controllers/admin/serviceSubcategoryController.js
const ServiceSubcategory = require('../../models/ServiceSubcategory');

exports.createServiceSubcategory = async (req, res) => {
    try {
        const { name, categoryId } = req.body;

        if (!name || !categoryId) {
            return res.status(400).json({ success: false, message: 'Name and Category ID are required' });
        }

        const newSub = new ServiceSubcategory({
            name,
            category: categoryId,
        });

        await newSub.save();
        res.status(201).json({ success: true, data: newSub });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.getServiceSubcategories = async (req, res) => {
    try {
        const { categoryId } = req.query;
        const filter = categoryId ? { category: categoryId } : {};
        const subs = await ServiceSubcategory.find(filter).populate('category', 'name');
        res.json({ success: true, data: subs });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateServiceSubcategory = async (req, res) => {
    try {
        const { name, categoryId } = req.body;
        const updated = await ServiceSubcategory.findByIdAndUpdate(
            req.params.id,
            { name, category: categoryId },
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
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteServiceSubcategory = async (req, res) => {
    try {
        const deleted = await ServiceSubcategory.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Subcategory not found' });
        }
        res.json({ success: true, message: 'Subcategory deleted' });
    } catch (err) {
    if (err.code === 11000 || (err.message && (err.message.includes('E11000') || err.message.includes('duplicate key')))) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }
        res.status(500).json({ success: false, message: err.message });
    }
};
