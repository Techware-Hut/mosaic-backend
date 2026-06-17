const VendorOnboarding = require("../models/VendorOnboardingStage1");
const User = require("../models/User");
const {
  sendAdminOnboardingSubmissionEmail,
  sendVendorSubmissionConfirmationEmail,
  sendAdminVendorProfileCompletedEmail,
} = require("../utils/WellcomeMailer");

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {
  stripProtectedVendorFields,
  applyVendorBusinessProfileFields,
  applyVendorDraftField,
} = require('../utils/vendorOnboardingProfileFields');
const { syncBusinessFromOnboarding } = require('../utils/syncBusinessFromOnboarding');

/* =====================================================
   COMMON VALIDATION HELPERS
===================================================== */

const isValidUrl = (url) => {
  const pattern =
    /^(https?:\/\/)?([\w\-])+\.{1}([a-zA-Z]{2,63})([\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/;
  return pattern.test(url);
};

const validateStage1Payload = (body) => {
  const errors = [];

  // 1. Business Name
  if (!body.businessName || body.businessName.trim().length < 2) {
    errors.push("Business name is required");
  }

  // 2. Minority owned validation
  // if (body.isMinorityOwned === false) {
  //   errors.push("Only minority-owned businesses are allowed");
  // }

  // if (
  //   body.isMinorityOwned === true &&
  //   (!Array.isArray(body.minorityCategories) ||
  //     body.minorityCategories.length === 0)
  // ) {
  //   errors.push("At least one minority category must be selected");
  // }

  // // 3. EIN / SSN validation
  // if (body.hasEIN === true) {
  //   if (!/^[0-9]{9}$/.test(body.einNumber || "")) {
  //     errors.push("Valid 9-digit EIN is required");
  //   }
  // } else {
  //   if (!/^[0-9]{9}$/.test(body.ssnLast9 || "")) {
  //     errors.push("Valid 9-digit SSN is required");
  //   }
  // }

  // // 4. Business License
  // if (body.hasBusinessLicense === false) {
  //   errors.push("Business license is mandatory to proceed");
  // }

  // // 5. Franchise validation
  // if (body.isFranchise === true && !body.franchiseName) {
  //   errors.push("Franchise name is required");
  // }

  // // 6. Business type
  // if (!["product", "service", "food"].includes(body.businessType)) {
  //   errors.push("Invalid business type");
  // }

  // // 7. URLs (optional but validated)
  // ["website", "facebook", "instagram", "linkedin", "tiktok"].forEach((field) => {
  //   if (body[field] && !isValidUrl(body[field])) {
  //     errors.push(`Invalid URL provided for ${field}`);
  //   }
  // });

  // // 8. Contact person
  // if (!body.primaryContactName) {
  //   errors.push("Primary contact name is required");
  // }

  // if (!body.primaryContactDesignation) {
  //   errors.push("Primary contact designation is required");
  // }

  // // 9. Address
  // if (!body.address?.street || !body.address?.city || !body.address?.country) {
  //   errors.push("Complete address is required");
  // }

  // // 10. Employees
  // if (
  //   body.employeesCount &&
  //   !["0-1", "2-5", "6-10", "10+"].includes(body.employeesCount)
  // ) {
  //   errors.push("Invalid employees count");
  // }

  // // 11. Agreements
  // if (!body.acceptedTerms || !body.declarationAccepted) {
  //   errors.push("Terms & declaration must be accepted");
  // }

  return errors;
};

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const isVendorProfileReadyForTrustBadgeVerification = (onboarding) => {
  const hasLogo = isNonEmptyString(onboarding?.businessProfileImage?.url);
  const hasBio = isNonEmptyString(onboarding?.businessBio);
  return hasLogo && hasBio;
};

/* =====================================================
   SAVE OR UPDATE DRAFT

   ===================================================== */

// updated save draft to handle new fields and preserve existing data it will uodate stustus dubmitted if app. is rejcted by admin

exports.saveDraft = async (req, res) => {
  try {
    const userId = req.user._id;
    const payload = { ...req.body };

    // 1️⃣ Check if onboarding exists
    let onboarding = await VendorOnboarding.findOne({ userId });

    // 2️⃣ ❌ Block ONLY if verified (not submitted)
    if (onboarding && onboarding.status === "verified") {
      return res.status(400).json({
        success: false,
        message: "Application already verified and cannot be edited",
      });
    }

    // 3️⃣ Create new onboarding if it doesn't exist
    if (!onboarding) {
      onboarding = new VendorOnboarding({
        userId,
        status: "draft",
      });
    }

    // 4️⃣ Remove protected admin/system fields
    const sanitizedPayload = stripProtectedVendorFields(payload);

    // 5️⃣ Map frontend fields
    if (sanitizedPayload.businessOwnershipType !== undefined) {
      sanitizedPayload.ownershipType = sanitizedPayload.businessOwnershipType;
      delete sanitizedPayload.businessOwnershipType;
    }

    if (sanitizedPayload.numberOfEmployees !== undefined) {
      sanitizedPayload.employeesCount = sanitizedPayload.numberOfEmployees;
      delete sanitizedPayload.numberOfEmployees;
    }

    if (sanitizedPayload.contactPhone !== undefined) {
      sanitizedPayload.primaryContactPhone = sanitizedPayload.contactPhone;
      sanitizedPayload.primaryPhone = sanitizedPayload.contactPhone;
      delete sanitizedPayload.contactPhone;
    }

    if (sanitizedPayload.contactEmail !== undefined) {
      sanitizedPayload.secondaryBusinessEmail = sanitizedPayload.contactEmail;
      delete sanitizedPayload.contactEmail;
    }

    // Social links mapping
    const urlFields = ["websiteUrl", "facebookUrl", "instagramUrl", "linkedinUrl", "tiktokUrl"];
    urlFields.forEach((field) => {
      if (sanitizedPayload[field] !== undefined) {
        const key = field.replace("Url", "");
        sanitizedPayload[key] = sanitizedPayload[field];
        delete sanitizedPayload[field];
      }
    });

    // 6️⃣ Apply payload
    Object.keys(sanitizedPayload).forEach((key) => {
      if (sanitizedPayload[key] !== undefined) {
        applyVendorDraftField(onboarding, key, sanitizedPayload[key]);
      }
    });

    // 7️⃣ Default fields
    const defaultFields = {
      firstName: "",
      lastName: "",
      businessName: "",
      primaryEmail: "",
      primaryPhone: "",
      primaryContactPhone: "",
      language: "",
      licenseNumber: "",
      businessBio: "",
      characterLimit: 0,
      businessProfileImage: { url: "", verified: false },
      businessEmail: "",
      businessPhone: "",
      alternatePhone: "",
      twitter: "",
      refundPolicyDocument: { url: "", verified: false },
      termsDocument: { url: "", verified: false },
      googleReviewLink: "",
      communityServiceLink: "",
      website: "",
      facebook: "",
      instagram: "",
      linkedin: "",
      tiktok: "",
      ownershipType: null,
      employeesCount: null,
      usesThirdPartyBooking: false,
    };

    Object.keys(defaultFields).forEach((key) => {
      if (onboarding[key] === undefined || onboarding[key] === null) {
        onboarding[key] = defaultFields[key];
      }
    });

    // 8️⃣ Status handling — draft save never auto-resubmits for admin review
    if (onboarding.status === 'rejected') {
      onboarding.status = 'draft';
    } else if (!onboarding.status) {
      onboarding.status = 'draft';
    }
    // 8️⃣ Save
    await onboarding.save();

    return res.status(200).json({
      success: true,
      message: "saved successfully",
      data: onboarding,
    });

  } catch (error) {
    console.error("Save draft error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save data",
      error: error.message,
    });
  }
};

// exports.saveDraft = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const payload = { ...req.body }; // copy of frontend data

//     // 1️⃣ Check if onboarding exists
//     let onboarding = await VendorOnboarding.findOne({ userId });

//     // 2️⃣ Lock if already submitted
//     if (onboarding && onboarding.status === "submitted") {
//       return res.status(400).json({
//         success: false,
//         message: "Onboarding already submitted",
//       });
//     }

//     // 3️⃣ Create new onboarding if it doesn't exist
//     if (!onboarding) {
//       onboarding = new VendorOnboarding({
//         userId,
//         status: "draft",
//       });
//     }

//     // 4️⃣ Remove forbidden fields from frontend
//     const forbiddenFields = ["verificationPayment", "status", "applicationId"];
//     forbiddenFields.forEach((field) => delete payload[field]);

//     // 5️⃣ Map frontend fields to schema fields
//     if (payload.businessOwnershipType !== undefined) {
//       payload.ownershipType = payload.businessOwnershipType;
//       delete payload.businessOwnershipType;
//     }
//     if (payload.numberOfEmployees !== undefined) {
//       payload.employeesCount = payload.numberOfEmployees;
//       delete payload.numberOfEmployees;
//     }
//     if (payload.contactPhone !== undefined) {
//       payload.primaryContactPhone = payload.contactPhone; // primary contact
//       payload.primaryPhone = payload.contactPhone;        // also general primaryPhone
//       delete payload.contactPhone;
//     }
//     if (payload.contactEmail !== undefined) {
//       payload.secondaryBusinessEmail = payload.contactEmail; // secondary email
//       delete payload.contactEmail;
//     }

//     // Map social URLs
//     const urlFields = ["websiteUrl", "facebookUrl", "instagramUrl", "linkedinUrl", "tiktokUrl"];
//     urlFields.forEach((field) => {
//       if (payload[field] !== undefined) {
//         const key = field.replace("Url", ""); // websiteUrl -> website
//         payload[key] = payload[field];
//         delete payload[field];
//       }
//     });

//     // 6️⃣ Apply sanitized payload to onboarding
//     Object.keys(payload).forEach((key) => {
//       if (payload[key] !== undefined) {
//         onboarding[key] = payload[key];
//       }
//     });

//     // 7️⃣ Apply defaults only for missing/null fields
//     const defaultFields = {
//       firstName: "",
//       lastName: "",
//       businessName: "",
//       primaryEmail: "",
//       primaryPhone: "",
//       primaryContactPhone: "",
//       language: "",
//       licenseNumber: "",
//       businessBio: "",
//       characterLimit: 0,
//       businessProfileImage: { url: "", verified: false },
//       businessEmail: "",
//       businessPhone: "",
//       alternatePhone: "",
//       twitter: "",
//       refundPolicyDocument: { url: "", verified: false },
//       termsDocument: { url: "", verified: false },
//       googleReviewLink: "",
//       communityServiceLink: "",
//       website: "",
//       facebook: "",
//       instagram: "",
//       linkedin: "",
//       tiktok: "",
//       ownershipType: null,
//       employeesCount: null,
//       usesThirdPartyBooking: false,
//     };

//     Object.keys(defaultFields).forEach((key) => {
//       if (onboarding[key] === undefined || onboarding[key] === null) {
//         onboarding[key] = defaultFields[key];
//       }
//     });

//     // 8️⃣ Ensure status is always draft
//     onboarding.status = "draft";

//     // 9️⃣ Save document
//     await onboarding.save();

//     return res.status(200).json({
//       success: true,
//       message: "Stage-1 draft saved successfully",
//       data: onboarding,
//     });
//   } catch (error) {
//     console.error("Save draft error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to save onboarding draft",
//       error: error.message,
//     });
//   }
// };



//    exports.saveDraft = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const payload = req.body;

//     // 1️⃣ Check existing onboarding
//     let onboarding = await VendorOnboarding.findOne({ userId });

//     // 2️⃣ Lock if already submitted
//     if (onboarding && onboarding.status === "submitted") {
//       return res.status(400).json({
//         success: false,
//         message: "Onboarding already submitted and cannot be edited",
//       });
//     }

//     // 3️⃣ Generate applicationId ONLY once
//     if (!onboarding) {
//       onboarding = new VendorOnboarding({
//         userId,
//         applicationId: `MBH-APP-${Date.now()}-${Math.random()
//           .toString(36)
//           .substring(2, 8)
//           .toUpperCase()}`,
//         status: "draft",
//       });
//     }

//     // 4️⃣ Set DEFAULT EMPTY VALUES for NEW fields ONLY if they don't exist
//     // This ensures existing data is preserved and frontend doesn't need changes
//     if (!onboarding.firstName) onboarding.firstName = "";
//     if (!onboarding.lastName) onboarding.lastName = "";
//     if (!onboarding.primaryEmail) onboarding.primaryEmail = "";
//     if (!onboarding.primaryPhone) onboarding.primaryPhone = "";
//     if (!onboarding.language) onboarding.language = "";
//     if (!onboarding.licenseNumber) onboarding.licenseNumber = "";
//     if (!onboarding.businessBio) onboarding.businessBio = "";
//     if (!onboarding.characterLimit) onboarding.characterLimit = 0;
//     if (!onboarding.businessProfileImage) {
//       onboarding.businessProfileImage = { url: "", verified: false };
//     }
//     if (!onboarding.businessEmail) onboarding.businessEmail = "";
//     if (!onboarding.businessPhone) onboarding.businessPhone = "";
//     if (!onboarding.alternatePhone) onboarding.alternatePhone = "";
//     if (!onboarding.twitter) onboarding.twitter = "";
//     if (!onboarding.refundPolicyDocument) {
//       onboarding.refundPolicyDocument = { url: "", verified: false };
//     }
//     if (!onboarding.termsDocument) {
//       onboarding.termsDocument = { url: "", verified: false };
//     }
//     if (!onboarding.googleReviewLink) onboarding.googleReviewLink = "";
//     if (!onboarding.communityServiceLink) onboarding.communityServiceLink = "";

//     // 5️⃣ Map EXISTING frontend fields to database fields (NO CHANGES HERE)
//     const mappedPayload = {
//       ...payload,
      
//       // Map URL fields - ONLY if they exist in payload
//       ...(payload.websiteUrl !== undefined && { website: payload.websiteUrl }),
//       ...(payload.facebookUrl !== undefined && { facebook: payload.facebookUrl }),
//       ...(payload.instagramUrl !== undefined && { instagram: payload.instagramUrl }),
//       ...(payload.linkedinUrl !== undefined && { linkedin: payload.linkedinUrl }),
//       ...(payload.tiktokUrl !== undefined && { tiktok: payload.tiktokUrl }),
      
//       // Map other fields - ONLY if they exist in payload
//       ...(payload.businessOwnershipType !== undefined && { ownershipType: payload.businessOwnershipType }),
//       ...(payload.numberOfEmployees !== undefined && { employeesCount: payload.numberOfEmployees }),
//       ...(payload.businessEmail !== undefined && { secondaryBusinessEmail: payload.businessEmail }),
//       ...(payload.hasThirdPartyBooking !== undefined && { usesThirdPartyBooking: payload.hasThirdPartyBooking }),
      
//       // Remove frontend-only fields
//       websiteUrl: undefined,
//       facebookUrl: undefined,
//       instagramUrl: undefined,
//       linkedinUrl: undefined,
//       tiktokUrl: undefined,
//       businessOwnershipType: undefined,
//       numberOfEmployees: undefined,
//       businessEmail: undefined,
//       hasThirdPartyBooking: undefined,
//       contactEmail: undefined,
//       contactPhone: undefined
//     };

//     // 6️⃣ Apply ONLY the mapped fields that exist in payload
//     // This ensures we don't overwrite existing data with undefined
//     Object.keys(mappedPayload).forEach(key => {
//       if (mappedPayload[key] !== undefined) {
//         onboarding[key] = mappedPayload[key];
//       }
//     });

//     onboarding.status = "draft"; 

//     // 7️⃣ Save document
//     await onboarding.save();

//     return res.status(200).json({
//       success: true,
//       message: "Stage-1 draft saved successfully",
//       data: onboarding,
//     });
//   } catch (error) {
//     console.error("Save draft error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to save onboarding draft",
//     });
//   }
// };



/* =====================================================
   FETCH DRAFT
===================================================== */

exports.getDraft = async (req, res) => {
  try {
    const onboarding = await VendorOnboarding.findOne({
      userId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      data: onboarding,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch draft",
    });
  }
};

//get onbaording data for the buisness completetion setup page
exports.getOnboardingData = async (req, res) => {
  try {
    const onboarding = await VendorOnboarding.findOne({
      userId: req.user._id,
    });

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "No onboarding data found",
      });
    }

    // Fetch user basic details
    const user = await User.findById(req.user._id).select(
      "name email mobile"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Split name into first & last
    const nameParts = user.name.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    return res.status(200).json({
      success: true,
      data: {
        ...onboarding.toObject(),
        firstName,
        lastName,
        primaryEmail: user.email,
        primaryPhone: user.mobile,
      },
    });
  } catch (error) {
    console.error("Error fetching onboarding data:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch onboarding data",
    });
  }
};


