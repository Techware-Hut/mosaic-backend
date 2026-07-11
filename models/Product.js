const mongoose = require('mongoose');
const slugify = require('slugify');

const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },

  slug: {
    type: String,
    unique: true,
    lowercase: true,
  },

  description: {
    type: String,
    required: true,
  },

  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductCategory',
    required: true,
  },

  subcategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductSubcategory',
    required: true,
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true,
  },

  price: {
  type: mongoose.Schema.Types.Decimal128, // same type as variant price
  default: null, // null if no variants yet
},

  /* ===============================
     ATTRIBUTES (Size, Color etc.)
  =============================== */

  attributes: [
    {
      name: { type: String, required: true }, // Size / Color
      values: [{ type: String, required: true }] // Small, Medium / Black, Blue
    }
  ],

  /* ===============================
     SHIPPING
  =============================== */

  shipping: {
    standard: { type: Number, default: 0 },
    overnight: { type: Number, default: 0 },
    local: { type: Number, default: 0 }
  },

  /* ===============================
     MEDIA
  =============================== */

  coverImage: {
    type: String,
    required: true,
  },

  galleryImages: {
    type: [String],
    default: [],
  },

  /* ===============================
     SEO / META
  =============================== */

  metaFields: [
    {
      key: String,
      value: String,
    }
  ],

  /* ===============================
     DISCOUNTS
  =============================== */

  discount: {
    type: {
      type: String,
      enum: ['fixed', 'percentage'],
    },
    amount: Number,
    minCartValue: Number
  },

  taxCategory: {
    code: {
      type: String,
      trim: true,
      default: null,
    },
    label: {
      type: String,
      trim: true,
      default: null,
    },
  },

  totalReviews: {
    type: Number,
    default: 0,
    min: 0,
  },

  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },

  isPublished: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  adminRemark: {
    type: String,
    trim: true,
    default: '',
  },
  adminModeratedAt: Date,
  adminModeratedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

}, { timestamps: true });

productSchema.index({ isActive: 1, isPublished: 1, isDeleted: 1, createdAt: -1 });

productSchema.index({ isFeatured: 1, isPublished: 1, isDeleted: 1, createdAt: -1 });
productSchema.index({ businessId: 1, isPublished: 1, isDeleted: 1 });
productSchema.index({ isPublished: 1, isDeleted: 1, createdAt: -1 });

productSchema.pre('save', async function (next) {
  if (!this.slug && this.title) {
    let baseSlug = slugify(this.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    while (await mongoose.models.Product.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;
  }
  next();
});

module.exports =
  mongoose.models.Product ||
  mongoose.model('Product', productSchema);
