const mongoose = require('mongoose');
const slugify = require('slugify');

const foodSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: false,
      default: 'Food',
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      required: false,
      default: '',
    },
    price: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    coverImage: {
      type: String,
      default: '',
    },
    images: {
      type: [String],
      default: [],
    },
    menuImage: {
      type: String,
      default: '',
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodCategory',
      required: true,
    },
    subcategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodSubcategory',
      required: true,
    },
    businessName: {
      type: String,
      default: '',
      trim: true,
    },
    minorityType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MinorityType',
    },
location: {
  type: {
    type: String,
    enum: ['Point'],
  },
  coordinates: {
    type: [Number], // [lng, lat]
  },
  address: String
},
    businessHours: [
      {
        day: { type: String, required: true },
        hours: { type: String, required: true },
        closed: { type: Boolean, default: false },
      },
    ],
    bookingToolLink: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+\..+/.test(v);
        },
        message: 'Please enter a valid URL (must start with http or https).'
      }
    },
    metaFields: [
      {
        key: { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],
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
    foodType: {
      type: String,
      required: false,
      default: '',
    },
    brand: {
      type: String, // Optional: used only for Shop foods
    },
    tableTypes: [
      {
        type: {
          type: String, // e.g., '2-Seater'
          required: true,
        },
        count: {
          type: Number,
          required: true,
          min: 1,
        },
      },
    ],
    bookingTimeSlots: {
      type: [String], // e.g., ['12:00 PM', '1:00 PM', ...]
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
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
    totalReviews: {
      type: Number,
      default: 0,
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    badge: {
      type: String,
      enum: ['gold', 'silver', 'bronze'],
      trim: true,
    },
  },
  { timestamps: true }
);

// Auto-generate slug
foodSchema.pre('save', async function (next) {
  if (!this.slug) {
    const baseSlug = slugify(this.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await mongoose.models.Food.findOne({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }
    this.slug = slug;
  }
  next();
});

module.exports = mongoose.model('Food', foodSchema);
