const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',  // Refers to the User model (who wrote the review)
    required: true,
  },
  listingId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  listingType: {
    type: String,
    enum: ['product', 'service', 'food'],  // Differentiates the type of listing
    required: true,
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    required: true,
  },
  comment: {
    type: String,
    required: true,
  },
  image: {
    type: String,  // Optional image URL if the user provides a review image
  },
  isHidden: {
    type: Boolean,
    default: false,
  },
  moderatedAt: {
    type: Date,
  },
}, { timestamps: true });

reviewSchema.index(
  { userId: 1, listingId: 1, listingType: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.Review ||
  mongoose.model('Review', reviewSchema);
