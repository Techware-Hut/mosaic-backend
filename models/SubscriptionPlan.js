// models/SubscriptionPlan.js
const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    enum: ['Launch Plan', 'Growth Plan', 'Legacy Plan'],
  },
  price: {
    type: Number,
    required: true,
  },
  currency: { type: String, default: 'usd' },
  interval: { type: String, enum: ['day', 'week', 'month', 'year'], default: 'year' },
  intervalCount: { type: Number, default: 1 },
  trialPeriodDays: { type: Number, default: 0 },

  durationInDays: {
    type: Number,
    default: 365, // Annual by default
  },

  stripeProductId: { type: String },
  stripePriceId: { type: String, unique: true, sparse: true },
  
  limits: {
    productListings: { type: Number, required: true },
    serviceListings: { type: Number, required: true },
    foodListings: { type: Number, required: true },
    imageLimit: { type: Number, required: true },
    videoLimit: { type: Number, required: true },
  },
  
  features: {
    analyticsDashboard: { type: Boolean, default: false },
    marketingTools: { type: Boolean, default: false },
    featuredPlacement: { type: Boolean, default: false },
    supportLevel: { type: String, enum: ['none', 'community', 'email', 'priority'], default: 'none' },
    communityEventsAccess: { type: Boolean, default: false },
    searchPriority: { type: Boolean, default: false },
    listingPriority: { type: Boolean, default: false },
    pushNotifications: { type: Boolean, default: false },
    aiRecommendation: { type: Boolean, default: false },
    topTierPlacement: { type: Boolean, default: false },
    topTierVisibility: { type: Boolean, default: false }
  },
}, { timestamps: true });

module.exports = mongoose.models.SubscriptionPlan || mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
