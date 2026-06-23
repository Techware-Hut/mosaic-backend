const mongoose = require('mongoose');
const Review = require('../models/Review');
const { LISTING_MODELS, getReviewSummary, refreshListingReviewStats } = require('../services/reviewService');

const LISTING_LABELS = {
  product: 'Product',
  service: 'Service',
  food: 'Food',
};

const MAX_LIMIT = 50;

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit };
};

const getListingIdFromParams = (req) =>
  req.params.productId || req.params.serviceId || req.params.foodId || req.params.id;

const validateObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeId = (value) => {
  if (!value) return value;
  return typeof value.toString === 'function' ? value.toString() : value;
};

const normalizeDate = (value) => {
  if (!value) return value;
  return value instanceof Date ? value.toISOString() : value;
};

const toPublicReviewUser = (user) => {
  if (!user || typeof user !== 'object') return null;

  return {
    _id: normalizeId(user._id),
    name: user.name || '',
    profileImage: user.profileImage || '',
  };
};

const toPublicReview = (review) => {
  const source = review || {};

  return {
    _id: normalizeId(source._id),
    userId: toPublicReviewUser(source.userId),
    listingId: normalizeId(source.listingId),
    listingType: source.listingType,
    rating: source.rating,
    comment: source.comment,
    image: source.image || '',
    createdAt: normalizeDate(source.createdAt),
    updatedAt: normalizeDate(source.updatedAt),
  };
};

const ensureListingExists = async (listingId, listingType) => {
  const Model = LISTING_MODELS[listingType];
  if (!Model) {
    return null;
  }

  const listing = await Model.findById(listingId).select('_id isDeleted').lean();
  if (!listing || listing.isDeleted) {
    return null;
  }

  return listing;
};

exports.listReviews = (listingType) => async (req, res) => {
  try {
    const listingId = getListingIdFromParams(req);
    if (!validateObjectId(listingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid listing ID',
      });
    }

    const listing = await ensureListingExists(listingId, listingType);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: `${LISTING_LABELS[listingType]} not found`,
      });
    }

    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;

    const [reviews, total, summary] = await Promise.all([
      Review.find({ listingId, listingType })
        .populate('userId', 'name profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments({ listingId, listingType }),
      getReviewSummary(listingId, listingType),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        summary,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
        reviews: reviews.map(toPublicReview),
      },
    });
  } catch (error) {
    console.error(`Error listing ${listingType} reviews:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
    });
  }
};

exports.upsertReview = (listingType) => async (req, res) => {
  try {
    const listingId = getListingIdFromParams(req);
    if (!validateObjectId(listingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid listing ID',
      });
    }

    const listing = await ensureListingExists(listingId, listingType);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: `${LISTING_LABELS[listingType]} not found`,
      });
    }

    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();
    const image = req.body.image ? String(req.body.image).trim() : '';

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be an integer between 1 and 5',
      });
    }

    if (!comment) {
      return res.status(400).json({
        success: false,
        message: 'Comment is required',
      });
    }

    let review = await Review.findOne({
      userId: req.user._id,
      listingId,
      listingType,
    });

    const isNewReview = !review;

    if (!review) {
      review = new Review({
        userId: req.user._id,
        listingId,
        listingType,
        rating,
        comment,
        image: image || undefined,
      });
    } else {
      review.rating = rating;
      review.comment = comment;
      review.image = image || undefined;
    }

    await review.save();

    const summary = await refreshListingReviewStats(listingId, listingType);
    const populatedReview = await Review.findById(review._id)
      .populate('userId', 'name profileImage')
      .lean();

    return res.status(isNewReview ? 201 : 200).json({
      success: true,
      message: isNewReview ? 'Review added successfully' : 'Review updated successfully',
      data: {
        review: toPublicReview(populatedReview),
        summary,
      },
    });
  } catch (error) {
    console.error(`Error saving ${listingType} review:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save review',
    });
  }
};

exports.deleteReview = (listingType) => async (req, res) => {
  try {
    const listingId = getListingIdFromParams(req);
    const { reviewId } = req.params;

    if (!validateObjectId(listingId) || !validateObjectId(reviewId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid listing or review ID',
      });
    }

    const listing = await ensureListingExists(listingId, listingType);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: `${LISTING_LABELS[listingType]} not found`,
      });
    }

    const review = await Review.findOne({
      _id: reviewId,
      listingId,
      listingType,
      userId: req.user._id,
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    await review.deleteOne();

    const summary = await refreshListingReviewStats(listingId, listingType);

    return res.status(200).json({
      success: true,
      message: 'Review deleted successfully',
      data: {
        summary,
      },
    });
  } catch (error) {
    console.error(`Error deleting ${listingType} review:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete review',
    });
  }
};
