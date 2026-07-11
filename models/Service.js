const mongoose = require('mongoose');
const slugify = require('slugify');

const serviceSchema = new mongoose.Schema({
  title: {
    type: String,
    required: false, // Made optional
    default: 'Service',
    trim: true,
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
  },
  description: {
    type: String,
    required: false, // Made optional
    default: '',
  },
  price: {
    type: Number,
    required: false, // Made optional
    default: 0,
    min: 0,
  },
  duration: {
    type: String, // Example: '1 hour', '30 minutes'
    required: false, // Made optional
    default: '',
  },
  services: [
    {
      name: {
        type: String,
        required: true,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
      },
      image: {
        type: String,
        trim: true,
        default: '',
      },
      images: {
        type: [String],
        default: [],
      },
      durationMinutes: {
        type: Number,
        required: true,
        min: 1,
      },
      price: {
        type: Number,
        required: true,
        min: 0,
      },
    },
  ],
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceCategory',
    required: true,
  },
  subcategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceSubcategory',
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
  minorityType: {
    type: String,
    trim: true,
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
  coverImage: {
    type: String,
  },
  images: {
    type: [String],
    default: [],
  },
  maxBookingsPerSlot: {
    type: Number,
    default: 1,
  },
  bookingToolLink: {
    type: String,
    trim: true,
    validate: {
      validator: function (v) {
        if (!v) return true;
        return /^https?:\/\/.+\..+/.test(v);
      },
      message: 'Please enter a valid URL (must start with http or https).'
    }
  },
  externalLink: {
    type: String,
    trim: true,
    default: '',
    validate: {
      validator: function (v) {
        if (!v) return true;
        return /^https?:\/\/.+\..+/.test(v);
      },
      message: 'Please enter a valid external link (must start with http or https).'
    }
  },
  rfqEnabled: {
    type: Boolean,
    default: false,
  },
  videos: {
    type: [String],
    default: [],
  },
  features: {
    type: [String],
    default: [],
  },
  amenities: [
    {
      label: { type: String, required: true },
      available: { type: Boolean, required: true },
    },
  ],
  businessHours: [
    {
      day: { type: String, required: true },
      hours: { type: String, required: true },
      closed: { type: Boolean, default: false },
    },
  ],
  // Simplified location - just a string for map link
  location: {
    type: String,
    default: '',
  },
  // Make contact fields optional
  contact: {
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    website: { type: String, default: '' },
  },
  faq: [
    {
      question: { type: String, required: true },
      answer: { type: String, required: true },
    },
  ],
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
}, { timestamps: true });

// Generate slug before save
serviceSchema.pre('save', async function (next) {
  if (!this.isModified('title')) return next();

  const baseSlug = slugify(this.title, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  const ServiceModel = mongoose.models.Service || this.constructor;

  while (await ServiceModel.exists({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  this.slug = slug;
  next();
});

// Method to calculate total reviews and average rating
serviceSchema.methods.calculateRatings = async function () {
  const reviews = await mongoose.model('Review').find({
    listingId: this._id,
    listingType: 'service',
  });
  this.totalReviews = reviews.length;

  const totalRating = reviews.reduce((acc, review) => acc + review.rating, 0);
  this.averageRating = this.totalReviews > 0
    ? Math.round((totalRating / this.totalReviews) * 10) / 10
    : 0;

  await this.save();
};

// Post-save hook to automatically update ratings
serviceSchema.post('save', async function (doc, next) {
  if (doc.isModified('totalReviews') || doc.isModified('averageRating')) {
    await doc.calculateRatings();
  }
  next();
});

// Indexes for faster queries
serviceSchema.index({ ownerId: 1 });
serviceSchema.index({ categoryId: 1 });

module.exports = mongoose.model('Service', serviceSchema);
