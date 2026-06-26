const mongoose = require('mongoose');
const Wishlist = require('../../models/Wishlist');
const ProductVariant = require('../../models/ProductVariant');

// GET /api/wishlist
exports.getWishlist = async (req, res) => {
    try {
        const wishlist = await Wishlist.find({ customerId: req.user._id })
            .populate({
                path: 'productVariantId',
                populate: {
                    path: 'productId',
                    select: 'title coverImage price', // customize as needed
                },
            });

        res.status(200).json({ success: true, data: wishlist });
    } catch (err) {
        console.error(err); // Add this
        res.status(500).json({ success: false, message: 'Failed to fetch wishlist', error: err.message });
    }

};

// POST /api/wishlist/:productVariantId
exports.addToWishlist = async (req, res) => {
    const { productVariantId } = req.params;

    try {
        if (!mongoose.Types.ObjectId.isValid(productVariantId)) {
            return res.status(400).json({ success: false, message: 'Invalid product variant ID' });
        }

        const variant = await ProductVariant.findById(productVariantId);
        if (!variant) {
            return res.status(404).json({ success: false, message: 'Product variant not found' });
        }

        const exists = await Wishlist.findOne({
            customerId: req.user._id,
            productVariantId,
        });

        if (exists) {
            return res.status(200).json({ success: true, message: 'Already in wishlist' });
        }

        const item = new Wishlist({
            customerId: req.user._id,
            productVariantId,
        });

        await item.save();
        res.status(201).json({ success: true, message: 'Added to wishlist' });
    } catch (err) {
        res.status(400).json({ success: false, message: 'Failed to add to wishlist', error: err.message });
    }
};

// DELETE /api/wishlist/:productVariantId
exports.removeFromWishlist = async (req, res) => {
    const { productVariantId } = req.params;

    try {
        const deleted = await Wishlist.findOneAndDelete({
            customerId: req.user._id,
            productVariantId,
        });

        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Item not found in wishlist' });
        }

        res.status(200).json({ success: true, message: 'Removed from wishlist' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to remove from wishlist' });
    }
};