/**
 * Update entire business profile (PUT)
 * This updates ALL fields - NO STATUS CHECKS
 */

exports.updateBusinessProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const payload = req.body;

    const VendorOnboarding = require('../models/VendorOnboardingStage1');

    // 1️⃣ Check existing onboarding
    let onboarding = await VendorOnboarding.findOne({ userId });

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "No onboarding draft found. Please save draft first.",
      });
    }

    // 2️⃣ Update onboarding with allowlisted profile fields only
    applyVendorBusinessProfileFields(onboarding, payload);

    const readyForTrustBadgeVerification =
      isVendorProfileReadyForTrustBadgeVerification(onboarding);
    await onboarding.save();

    // ========== REQUIRED BUSINESS SYNC ==========
    try {
      const Business = require('../models/Business');
      const Subscription = require('../models/Subscription');
      await syncBusinessFromOnboarding({
        userId,
        onboarding,
        Business,
        Subscription,
      });
    } catch (businessError) {
      console.error('Business sync failed:', businessError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to sync business profile data',
      });
    }

    // Non-blocking: notify admin once when vendor completes profile + docs
    if (readyForTrustBadgeVerification && !onboarding.profileCompletionNotifiedAt) {
      try {
        await sendAdminVendorProfileCompletedEmail({
          adminEmail: process.env.ADMIN_EMAIL,
          applicationId: onboarding.applicationId,
          businessName: onboarding.businessName,
        });

        onboarding.profileCompletionNotifiedAt = new Date();
        await onboarding.save();
      } catch (emailError) {
        console.error("Vendor profile completion admin email failed:", emailError);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: onboarding,
    });

  } catch (error) {
    console.error("❌ Update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};


// exports.updateBusinessProfile = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const payload = req.body;

//     // 1️⃣ Check existing onboarding
//     let onboarding = await VendorOnboarding.findOne({ userId });

//     // 2️⃣ Return error if no draft exists
//     if (!onboarding) {
//       return res.status(404).json({
//         success: false,
//         message: "No onboarding draft found. Please save draft first.",
//       });
//     }

//     // ✅ NO STATUS CHECKS - Always allow updates

//     // 3️⃣ Map ALL fields from payload to database fields
//     const mappedPayload = {
//       ...payload,
      
//       // Map URL fields
//       ...(payload.website !== undefined && { website: payload.website }),
//       ...(payload.facebook !== undefined && { facebook: payload.facebook }),
//       ...(payload.instagram !== undefined && { instagram: payload.instagram }),
//       ...(payload.twitter !== undefined && { twitter: payload.twitter }),
//       ...(payload.linkedin !== undefined && { linkedin: payload.linkedin }),
//       ...(payload.tiktok !== undefined && { tiktok: payload.tiktok }),
      
//       // Map business profile fields
//       ...(payload.firstName !== undefined && { firstName: payload.firstName }),
//       ...(payload.lastName !== undefined && { lastName: payload.lastName }),
//       ...(payload.primaryEmail !== undefined && { primaryEmail: payload.primaryEmail }),
//       ...(payload.primaryPhone !== undefined && { primaryPhone: payload.primaryPhone }),
//       ...(payload.language !== undefined && { language: payload.language }),
      
//       // Business Information
//       ...(payload.licenseNumber !== undefined && { licenseNumber: payload.licenseNumber }),
//       ...(payload.businessBio !== undefined && { businessBio: payload.businessBio }),
//       ...(payload.characterLimit !== undefined && { characterLimit: payload.characterLimit }),
//       ...(payload.businessProfileImage !== undefined && { businessProfileImage: payload.businessProfileImage }),
      
//       // Contact Information
//       ...(payload.businessEmail !== undefined && { businessEmail: payload.businessEmail }),
//       ...(payload.businessPhone !== undefined && { businessPhone: payload.businessPhone }),
//       ...(payload.alternatePhone !== undefined && { alternatePhone: payload.alternatePhone }),
      
//       // Additional Documents
//       ...(payload.refundPolicyDocument !== undefined && { refundPolicyDocument: payload.refundPolicyDocument }),
//       ...(payload.termsDocument !== undefined && { termsDocument: payload.termsDocument }),
//       ...(payload.googleReviewLink !== undefined && { googleReviewLink: payload.googleReviewLink }),
//       ...(payload.communityServiceLink !== undefined && { communityServiceLink: payload.communityServiceLink }),
//     };

//     // 4️⃣ Apply ONLY the mapped fields that exist in payload
//     Object.keys(mappedPayload).forEach(key => {
//       if (mappedPayload[key] !== undefined) {
//         onboarding[key] = mappedPayload[key];
//       }
//     });

//     // 5️⃣ Keep EXISTING status - DON'T change it
//     // onboarding.status = "draft"; // ❌ REMOVED - don't change status

//     // 6️⃣ Save document
//     await onboarding.save();

//     return res.status(200).json({
//       success: true,
//       message: "Business profile updated successfully",
//       data: onboarding,
//     });

//   } catch (error) {
//     console.error("Update business profile error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to update business profile",
//     });
//   }
// };

/**
 * Patch business profile - NO STATUS CHECKS
 */
exports.patchBusinessProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const payload = req.body;

    // 1️⃣ Check existing onboarding
    let onboarding = await VendorOnboarding.findOne({ userId });

    // 2️⃣ Return error if no draft exists
    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "No onboarding draft found. Please save draft first.",
      });
    }

    // ✅ NO STATUS CHECKS - Always allow updates

    // 3️⃣ Only update allowlisted profile fields
    applyVendorBusinessProfileFields(onboarding, payload);

    // 5️⃣ Keep EXISTING status - DON'T change it
    // onboarding.status = "draft"; // ❌ REMOVED

    // 6️⃣ Save document
    await onboarding.save();

    return res.status(200).json({
      success: true,
      message: "Business profile updated successfully",
      data: onboarding,
    });

  } catch (error) {
    console.error("Patch business profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update business profile",
    });
  }
};



