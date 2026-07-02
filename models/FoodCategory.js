const mongoose = require('mongoose');
const slugify = require('slugify');
const {
  normalizeCategoryName,
  getInvalidCategoryNameReason,
} = require('../utils/categoryVisibility');

const foodCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      set: normalizeCategoryName,
      validate: {
        validator(value) {
          if (!this.isNew && typeof this.isModified === 'function' && !this.isModified('name')) {
            return true;
          }
          return !getInvalidCategoryNameReason(value);
        },
        message(props) {
          return getInvalidCategoryNameReason(props.value) || 'Invalid category name';
        },
      },
    },
    slug: {
      type: String,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    isPublic: {
      type: Boolean,
      default: true,
      index: true,
    },
    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },
    hidden: {
      type: Boolean,
      default: false,
      index: true,
    },
    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },
    status: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

// ✅ Auto-generate slug from name
foodCategorySchema.pre('save', async function (next) {
  if (!this.isModified('name')) return next();

  const baseSlug = slugify(this.name, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  const Model = mongoose.models.FoodCategory || this.constructor;

  while (await Model.exists({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  this.slug = slug;
  next();
});

module.exports =
  mongoose.models.FoodCategory || mongoose.model('FoodCategory', foodCategorySchema);
