const mongoose = require("mongoose");
const slugify = require("slugify");

const businessSchema = new mongoose.Schema(
  {
    // ===== CORE BUSINESS INFO =====
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    businessName: {
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
      trim: true,
    },
    logo: {
      type: String,
    },
    coverImage: {
      type: String,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
    },
    
    // ===== ADDRESS =====
    address: {
      street: { type: String },
      city: { type: String },
      state: { type: String },
      zipCode: { type: String },
      country: { type: String },
    },
    
    // ===== LOCATION FOR GEO SEARCH =====
    // location: {
    //   type: { type: String, enum: ['Point'], default: 'Point' },
    //   coordinates: { type: [Number], index: '2dsphere' }, // [longitude, latitude]
    // },
    
    // ===== SOCIAL MEDIA =====
    socialLinks: {
      facebook: String,
      instagram: String,
      twitter: String,
      linkedin: String,
      tiktok: String,
      website: String,
    },
    
    // ===== BUSINESS TYPE =====
    listingType: {
      type: String,
      enum: ["product", "service", "food"],
      required: true,
    },
    
    // ===== SUBSCRIPTION REFERENCE (CRITICAL) =====
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    subscriptionPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "expired", "cancelled", "pending"],
      default: "active",
    },
    stripeSubscriptionId: String,
    subscriptionStartDate: Date,
    subscriptionEndDate: Date,
    
    // ===== USAGE COUNTERS (TRACK CURRENT USAGE) =====
    usage: {
      totalProducts: { type: Number, default: 0 },
      totalServices: { type: Number, default: 0 },
      totalFoods: { type: Number, default: 0 },
      totalImages: { type: Number, default: 0 },
      totalVideos: { type: Number, default: 0 },
      featuredUsed: { type: Number, default: 0 },
    },
    
    // ===== PRODUCT/SERVICE REFERENCES =====
    products: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    }],
    services: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
    }],
    foods: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Food",
    }],
    
    // ===== CATEGORIES =====
    productCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategory",
    }],
    serviceCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceCategory",
    }],
    foodCategories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "FoodCategory",
    }],
    
    // ===== BUSINESS HOURS (FOR SERVICES) =====
    businessHours: {
      monday: { open: String, close: String, closed: Boolean },
      tuesday: { open: String, close: String, closed: Boolean },
      wednesday: { open: String, close: String, closed: Boolean },
      thursday: { open: String, close: String, closed: Boolean },
      friday: { open: String, close: String, closed: Boolean },
      saturday: { open: String, close: String, closed: Boolean },
      sunday: { open: String, close: String, closed: Boolean },
    },
    
    // ===== STATUS FIELDS =====
    isApproved: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: false, // Stays false until Stage 6 publish-storefront completes.
    },
    approvalDate: Date,
    adminStatusRemark: {
      type: String,
      trim: true,
      default: "",
    },
    adminStatusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    adminStatusUpdatedAt: Date,
    deactivatedAt: Date,

    // ===== VERIFICATION SCORE & BADGE =====
    points: {
      type: Number,
      default: 0,
    },
    badge: {
      type: String,
      enum: ["Bronze","Silver", "Gold", "Platinum", "Diamond"],
    },
    // ===== STRIPE CONNECT (FOR PAYOUTS) =====
    stripeConnectAccountId: String,
    chargesEnabled: { type: Boolean, default: false },  
    payoutsEnabled: { type: Boolean, default: false },
    onboardingStatus: {
      type: String,
      enum: ["not_started", "in_progress", "requirements_due", "completed"],
      default: "not_started",
    },
    capabilities: {
      card_payments: { type: String, default: "inactive" },
      transfers: { type: String, default: "inactive" },
    },
    onboardedAt: Date,
    stripeCustomerId: String,
    
    // ===== FEATURED STATUS =====
    isFeatured: { type: Boolean, default: false },
    featuredUntil: Date,
    
    // ===== TAGS FOR SEARCH =====
    tags: [String],

    // ===== VENDOR PROFILE (synced from onboarding) =====
    language: {
      type: String,
      trim: true,
    },
    minorityCategories: [String],
    
    // ===== MINORITY TYPE (REFERENCE) =====
    minorityType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MinorityType",
    },
    
    // ===== BUSINESS METRICS (FOR ANALYTICS) =====
    metrics: {
      totalViews: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0 },
      reviewCount: { type: Number, default: 0 },
    },

    shippingSettings: {
      method: {
        type: String,
        enum: ["flat_rate", "quantity_based"],
        default: null,
      },
      freeShipping: {
        enabled: { type: Boolean, default: false },
        threshold: { type: Number, default: null },
      },
      flatRate: {
        standard: { type: Number, default: null },
        express: { type: Number, default: null },
        local: { type: Number, default: null },
      },
      quantityTiers: [
        {
          minQuantity: { type: Number, required: true },
          maxQuantity: { type: Number, default: null },
          rates: {
            standard: { type: Number, required: true },
            express: { type: Number, required: true },
            local: { type: Number, required: true },
          },
        },
      ],
    },

    taxSettings: {
      enabled: {
        type: Boolean,
        default: false,
      },
      categories: [
        {
          code: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          rate: { type: Number, required: true, min: 0, max: 100 },
        },
      ],
    },
    
  },
  { timestamps: true }
);