//payment controllers
exports.createVerificationPayment = async (req, res) => {
  try {
    const userId = req.user._id;

    const onboarding = await VendorOnboarding.findOne({ userId });

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "Please save your onboarding draft first"
      });
    }

    if (onboarding.verificationPayment?.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Verification fee already paid"
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2499,
      currency: 'usd',
      metadata: {
        userId: userId.toString(),
        type: 'vendor_verification',
        applicationId: onboarding.applicationId || 'N/A'
      },
      description: 'Vendor Onboarding Verification Fee - $24.99'
    });

    onboarding.verificationPayment = {
      provider: 'stripe',
      paymentIntentId: paymentIntent.id,
      amount: 24.99,
      amount_cents: 2499,
      currency: 'usd',
      status: 'pending',
      paidAt: null
    };

    onboarding.status = 'payment_pending';
    onboarding.submittedAt = undefined;

    await onboarding.save();

    return res.status(200).json({
      success: true,
      message: "Payment intent created successfully. Complete payment to continue.",
      data: {
        clientSecret: paymentIntent.client_secret,
        amount: 24.99,
        currency: 'usd',
        status: 'pending',
        applicationStatus: 'payment_pending'
      }
    });

  } catch (error) {
    console.error("Payment creation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create payment"
    });
  }
};

