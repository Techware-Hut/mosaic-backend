const mongoose = require("mongoose");

const VendorOnboardingStage1Schema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      index: true,
    },
    applicationId: {
      type: String,
      unique: true,
      index: true,
      immutable: true,
    },

    /* BUSINESS IDENTITY */
    businessName: String,

    isMinorityOwned: Boolean,

    minorityCategories: [
      {
        type: String,
        enum: [
          "African-American",
          "Asian",
          "LatinX",
          "Woman",
          "Disabled Veteran",
          "Other",
        ],
      },
    ],

    minorityProofDocuments: [
      {
        url: String,
        verified: { type: Boolean, default: false },
      },
    ],

    /* TAX DETAILS */
    hasEIN: Boolean,

    einNumber: {
      type: String,
      match: /^[0-9]{9}$/,
    },

    ssnLast9: {
      type: String,
      match: /^[0-9]{9}$/,
    },

    taxDocuments: [
      {
        url: String,
        verified: { type: Boolean, default: false },
      },
    ],

    /* BUSINESS LICENSE */
    hasBusinessLicense: Boolean,

    businessLicenseDocuments: [
      {
        url: String,
        verified: { type: Boolean, default: false },
      },
    ],

    /* BUSINESS DETAILS */
    ownershipType: {
      type: String,
      enum: [
        "Limited Liability Company",
        "Sole Proprietor",
        "S-Corporation",
        "C-Corporation",
        "Nonprofit",
      ],
    },

    yearsInBusiness: {
      type: String,
      enum: ["6mo-1yr", "1yr-2yr", "2yr+"],
    },

    isFranchise: Boolean,
    franchiseName: String,

    businessType: {
      type: String,
      enum: ["product", "service", "food"],
    },

    usesThirdPartyBooking: Boolean,
    hasPhysicalLocation: Boolean,

    /* ONLINE PRESENCE */
    website: String,
    facebook: String,
    instagram: String,
    linkedin: String,
    tiktok: String,

    /* CONTACT DETAILS */
    primaryContactName: String,
    primaryContactDesignation: String,
    secondaryBusinessEmail: String,

    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },

    employeesCount: {
      type: String,
      enum: ["0-1", "2-5", "6-10", "10+"],
    },

    /* AGREEMENTS */
    acceptedTerms: {
      type: Boolean,
      default: false,
    },

    declarationAccepted: {
      type: Boolean,
      default: false,
    },

    /* PAYMENT */
    verificationPayment: {
      provider: { type: String, enum: ["stripe"] },
      paymentIntentId: String,
      status: {
        type: String,
        enum: ["not_started", "pending", "paid", "failed"],
        default: "not_started",
      },
      paidAt: Date,
    },

    /* STAGE STATUS */
    status: {
      type: String,
      enum: ["draft", "payment_pending", "submitted", "verified", "rejected"],
      default: "draft",
      index: true,
    },

    submittedAt: Date,

    /* ADMIN REVIEW METADATA (set by finalizeVerification only) */
    reviewDecision: {
      type: String,
      enum: ["approved", "rejected"],
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    adminReviewNotes: {
      type: String,
      trim: true,
    },
    requiredNextAction: {
      type: String,
      trim: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: Date,
    verifiedAt: Date,
    rejectedAt: Date,

    profileCompletionNotifiedAt: Date,

    verificationNotificationLog: [
      {
        event: String,
        fingerprint: String,
        applicationStatus: String,
        deliveryStatus: {
          type: String,
          enum: ["sent", "skipped", "failed"],
        },
        labels: [String],
        messageIds: [String],
        reasonSummary: String,
        documentsNeeded: [String],
        fieldsNeeded: [String],
        responseWindowDays: Number,
        triggeredBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        attemptedAt: {
          type: Date,
          default: Date.now,
        },
        error: String,
      },
    ],

    totalVerificationPoints: {
      type: Number,
      default: 0,
    },

    badge: {
      type: String,
      enum: ["Bronze", "Silver", "Gold", "Platinum", "Diamond"],
    },
    
    verificationChecklist: {
      minorityDocs: { type: Boolean, default: false },
      taxDocs: { type: Boolean, default: false },
      businessLicense: { type: Boolean, default: false },
      website: { type: Boolean, default: false },
      facebook: { type: Boolean, default: false },
      instagram: { type: Boolean, default: false },
      linkedin: { type: Boolean, default: false },
      tiktok: { type: Boolean, default: false },
      businessProfileImage: { type: Boolean, default: false },
      businessBio: { type: Boolean, default: false },
      refundPolicyDocument: { type: Boolean, default: false },
      termsDocument: { type: Boolean, default: false },
      googleReviewLink: { type: Boolean, default: false },
      communityServiceLink: { type: Boolean, default: false },
    },

    /* ===== ADDED MISSING FIELDS FROM SCREENSHOT ===== */
    
    /* PERSONAL INFORMATION */
    firstName: String,
    lastName: String,
    primaryEmail: String,
    primaryPhone: String,
    language: String,
    
    /* BUSINESS INFORMATION - ADDITIONAL */
    licenseNumber: String,
    businessBio: String,
    characterLimit: Number,
    businessProfileImage: {
      url: String,
      verified: { type: Boolean, default: false }
    },
    
    featureBanner: {
      url: String,
      verified: { type: Boolean, default: false }
    },
    
    /* CONTACT INFORMATION - ADDITIONAL */
    businessEmail: String,
    businessPhone: String,
    alternatePhone: String,
    
    /* SOCIAL MEDIA - ADDITIONAL */
    twitter: String,
    
    /* ADDITIONAL DOCUMENTS & LINKS */
    refundPolicyDocument: {
      url: String,
      verified: { type: Boolean, default: false }
    },
    termsDocument: {
      url: String,
      verified: { type: Boolean, default: false }
    },
    googleReviewLink: String,
    communityServiceLink: String,

  },
  { timestamps: true }
);

VendorOnboardingStage1Schema.pre("save", function (next) {
  if (!this.applicationId) {
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.applicationId = `MBH-APP-${Date.now()}-${random}`;
  }
  next();
});

VendorOnboardingStage1Schema.pre("validate", function (next) {
  if (this.badge === "Bronze") {
    this.badge = "Silver";
  }
  next();
});

module.exports =
  mongoose.models.VendorOnboardingStage1 ||
  mongoose.model("VendorOnboardingStage1", VendorOnboardingStage1Schema);
