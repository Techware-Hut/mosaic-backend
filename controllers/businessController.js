const Business = require("../models/Business");
const Subscription = require("../models/Subscription");
const { uploadFile } = require("../utils/uploadFile");
const cleanupUploads = require("../utils/cleanupUploads");
const deleteCloudinaryFile = require("../utils/deleteCloudinaryFile");
const { verifyPayPalPayment } = require("../utils/paypalVerification");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const VendorOnboardingStage1 = require("../models/VendorOnboardingStage1");
const {
  normalizeShippingSettingsInput,
} = require("../utils/vendorShipping");
const {
  normalizeTaxSettingsInput,
  serializeTaxSettings,
} = require("../utils/vendorTax");
const { toPublicBusinessCard } = require("../lib/listing/publicListingDto");

exports.createBusiness = async (req, res) => {
  try {
    const user = req.user;
    const {
      businessName,
      subscriptionPlanId,
      stripeSubscriptionId,
      paymentStatus,
      payerEmail,
      payerId,
    } = req.body;

    // Required fields check
    if (!subscriptionPlanId || !stripeSubscriptionId || !paymentStatus) {
      cleanupUploads(req.files);
      return res
        .status(400)
        .json({ message: "Missing subscription or payment info." });
    }

    // Enforce completed payment
    if (paymentStatus !== "COMPLETED") {
      cleanupUploads(req.files);
      return res
        .status(400)
        .json({
          message: "Payment not completed. Try again after confirmation.",
        });
    }

    // Check if subscription already exists for this stripeSubscriptionId
    let subscription = await Subscription.findOne({ stripeSubscriptionId });

    if (!subscription) {
      const now = new Date();
      const endDate = new Date();
      endDate.setFullYear(now.getFullYear() + 1); // 1-year plan

      subscription = new Subscription({
        userId: user._id,
        subscriptionPlanId,
        stripeSubscriptionId,
        paymentStatus,
        payerEmail,
        payerId,
        startDate: now,
        endDate,
        status: "active",
        businessId: null,
      });

      await subscription.save();
    }

    // Prevent reusing subscription
    if (subscription.businessId) {
      cleanupUploads(req.files);
      return res
        .status(400)
        .json({ message: "This payment is already linked to a business." });
    }

    // Check for duplicate business name
    const nameToCheck = businessName?.trim();
    const existingBusiness = await Business.findOne({
      businessName: { $regex: new RegExp(`^${nameToCheck}$`, "i") },
    });

    if (existingBusiness) {
      return res.status(409).json({
        message:
          "Business name already exists. Your subscription is saved. Please retry with a different name.",
        subscription,
      });
    }

    // Upload files to Cloudinary

    let logoUrl, coverUrl;
    if (req.files?.logo?.[0]) {
      logoUrl = await uploadFile(req.files.logo[0], "business/logos");
      console.log("Business logo uploaded successfully");
    }
    if (req.files?.coverImage?.[0]) {
      coverUrl = await uploadFile(req.files.coverImage[0], "business/covers");
    }

    // Extract form fields
    const {
      description,
      email,
      phone,
      website,
      address,
      socialLinks,
      listingType,
      productCategories,
      serviceCategories,
      foodCategories,
    } = req.body;

    const hasProduct =
      Array.isArray(productCategories) && productCategories.length > 0;
    const hasService =
      Array.isArray(serviceCategories) && serviceCategories.length > 0;
    const hasFood = Array.isArray(foodCategories) && foodCategories.length > 0;

    // const typeCount = [hasProduct, hasService, hasFood].filter(Boolean).length;
    // if (typeCount !== 1) {
    //   cleanupUploads(req.files);
    //   return res.status(400).json({
    //     message: 'A business must list exactly one type: either Product, Service, or Food.',
    //   });
    // }

    // Create business
    const newBusiness = new Business({
      businessName,
      description,
      email,
      phone,
      website,
      address: {
        street: req.body.address || "",
        city: req.body.city,
        state: req.body.state,
        country: req.body.country,
      },
      socialLinks,
      listingType,
      productCategories,
      serviceCategories,
      foodCategories,
      logo: logoUrl,
      coverImage: coverUrl,
      owner: user._id,
      isApproved: true,
      isActive: true,
      subscriptionId: subscription._id,
      stripeSubscriptionId,
      minorityType: user.minorityType,
    });

    await newBusiness.save();

    // Link business to subscription
    subscription.businessId = newBusiness._id;
    await subscription.save();

    res.status(201).json({
      message: "Business and subscription created successfully",
      business: newBusiness,
      subscription,
    });
  } catch (error) {
    cleanupUploads(req.files);
    console.error("Business creation error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getMyBusinesses = async (req, res) => {
  try {
    const businesses = await Business.find({ owner: req.user._id })
      .populate("productCategories.category")
      .populate("serviceCategories.category")
      .populate("foodCategories.category")
      .populate("subscriptionId")
      .sort({ createdAt: -1 });

    res.status(200).json({
      count: businesses.length,
      businesses,
    });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getBusinessShippingSettings = async (req, res) => {
  try {
    const business = await Business.findOne({
      _id: req.params.id,
      owner: req.user._id,
    }).select("shippingSettings");

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    return res.status(200).json({
      success: true,
      shippingSettings: business.shippingSettings || {
        method: null,
        freeShipping: { enabled: false, threshold: null },
        flatRate: null,
        quantityTiers: [],
      },
    });
  } catch (error) {
    console.error("Error fetching shipping settings:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateBusinessShippingSettings = async (req, res) => {
  try {
    const business = await Business.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    let shippingSettings;
    try {
      shippingSettings = normalizeShippingSettingsInput(req.body);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message,
      });
    }

    business.shippingSettings = shippingSettings;
    await business.save();

    return res.status(200).json({
      success: true,
      message: "Shipping settings updated successfully",
      shippingSettings: business.shippingSettings,
    });
  } catch (error) {
    console.error("Error updating shipping settings:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getBusinessTaxSettings = async (req, res) => {
  try {
    const business = await Business.findOne({
      _id: req.params.id,
      owner: req.user._id,
    }).select("owner taxSettings");

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const onboarding = await VendorOnboardingStage1.findOne({
      userId: business.owner,
    }).select("address.state");

    return res.status(200).json({
      success: true,
      taxSettings: serializeTaxSettings({
        registeredState: onboarding?.address?.state || null,
        taxSettings: business.taxSettings,
      }),
    });
  } catch (error) {
    console.error("Error fetching tax settings:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateBusinessTaxSettings = async (req, res) => {
  try {
    const business = await Business.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    const onboarding = await VendorOnboardingStage1.findOne({
      userId: business.owner,
    }).select("address.state");

    const registeredState = String(onboarding?.address?.state || "").trim();
    if (!registeredState) {
      return res.status(400).json({
        success: false,
        message: "Vendor onboarding state must be set before configuring tax settings",
      });
    }

    let taxSettings;
    try {
      taxSettings = normalizeTaxSettingsInput(req.body);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message,
      });
    }

    business.taxSettings = taxSettings;
    await business.save();

    return res.status(200).json({
      success: true,
      message: "Tax settings updated successfully",
      taxSettings: serializeTaxSettings({
        registeredState,
        taxSettings: business.taxSettings,
      }),
    });
  } catch (error) {
    console.error("Error updating tax settings:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateBusiness = async (req, res) => {
  try {
    const user = req.user;
    const businessId = req.params.id;

    const business = await Business.findOne({
      _id: businessId,
      owner: user._id,
    });
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    // Check if new name is being updated and is unique
    if (
      req.body.businessName &&
      req.body.businessName !== business.businessName
    ) {
      const nameExists = await Business.findOne({
        businessName: { $regex: new RegExp(`^${req.body.businessName}$`, "i") },
        _id: { $ne: businessId },
      });
      if (nameExists) {
        return res.status(409).json({ message: "Business name already taken" });
      }

      // Generate new slug if business name changes
      const baseSlug = slugify(req.body.businessName, {
        lower: true,
        strict: true,
      });
      let slug = baseSlug;
      let counter = 1;

      while (await Business.findOne({ slug, _id: { $ne: business._id } })) {
        slug = `${baseSlug}-${counter++}`;
      }

      business.businessName = req.body.businessName;
      business.slug = slug;
    }

    // Keep references to old images (for post-save cleanup if they change)
    const oldLogo = business.logo;
    const oldCover = business.coverImage;

    // Accept URLs from presigned-upload flow (JSON)
    const incomingLogoUrl = req.body?.logo;
    const incomingCoverUrl = req.body?.coverImage;

    if (incomingLogoUrl !== undefined) {
      business.logo = incomingLogoUrl || null; // allow clearing if empty string/null sent intentionally
    }
    if (incomingCoverUrl !== undefined) {
      business.coverImage = incomingCoverUrl || null;
    }

    // Update other fields
    const updatableFields = [
      "businessName",
      "description",
      "email",
      "phone",
      "website",
      "listingType",
      "productCategories",
      "serviceCategories",
      "foodCategories",
    ];

    updatableFields.forEach((field) => {
      if (req.body[field] !== undefined) business[field] = req.body[field];
    });

    if (req.body.address) {
      business.address = { ...business.address, ...req.body.address };
    }

    if (req.body.socialLinks) {
      business.socialLinks = {
        ...business.socialLinks,
        ...req.body.socialLinks,
      };
    }

    await business.save();

    // Delete old S3 files if replaced
    if (oldLogo && oldLogo !== business.logo) {
      try {
        await deleteCloudinaryFile(oldLogo);
      } catch (e) {
        console.warn("Old logo delete failed:", e?.message || e);
      }
    }
    if (oldCover && oldCover !== business.coverImage) {
      try {
        await deleteCloudinaryFile(oldCover);
      } catch (e) {
        console.warn("Old cover delete failed:", e?.message || e);
      }
    }

    return res.json({ message: "Business updated successfully", business });
  } catch (error) {
    // Attempt cleanup of newly provided presigned-upload URLs if save failed
    try {
      if (req.body?.logo) await deleteCloudinaryFile(req.body.logo);
    } catch (e) {
      console.warn("Cleanup new logo failed:", e?.message || e);
    }
    try {
      if (req.body?.coverImage) await deleteCloudinaryFile(req.body.coverImage);
    } catch (e) {
      console.warn("Cleanup new cover failed:", e?.message || e);
    }

    console.error("Update error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteBusiness = async (req, res) => {
  try {
    const user = req.user;
    const businessId = req.params.id;

    const business = await Business.findOne({
      _id: businessId,
      owner: user._id,
    });
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    // Delete Cloudinary files if present
    if (business.logo) {
      await deleteCloudinaryFile(business.logo);
    }
    if (business.coverImage) {
      await deleteCloudinaryFile(business.coverImage);
    }

    // Unlink subscription
    await Subscription.updateOne(
      { _id: business.subscriptionId },
      { $set: { businessId: null } }
    );

    await business.deleteOne();

    res.json({ message: "Business deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// draft model;

const { body, validationResult } = require("express-validator");
const BusinessDraft = require("../models/BusinessDraft");

// Validation middleware for formData
const validateBusinessDraft = [
  body("businessName").notEmpty().withMessage("Business name is required"),
  body("email").isEmail().withMessage("Valid email is required"),
  body("subscriptionPlanId")
    .notEmpty()
    .withMessage("Subscription Plan ID is required"),
  body("formData.address").notEmpty().withMessage("Address is required"),
  body("formData.city").notEmpty().withMessage("City is required"),
  body("formData.state").notEmpty().withMessage("State is required"),
  body("formData.country").notEmpty().withMessage("Country is required"),
  body("formData.listingType")
    .isIn(["product", "service", "food"])
    .withMessage("Listing type must be one of product, service, or food"),
  // Add other form fields validation as necessary
];

// Controller to create business draft
exports.createBusinessDraft = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { businessName, email, subscriptionPlanId, formData } = req.body;
    const user = req.user;

    // Validate required fields
    if (!businessName || !email || !subscriptionPlanId || !formData) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    if (
      !formData.address ||
      !formData.city ||
      !formData.state ||
      !formData.zipCode ||
      !formData.country
    ) {
      return res
        .status(400)
        .json({ message: "Incomplete address fields in formData." });
    }

    // Category validation: Only one category (Product, Service, or Food) allowed
    const { productCategories, serviceCategories, foodCategories } = formData;
    const hasProduct =
      Array.isArray(productCategories) && productCategories.length > 0;
    const hasService =
      Array.isArray(serviceCategories) && serviceCategories.length > 0;
    const hasFood = Array.isArray(foodCategories) && foodCategories.length > 0;
    const typeCount = [hasProduct, hasService, hasFood].filter(Boolean).length;

    if (typeCount !== 1) {
      return res.status(400).json({
        message:
          "A business must list exactly one type: either Product, Service, or Food.",
      });
    }

    // Check if business name already exists as a draft
    const existingDraft = await BusinessDraft.findOne({ businessName });
    if (existingDraft) {
      return res
        .status(409)
        .json({
          message: "Business name already reserved. Please choose another.",
        });
    }

    // Check in live businesses
    const existingBusiness = await Business.findOne({ businessName });
    if (existingBusiness) {
      return res
        .status(409)
        .json({
          message: "Business name already in use. Please choose another.",
        });
    }

    // Validate subscription plan
    const subscriptionPlan = await SubscriptionPlan.findById(
      subscriptionPlanId
    );
    if (!subscriptionPlan) {
      return res.status(400).json({ message: "Invalid subscription plan." });
    }

    // Set expiration time for the draft (15 minutes TTL)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Create the business draft
    const draft = await BusinessDraft.create({
      businessName,
      email,
      owner: user._id,
      minorityType: user.minorityType,
      subscriptionPlanId,
      formData,
      expiresAt,
    });

    res.status(201).json({
      message: "Draft created. Please complete payment within 15 minutes.",
      draftId: draft._id,
      businessName: draft.businessName,
      expiresAt,
      subscriptionPlanId,
    });
  } catch (error) {
    console.error("Error creating business draft:", error);
    res
      .status(500)
      .json({
        message: "Failed to create business draft. Please try again later.",
      });
  }
};

/////////////////////////                   Retry Business Cretion

exports.retryCreateBusiness = async (req, res) => {
  const { subscriptionId, businessName, formData } = req.body; // Get subscriptionId and business data from the request

  try {
    // Find the subscription using the provided subscriptionId
    const subscription = await Subscription.findById(subscriptionId).populate(
      "userId"
    );
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found." });
    }

    // Check if the userId from the request matches the subscription's userId
    if (req.user.id !== subscription.userId._id.toString()) {
      return res
        .status(403)
        .json({
          message: "You are not authorized to access this subscription.",
        });
    }

    // If subscription already has a business linked, prevent retry
    if (subscription.businessId) {
      return res
        .status(400)
        .json({
          message: "This subscription is already linked to a business.",
        });
    }

    // Check if the payment status is 'COMPLETED'
    if (subscription.paymentStatus !== "COMPLETED") {
      return res
        .status(400)
        .json({
          message:
            "Payment is not completed. Please ensure payment has been made.",
        });
    }

    // Validate the business name (avoid duplicates)
    let businessNameToCheck = businessName.trim();
    let existingBusiness = await Business.findOne({
      businessName: { $regex: new RegExp(`^${businessNameToCheck}$`, "i") },
    });

    let counter = 1;
    while (existingBusiness) {
      businessNameToCheck = `${businessName}-${counter}`;
      existingBusiness = await Business.findOne({
        businessName: { $regex: new RegExp(`^${businessNameToCheck}$`, "i") },
      });
      counter++;
    }

    // Extract business data from the request body
    const {
      description,
      email,
      phone,
      website,
      address,
      socialLinks,
      listingType,
      productCategories,
      serviceCategories,
      foodCategories,
    } = formData;

    // Check if exactly one listing type is provided (Product, Service, or Food)
    const hasProduct =
      Array.isArray(productCategories) && productCategories.length > 0;
    const hasService =
      Array.isArray(serviceCategories) && serviceCategories.length > 0;
    const hasFood = Array.isArray(foodCategories) && foodCategories.length > 0;

    const typeCount = [hasProduct, hasService, hasFood].filter(Boolean).length;
    if (typeCount !== 1) {
      return res.status(400).json({
        message:
          "A business must list exactly one type: either Product, Service, or Food.",
      });
    }

    // Create the new business using the existing subscription
    const business = new Business({
      owner: subscription.userId._id,
      businessName: businessNameToCheck,
      email: formData.email,
      description: formData.description,
      phone: formData.phoneNumber,
      listingType: formData.listingType,
      address: {
        street: formData.address || "",
        city: formData.city || "",
        state: formData.state || "",
        country: formData.country || "",
        zipCode: formData.zipCode || "",
      },
      taxId: draft.formData.taxId,
      businessLicenseNumber: draft.formData.businessLicenseNumber,
      isFranchise: draft.formData.isFranchise,
      franchiseLocation: draft.formData.franchiseLocation,
      socialLinks: formData.socialLinks || {},
      productCategories: formData.productCategories || [],
      serviceCategories: formData.serviceCategories || [],
      foodCategories: formData.foodCategories || [],
      logo: formData.logo || "", // Assuming logo is passed in formData, if no logo, set it to an empty string
      coverImage: formData.coverImage || "", // Same for coverImage
      minorityType: subscription.userId.minorityType,
      isApproved: true,
      isActive: true, // Default to active; admin can deactivate later if needed
      subscriptionId: subscription._id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    });

    // Save the new business
    await business.save();

    // Link the business to the subscription
    subscription.businessId = business._id;
    await subscription.save();

    res.status(200).json({
      message: "Business created successfully.",
      business,
      subscription,
    });
  } catch (error) {
    console.error("Error retrying business creation:", error);
    res
      .status(500)
      .json({
        message: "Error retrying business creation. Please try again later.",
      });
  }
};

exports.getProductBusinesses = async (req, res) => {
  try {
    const {
      search = "",
      city,
      state,
      country,
      productCategory,
      tag,
      tags,
      zip,
      page = 1,
      limit = 10,
    } = req.query;

    const filters = {
      listingType: "product",
      isActive: true,
      isApproved: true,
    };

    if (search) filters.businessName = { $regex: search, $options: "i" };
    if (city) filters["address.city"] = city;
    if (state) filters["address.state"] = state;
    if (country) filters["address.country"] = country;
    if (productCategory) {
      const categoryIds = productCategory.split(",");
      filters.productCategories = { $in: categoryIds };
    }

    const tagList = String(tags || tag || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (tagList.length) {
      const tagClause = {
        $or: tagList.map((item) => ({
          tags: new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        })),
      };
      if (filters.businessName) {
        filters.$and = [{ businessName: filters.businessName }, tagClause];
        delete filters.businessName;
      } else {
        Object.assign(filters, tagClause);
      }
    }

    const normalizedZip = String(zip || "").trim();
    if (normalizedZip) {
      filters["address.zipCode"] = new RegExp(
        `^${normalizedZip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      );
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const businesses = await Business.find(filters)
      .select("businessName slug logo") // ✅ Only these fields
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Business.countDocuments(filters);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: businesses.map((business) =>
        toPublicBusinessCard(business.toObject ? business.toObject() : business)
      ),
    });
  } catch (err) {
    console.error("Error fetching businesses:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getBusinessBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const business = await Business.findOne({
      slug,
      owner: req.user._id,
    })
      .populate({
        path: "subscriptionId",
        populate: {
          path: "subscriptionPlanId",
          model: "SubscriptionPlan",
        },
      })
      .lean();

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found or you are not authorized",
      });
    }

    // ✅ Separate subscriptionId & subscriptionPlanId from business
    const subscription = business.subscriptionId || null;
    const subscriptionPlan = subscription?.subscriptionPlanId || null;

    // ✅ Remove them from business if you don't want duplication
    if (business.subscriptionId) {
      delete business.subscriptionId.subscriptionPlanId;
    }

    res.status(200).json({
      success: true,
      data: {
        business,
        subscription,
        subscriptionPlan,
      },
    });
  } catch (err) {
    console.error("Error fetching private business by slug:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.getBusinessBySlugPublic = async (req, res) => {
  try {
    const { slug } = req.params;
    const business = await Business.findOne({
      slug,
      isActive: true,
      listingType: "product", // ✅ Only product businesses
    })
      .select(
        "businessName description logo coverImage website email phone address listingType slug"
      )
      .lean();

    if (!business) {
      return res.status(404).json({
        success: false,
        message: "Business not found or not a product listing",
      });
    }

    res.status(200).json({
      success: true,
      data: toPublicBusinessCard(business),
    });
  } catch (err) {
    console.error("Error fetching public business by slug:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