/* =====================================================
   STRIPE WEBHOOK HANDLER FOR VENDOR VERIFICATION PAYMENTS
===================================================== */

exports.handleVendorPaymentWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const payload = req.body;
  const endpointSecret = process.env.STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET;

  let event;

  try {
    if (!sig) {
      if (process.env.NODE_ENV !== 'development') {
        return res.status(400).send('Webhook Error: stripe-signature header is required');
      }
      console.log('No signature provided - using payload directly for local development testing');
      event = JSON.parse(payload.toString());
    } else {
      if (!endpointSecret) {
        console.error('Stripe webhook secret is missing for /api/vendor-onboarding/webhook/payment');
        return res.status(500).send('Stripe webhook secret is not configured');
      }

      event = stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    }
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;

      if (paymentIntent.metadata.type === 'vendor_verification') {
        try {
          const userId = paymentIntent.metadata.userId;

          const onboarding = await VendorOnboarding.findOne({
            userId,
            'verificationPayment.paymentIntentId': paymentIntent.id
          });

          if (onboarding) {
            onboarding.verificationPayment.status = 'paid';
            onboarding.verificationPayment.paidAt = new Date();
            onboarding.status = 'draft';

            await onboarding.save();

            console.log(`Vendor verification payment succeeded for user ${userId}`);
          } else {
            console.log(`No onboarding record found for payment ${paymentIntent.id}`);
          }
        } catch (error) {
          console.error('Failed to update vendor verification payment:', error);
          return res.status(500).send('Database update failed');
        }
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const failedPaymentIntent = event.data.object;

      if (failedPaymentIntent.metadata.type === 'vendor_verification') {
        try {
          const userId = failedPaymentIntent.metadata.userId;

          const onboarding = await VendorOnboarding.findOne({
            userId,
            'verificationPayment.paymentIntentId': failedPaymentIntent.id
          });

          if (onboarding) {
            onboarding.verificationPayment.status = 'failed';
            onboarding.status = 'payment_pending';

            await onboarding.save();

            console.log(`Vendor verification payment failed for user ${userId}`);
          }
        } catch (error) {
          console.error('Failed to update vendor verification payment failure:', error);
          return res.status(500).send('Database update failed');
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).send({ received: true });
};

/* =====================================================
   GET PAYMENT STATUS
===================================================== */

exports.getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const onboarding = await VendorOnboarding.findOne({ userId });
    
    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "Onboarding record not found"
      });
    }

    const paymentData = {
      required: true,
      amount: 2499,
      currency: 'usd',
      status: onboarding.verificationPayment?.status || 'not_started',
      paidAt: onboarding.verificationPayment?.paidAt || null,
      canSubmit: onboarding.verificationPayment?.status === 'paid'
    };

    return res.status(200).json({
      success: true,
      data: paymentData
    });

  } catch (error) {
    console.error("Get payment status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get payment status"
    });
  }
};