// ===== INDEXES FOR PERFORMANCE =====
businessSchema.index({ location: '2dsphere' });
businessSchema.index({ tags: 1 });
businessSchema.index({ isActive: 1, isApproved: 1 });
businessSchema.index({ 'usage.totalProducts': 1 });

// ===== METHODS TO CHECK LIMITS =====
businessSchema.methods.getPlan = async function() {
  const Subscription = mongoose.model('Subscription');
  const subscription = await Subscription.findById(this.subscriptionId)
    .populate('subscriptionPlanId');
  return subscription?.subscriptionPlanId;
};

businessSchema.methods.canAddProduct = async function() {
  const plan = await this.getPlan();
  if (!plan) return false;
  return this.usage.totalProducts < plan.limits.productListings;
};

businessSchema.methods.canAddService = async function() {
  const plan = await this.getPlan();
  if (!plan) return false;
  return this.usage.totalServices < plan.limits.serviceListings;
};

businessSchema.methods.canAddFood = async function() {
  const plan = await this.getPlan();
  if (!plan) return false;
  return this.usage.totalFoods < plan.limits.foodListings;
};

businessSchema.methods.canUploadImage = async function() {
  const plan = await this.getPlan();
  if (!plan) return false;
  const totalListings = this.usage.totalProducts + this.usage.totalServices + this.usage.totalFoods;
  const maxImages = totalListings * (plan.limits.imageLimit || 10);
  return this.usage.totalImages < maxImages;
};

businessSchema.methods.getRemainingProducts = async function() {
  const plan = await this.getPlan();
  if (!plan) return 0;
  return Math.max(0, plan.limits.productListings - this.usage.totalProducts);
};

businessSchema.methods.getRemainingServices = async function() {
  const plan = await this.getPlan();
  if (!plan) return 0;
  return Math.max(0, plan.limits.serviceListings - this.usage.totalServices);
};

businessSchema.methods.getRemainingFoods = async function() {
  const plan = await this.getPlan();
  if (!plan) return 0;
  return Math.max(0, plan.limits.foodListings - this.usage.totalFoods);
};

businessSchema.methods.getLimits = async function() {
  const plan = await this.getPlan();
  return plan?.limits || null;
};

// ===== PRE-SAVE HOOK FOR SLUG =====
businessSchema.pre("validate", function (next) {
  if (this.badge === "Bronze") {
    this.badge = "Silver";
  }
  next();
});

businessSchema.pre("save", async function (next) {
  if (!this.slug && this.businessName) {
    let baseSlug = slugify(this.businessName, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    while (await mongoose.models.Business.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = slug;
  }
  next();
});

module.exports = mongoose.models.Business || mongoose.model("Business", businessSchema);
