const mongoose = require('mongoose');
const Review = require('../models/Review');
const Product = require('../models/Product');
const Service = require('../models/Service');
const Food = require('../models/Food');

const LISTING_MODELS = {
  product: Product,
  service: Service,
  food: Food,
};

const roundRating = (value) => Math.round((value || 0) * 10) / 10;

const getReviewSummary = async (listingId, listingType) => {
  const normalizedListingId =
    listingId instanceof mongoose.Types.ObjectId
      ? listingId
      : new mongoose.Types.ObjectId(listingId);

  const [stats] = await Review.aggregate([
    {
      $match: {
        listingId: normalizedListingId,
        listingType,
        isHidden: { $ne: true },
      },
    },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        rating5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
        rating4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
        rating3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
        rating2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
        rating1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
      },
    },
  ]);

  return {
    totalReviews: stats?.totalReviews || 0,
    averageRating: roundRating(stats?.averageRating || 0),
    ratingBreakdown: {
      5: stats?.rating5 || 0,
      4: stats?.rating4 || 0,
      3: stats?.rating3 || 0,
      2: stats?.rating2 || 0,
      1: stats?.rating1 || 0,
    },
  };
};

const refreshListingReviewStats = async (listingId, listingType) => {
  const Model = LISTING_MODELS[listingType];
  if (!Model) {
    throw new Error(`Unsupported listing type: ${listingType}`);
  }

  const summary = await getReviewSummary(listingId, listingType);

  await Model.updateOne(
    { _id: listingId },
    {
      $set: {
        totalReviews: summary.totalReviews,
        averageRating: summary.averageRating,
      },
    }
  );

  return summary;
};

module.exports = {
  LISTING_MODELS,
  getReviewSummary,
  refreshListingReviewStats,
};