/* =====================================================
   SUBMIT FOR REVIEW (STRICT VALIDATION)
===================================================== */

exports.submitForReview = async (req, res) => {
  try {
    const userId = req.user._id;

    const onboarding = await VendorOnboarding.findOne({ userId });

    /* ------------------------------
       BASIC EXISTENCE CHECK
    ------------------------------ */
    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: "save Draft before submitting for review",
      });
    }

    /* ------------------------------
       STATUS LOCK CHECK
    ------------------------------ */
// ✅ If already submitted → return success (no error)
if (onboarding.status === "submitted") {
  return res.status(200).json({
    success: true,
    message: "Application submitted successfully",
    applicationId: onboarding.applicationId,
  });
}

// ❌ Only block invalid states (explicit submit handles resubmission)
if (
  onboarding.status !== 'draft' &&
  onboarding.status !== 'payment_pending' &&
  onboarding.status !== 'rejected'
) {
  return res.status(400).json({
    success: false,
    message: "Onboarding cannot be submitted at this stage",
  });
}

    /* ------------------------------
       PAYMENT VALIDATION (MANDATORY)
    ------------------------------ */
    if (
      !onboarding.verificationPayment ||
      onboarding.verificationPayment.status !== "paid"
    ) {
      return res.status(402).json({
        success: false,
        message: "Verification payment must be completed before submission",
      });
    }

    /* ------------------------------
       FORM VALIDATION (STRICT)
    ------------------------------ */
    const validationErrors = validateStage1Payload(onboarding.toObject());

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    /* ------------------------------
       FINAL SUBMISSION
    ------------------------------ */
    onboarding.status = "submitted";
    onboarding.submittedAt = new Date();
    await onboarding.save();

    /* ------------------------------
       FETCH USER DETAILS
    ------------------------------ */
    const user = await User.findById(userId).select("name email");

    /* ------------------------------
       EMAIL NOTIFICATIONS (NON-BLOCKING)
    ------------------------------ */
    try {
      // 1️⃣ Notify Admin
      await sendAdminOnboardingSubmissionEmail({
        adminEmail: process.env.ADMIN_EMAIL, // e.g. admin@mosaicbizhub.com
        applicationId: onboarding.applicationId,
        businessName: onboarding.businessName,
        vendorName: user.name,
      });

      // 2️⃣ Notify Vendor
      await sendVendorSubmissionConfirmationEmail({
        to: user.email,
        vendorName: user.name,
        applicationId: onboarding.applicationId,
      });
    } catch (emailError) {
      // Emails should NEVER block submission
      console.error("Stage-1 email notification failed:", emailError);
    }

    return res.status(200).json({
      success: true,
      message: "Stage 1 submitted successfully for admin verification",
      applicationId: onboarding.applicationId,
    });
  } catch (error) {
    console.error("Stage-1 submit error:", error);
    return res.status(500).json({
      success: false,
      message: "Stage 1 submission failed",
    });
  }
};

