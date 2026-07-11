const mongoose = require('mongoose');
const Review = require('../../models/Review');
const User = require('../../models/User');
const Business = require('../../models/Business');
const { LISTING_MODELS, refreshListingReviewStats } = require('../../services/reviewService');

const MAX_LIMIT = 100;
const LISTING_SELECT = '_id title slug businessId coverImage isDeleted';
const BUSINESS_SELECT = '_id businessName slug logo';
const USER_SELECT = '_id name email profileImage';

const normalizeId = (value) => {
  if (!value) return value;
  return typeof value.toString === 'function' ? value.toString() : value;
};

const normalizeDate = (value) => {
  if (!value) return value;
  return value instanceof Date ? value.toISOString() : value;
};

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit };
};

const buildReviewFilter = async (query) => {
  const filter = {};

  if (query.listingType && ['product', 'service', 'food'].includes(query.listingType)) {
    filter.listingType = query.listingType;
  }

  if (query.isHidden === 'true') {
    filter.isHidden = true;
  } else if (query.isHidden === 'false') {
    filter.isHidden = { $ne: true };
  }

  if (query.businessId && mongoose.Types.ObjectId.isValid(query.businessId)) {
    const businessObjectId = new mongoose.Types.ObjectId(query.businessId);
    const listingIds = [];

    await Promise.all(
      Object.entries(LISTING_MODELS).map(async ([listingType, Model]) => {
        const listings = await Model.find({ businessId: businessObjectId })
          .select('_id')
          .lean();
        listings.forEach((listing) => {
          listingIds.push({ id: listing._id, listingType });
        });
      })
    );

    if (listingIds.length === 0) {
      return { filter: null, empty: true };
    }

    filter.$or = listingIds.map(({ id, listingType }) => ({
      listingId: id,
      listingType,
    }));
  }

  return { filter, empty: false };
};

const toAdminListing = (listing, listingType) => {
  if (!listing) return null;

  return {
    _id: normalizeId(listing._id),
    listingType,
    title: listing.title || '',
    slug: listing.slug || '',
    businessId: normalizeId(listing.businessId),
    coverImage: listing.coverImage || '',
    isDeleted: Boolean(listing.isDeleted),
  };
};

const toAdminBusiness = (business) => {
  if (!business) return null;

  return {
    _id: normalizeId(business._id),
    businessName: business.businessName || '',
    slug: business.slug || '',
    logo: business.logo || '',
  };
};

const toAdminUser = (user) => {
  if (!user) return null;

  return {
    _id: normalizeId(user._id),
    name: user.name || '',
    email: user.email || '',
    profileImage: user.profileImage || '',
  };
};

const toAdminReviewRecord = (review, context) => {
  const listingKey = `${review.listingType}:${normalizeId(review.listingId)}`;
  const listing = context.listings.get(listingKey) || null;
  const business = listing?.businessId
    ? context.businesses.get(normalizeId(listing.businessId)) || null
    : null;

  return {
    _id: normalizeId(review._id),
    rating: review.rating,
    comment: review.comment,
    image: review.image || '',
    listingType: review.listingType,
    listingId: normalizeId(review.listingId),
    isHidden: Boolean(review.isHidden),
    moderatedAt: normalizeDate(review.moderatedAt),
    createdAt: normalizeDate(review.createdAt),
    updatedAt: normalizeDate(review.updatedAt),
    user: toAdminUser(context.users.get(normalizeId(review.userId))),
    listing: toAdminListing(listing, review.listingType),
    business: toAdminBusiness(business),
  };
};

const loadReviewContexts = async (reviews) => {
  const userIds = new Set();
  const listingIdsByType = {
    product: new Set(),
    service: new Set(),
    food: new Set(),
  };

  reviews.forEach((review) => {
    userIds.add(normalizeId(review.userId));
    if (listingIdsByType[review.listingType]) {
      listingIdsByType[review.listingType].add(normalizeId(review.listingId));
    }
  });

  const [users, productListings, serviceListings, foodListings] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } })
      .select(USER_SELECT)
      .lean(),
    listingIdsByType.product.size
      ? LISTING_MODELS.product
          .find({ _id: { $in: [...listingIdsByType.product] } })
          .select(LISTING_SELECT)
          .lean()
      : [],
    listingIdsByType.service.size
      ? LISTING_MODELS.service
          .find({ _id: { $in: [...listingIdsByType.service] } })
          .select(LISTING_SELECT)
          .lean()
      : [],
    listingIdsByType.food.size
      ? LISTING_MODELS.food
          .find({ _id: { $in: [...listingIdsByType.food] } })
          .select(LISTING_SELECT)
          .lean()
      : [],
  ]);

  const listings = new Map();
  productListings.forEach((listing) => {
    listings.set(`product:${normalizeId(listing._id)}`, listing);
  });
  serviceListings.forEach((listing) => {
    listings.set(`service:${normalizeId(listing._id)}`, listing);
  });
  foodListings.forEach((listing) => {
    listings.set(`food:${normalizeId(listing._id)}`, listing);
  });

  const businessIds = new Set();
  [...productListings, ...serviceListings, ...foodListings].forEach((listing) => {
    if (listing?.businessId) {
      businessIds.add(normalizeId(listing.businessId));
    }
  });

  const businesses = await Business.find({ _id: { $in: [...businessIds] } })
    .select(BUSINESS_SELECT)
    .lean();

  return {
    users: new Map(users.map((user) => [normalizeId(user._id), user])),
    listings,
    businesses: new Map(businesses.map((business) => [normalizeId(business._id), business])),
  };
};

exports.listAllPlatformReviews = async (req, res) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const skip = (page - 1) * limit;
    const { filter, empty } = await buildReviewFilter(req.query);

    if (empty) {
      return res.status(200).json({
        success: true,
        data: {
          reviews: [],
          pagination: {
            total: 0,
            page,
            limit,
            totalPages: 0,
          },
        },
      });
    }

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);

    const context = await loadReviewContexts(reviews);

    return res.status(200).json({
      success: true,
      data: {
        reviews: reviews.map((review) => toAdminReviewRecord(review, context)),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 0,
        },
      },
    });
  } catch (error) {
    console.error('listAllPlatformReviews error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch platform reviews',
    });
  }
};

exports.toggleReviewVisibility = async (req, res) => {
  try {
    const { reviewId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID',
      });
    }

    const review = await Review.findById(reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    review.isHidden = !review.isHidden;
    review.moderatedAt = new Date();
    await review.save();

    const summary = await refreshListingReviewStats(review.listingId, review.listingType);

    return res.status(200).json({
      success: true,
      message: review.isHidden ? 'Review hidden successfully' : 'Review restored successfully',
      data: {
        review: {
          _id: normalizeId(review._id),
          listingId: normalizeId(review.listingId),
          listingType: review.listingType,
          isHidden: review.isHidden,
          moderatedAt: normalizeDate(review.moderatedAt),
        },
        summary,
      },
    });
  } catch (error) {
    console.error('toggleReviewVisibility error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update review visibility',
    });
  }
};

exports.removePlatformReview = async (req, res) => {
  try {
    const { reviewId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID',
      });
    }

    const review = await Review.findById(reviewId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    const listingId = review.listingId;
    const listingType = review.listingType;

    await review.deleteOne();

    const summary = await refreshListingReviewStats(listingId, listingType);

    return res.status(200).json({
      success: true,
      message: 'Review removed successfully',
      data: {
        reviewId: normalizeId(reviewId),
        listingId: normalizeId(listingId),
        listingType,
        summary,
      },
    });
  } catch (error) {
    console.error('removePlatformReview error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove review',
    });
  }
};
