const mongoose = require('mongoose');

const productVariantSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },

  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  /* ===============================
     ATTRIBUTE COMBINATION
     Example:
     { Size: "Small", Color: "Black" }
  =============================== */

  attributes: {
    type: Map,
    of: String,
    required: true
  },

  sku: {
    type: String,
    required: true,
    unique: true,
  },

  price: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
  },

  salePrice: {
    type: mongoose.Schema.Types.Decimal128,
  },

  stock: {
    type: Number,
    required: true,
    min: 0,
  },

  /* ===============================
     VARIANT SHIPPING (optional override)
  =============================== */

  shipping: {
    standard: Number,
    overnight: Number,
    local: Number
  },

  images: {
    type: [String],
  },

  isPublished: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },

}, { timestamps: true });

productVariantSchema.index({ productId: 1 });
productVariantSchema.index({ businessId: 1 });

module.exports =
  mongoose.models.ProductVariant ||
  mongoose.model('ProductVariant', productVariantSchema);