//old working submit for review without payment and validation checks

// exports.submitForReview = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     const onboarding = await VendorOnboarding.findOne({ userId });

//     /* ------------------------------
//        BASIC EXISTENCE CHECK
//     ------------------------------ */
//     if (!onboarding) {
//       return res.status(404).json({
//         success: false,
//         message: "save Draft before submitting for review",
//       });
//     }

//     /* ------------------------------
//        STATUS LOCK CHECK
//     ------------------------------ */
//     if (
//       onboarding.status !== "draft" &&
//       onboarding.status !== "payment_pending"
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Onboarding already submitted or locked",
//       });
//     }

//     /* ------------------------------
//        PAYMENT VALIDATION (MANDATORY)
//     ------------------------------ */
//     // if (
//     //   !onboarding.verificationPayment ||
//     //   onboarding.verificationPayment.status !== "paid"
//     // ) {
//     //   return res.status(402).json({
//     //     success: false,
//     //     message: "Verification payment must be completed before submission",
//     //   });
//     // }

//     /* ------------------------------
//        FORM VALIDATION (STRICT)
//     ------------------------------ */
//     const validationErrors = validateStage1Payload(onboarding.toObject());

//     if (validationErrors.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Validation failed",
//         errors: validationErrors,
//       });
//     }

//     /* ------------------------------
//        FINAL SUBMISSION
//     ------------------------------ */
//     onboarding.status = "submitted";
//     onboarding.submittedAt = new Date();
//     await onboarding.save();

//     /* ------------------------------
//        FETCH USER DETAILS
//     ------------------------------ */
//     const user = await User.findById(userId).select("name email");

//     /* ------------------------------
//        EMAIL NOTIFICATIONS (NON-BLOCKING)
//     ------------------------------ */
//     try {
//       // 1️⃣ Notify Admin
//       await sendAdminOnboardingSubmissionEmail({
//         adminEmail: process.env.ADMIN_EMAIL, // e.g. admin@mosaicbizhub.com
//         applicationId: onboarding.applicationId,
//         businessName: onboarding.businessName,
//         vendorName: user.name,
//       });

//       // 2️⃣ Notify Vendor
//       await sendVendorSubmissionConfirmationEmail({
//         to: user.email,
//         vendorName: user.name,
//         applicationId: onboarding.applicationId,
//       });
//     } catch (emailError) {
//       // Emails should NEVER block submission
//       console.error("Stage-1 email notification failed:", emailError);
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Stage 1 submitted successfully for admin verification",
//       applicationId: onboarding.applicationId,
//     });
//   } catch (error) {
//     console.error("Stage-1 submit error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Stage 1 submission failed",
//     });
//   }
// };








// Direct update payment status to paid (for testing)



exports.getStatusByApplicationId = async (req, res) => {
  try {
    const { applicationId } = req.params;

    if (!applicationId) {
      return res.status(400).json({
        success: false,
        message: 'Application ID is required'
      });
    }

    // Load models
    const Subscription = require('../models/Subscription');
    const VendorOnboarding = require('../models/VendorOnboardingStage1');

    // Fetch onboarding application - THIS CONTAINS ALL BUSINESS PROFILE DATA
    const onboarding = await VendorOnboarding.findOne({ applicationId });

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const userId = onboarding.userId;

    // Fetch subscription only - Business Profile data is in onboarding
    const subscription = await Subscription.findOne({ userId })
      .sort({ createdAt: -1 })
      .populate('subscriptionPlanId');

    // ✅ Check logo and bio directly from onboarding document
    const hasLogo = onboarding.businessProfileImage?.url && 
                   onboarding.businessProfileImage.url.trim() !== '';
    
    const hasBio = onboarding.businessBio && 
                   onboarding.businessBio.trim() !== '';

    // Initialize default response
    let currentStage = 1;
    let status = 'Stage 1 - Document Verification';
    let nextAction = '';

    // Stage 1 - Onboarding Status
    switch (onboarding.status) {
      case 'draft':
        status = 'Stage 1 - Draft (Not Submitted)';
        nextAction = 'Submit application for review';
        break;

      case 'submitted':
        status = 'Stage 1 - Under Admin Review';
        nextAction = 'Wait for admin verification (24-48 hours)';
        break;

      case 'verified':
        currentStage = 2;

        // Stage 2 - Subscription
        if (!subscription) {
          status = 'Stage 2 - Select Subscription Plan';
          nextAction = 'Your application is verified. Choose and pay for a subscription plan';
        } else {
          // Subscription exists, check its status
          if (subscription.status === 'pending') {
            status = 'Stage 2 - Payment Pending';
            nextAction = 'Complete your subscription payment';
          } else if (subscription.status === 'active') {
            currentStage = 3;

            // ✅ STAGE 3 - Business Profile (Data is in onboarding document)
            // Check if logo AND bio exist
            if (hasLogo && hasBio) {
              // ✅ PROFILE COMPLETE - Move to Stage 4 immediately
              currentStage = 4;
              status = '✅ Onboarding Complete!';
              nextAction = 'Proceed with product/service/food upload';
            } else {
              // ❌ PROFILE INCOMPLETE
              status = 'Stage 3 - Business Profile Incomplete';
              nextAction = 'Please add your business logo and bio to continue';
              
              const missingItems = [];
              if (!hasLogo) missingItems.push('logo');
              if (!hasBio) missingItems.push('bio');
              nextAction += ` (Missing: ${missingItems.join(', ')})`;
            }
          } else {
            status = 'Stage 2 - Subscription Issue';
            nextAction = 'Contact support for subscription assistance';
          }
        }
        break;

      case 'rejected':
        status = 'Stage 1 - Rejected';
        nextAction = 'Your application did not meet verification criteria. Our team will contact you for further assistance.';
        break;

      default:
        status = 'Stage 1 - Unknown Status';
        nextAction = 'Contact support for assistance';
        break;
    }

    return res.json({
      success: true,
      data: {
        applicationId,
        businessName: onboarding.businessName,
        currentStage,
        status,
        nextAction,
        details: {
          stage1: {
            status: onboarding.status,
            points: onboarding.totalVerificationPoints || 0,
            submittedAt: onboarding.submittedAt,
            paymentStatus: onboarding.verificationPayment?.status || 'not_started'
          },
          stage2: {
            status: subscription?.status || 'not_started',
            plan: subscription?.subscriptionPlanId?.name || null,
            amount: subscription?.subscriptionPlanId?.price || null,
            subscribedAt: subscription?.createdAt || null
          },
          stage3: {
            // ✅ Use onboarding data directly
            status: hasLogo && hasBio ? 'completed' : 'in_progress',
            badge: null,
            totalPoints: 0,
            isComplete: hasLogo && hasBio,
            hasLogo: hasLogo,
            hasBio: hasBio,
            businessName: onboarding.businessName || null,
            businessEmail: onboarding.businessEmail || onboarding.secondaryBusinessEmail || null,
            businessPhone: onboarding.businessPhone || onboarding.primaryPhone || null,
            businessBio: onboarding.businessBio || null,
            logo: onboarding.businessProfileImage?.url || null
          },
          stage4: {
            status: currentStage === 4 ? 'ready' : 'locked',
            message: currentStage === 4 
              ? 'Start listing your products/services' 
              : 'Complete previous stages first'
          }
        }
      }
    });
  } catch (error) {
    console.error('Get status by application ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get application status',
      error: error.message
    });
  }
};

// Get status by application ID
// exports.getStatusByApplicationId = async (req, res) => {
//   try {
//     const { applicationId } = req.params;

//     if (!applicationId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Application ID is required'
//       });
//     }

//     // Load models
//     const Subscription = require('../models/Subscription');
//     const BusinessProfile = require('../models/BusinessProfile');
//     const VendorOnboarding = require('../models/VendorOnboardingStage1');

//     // Fetch onboarding application
//     const onboarding = await VendorOnboarding.findOne({ applicationId });

//     if (!onboarding) {
//       return res.status(404).json({
//         success: false,
//         message: 'Application not found'
//       });
//     }

//     const userId = onboarding.userId;

//     // Fetch subscription and business profile in parallel
//     const [subscription, businessProfile] = await Promise.all([
//       Subscription.findOne({ userId }).sort({ createdAt: -1 }).populate('subscriptionPlanId'),
//       BusinessProfile.findOne({ userId })
//     ]);

//     // Initialize default response
//     let currentStage = 1;
//     let status = 'Stage 1 - Document Verification';
//     let nextAction = '';

//     // Stage 1 - Onboarding Status
//     switch (onboarding.status) {
//       case 'draft':
//         status = 'Stage 1 - Draft (Not Submitted)';
//         nextAction = 'Submit application for review';
//         break;

//       case 'submitted':
//         status = 'Stage 1 - Under Admin Review';
//         nextAction = 'Wait for admin verification (24-48 hours)';
//         break;

//       case 'verified':
//         currentStage = 2;

//         // Stage 2 - Subscription
//         if (!subscription) {
//           status = 'Stage 2 - Select Subscription Plan';
//           nextAction = 'Your application is verified. Choose and pay for a subscription plan';
//         } else {
//           // Subscription exists, check its status
//           if (subscription.status === 'pending') {
//             status = 'Stage 2 - Payment Pending';
//             nextAction = 'Complete your subscription payment';
//           } else if (subscription.status === 'active') {
//             currentStage = 3;

//             // Stage 3 - Business Profile
//             if (!businessProfile) {
//               status = 'Stage 3 - Complete Business Profile';
//               nextAction = 'Fill out business profile and questions';
//             } else {
//               switch (businessProfile.status) {
//                 case 'draft':
//                   status = 'Stage 3 - Business Profile Draft';
//                   nextAction = 'Submit business profile for review';
//                   break;

//                 case 'submitted':
//                   status = 'Stage 3 - Business Profile Under Review';
//                   nextAction = 'Wait for business profile verification';
//                   break;

//                 case 'approved':
//                   currentStage = 4;
//                   status = 'Onboarding Complete!';
//                   nextAction = 'Start using the platform';
//                   break;

//                 default:
//                   status = 'Stage 3 - Not Started';
//                   nextAction = 'Complete your business profile';
//                   break;
//               }
//             }
//           } else {
//             // Subscription status is neither pending nor active
//             status = 'Stage 2 - Subscription Issue';
//             nextAction = 'Contact support for subscription assistance';
//           }
//         }
//         break;

//       case 'rejected':
//         status = 'Stage 1 - Rejected';
//         nextAction =
//           'Your application did not meet verification criteria. Our team will contact you for further assistance.';
//         break;

//       default:
//         status = 'Stage 1 - Unknown Status';
//         nextAction = 'Contact support for assistance';
//         break;
//     }

//     return res.json({
//       success: true,
//       data: {
//         applicationId,
//         businessName: onboarding.businessName,
//         currentStage,
//         status,
//         nextAction,
//         details: {
//           stage1: {
//             status: onboarding.status,
//             points: onboarding.totalVerificationPoints || 0,
//             submittedAt: onboarding.submittedAt,
//             paymentStatus: onboarding.verificationPayment?.status || 'not_started'
//           },
//           stage2: {
//             status: subscription?.status || 'not_started',
//             plan: subscription?.subscriptionPlanId?.name || null,
//             amount: subscription?.subscriptionPlanId?.price || null,
//             subscribedAt: subscription?.createdAt || null
//           },
//           stage3: {
//             status: businessProfile?.status || 'not_started',
//             badge: businessProfile?.badge || null,
//             totalPoints: businessProfile?.totalPoints || 0,
//             submittedAt: businessProfile?.submittedAt || null,
//             approvedAt: businessProfile?.finalizedAt || null
//           }
//         }
//       }
//     });
//   } catch (error) {
//     console.error('Get status by application ID error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to get application status',
//       error: error.message
//     });
//   }
// };



exports.getApplicationId = async (req, res) => {
  try {
    const onboarding = await VendorOnboarding.findOne({ userId: req.user._id }).select('applicationId');
    
    return res.json({
      success: true,
      applicationId: onboarding?.applicationId || null
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to get application ID"
    });
  }
};



