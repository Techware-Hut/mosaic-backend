const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Business = require('../models/Business');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { validationResult } = require('express-validator');
const deleteCloudinaryFile = require('../utils/deleteCloudinaryFile');
const { sendError, sendForbidden, sendNotFound } = require('../utils/apiError');
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const mongoose = require('mongoose');
const VendorOnboardingStage1 = require('../models/VendorOnboardingStage1');
const {
  countProductListingUsage,
  assertProductListingQuota,
} = require('../utils/listingTierLimits');
const { Decimal128 } = mongoose.Types;
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const DEFAULT_PRODUCT_SHIPPING = { standard: 0, overnight: 0, local: 0 };
const getGalleryImageLimit = (subscriptionPlan) =>
  subscriptionPlan?.limits?.galleryImageLimit ?? subscriptionPlan?.limits?.imageLimit ?? 0;

const countGalleryImages = (images) =>
  Array.isArray(images) ? images.filter(Boolean).length : 0;

const toShippingNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const hasOwnShippingField = (shipping, field) =>
  Object.prototype.hasOwnProperty.call(shipping, field);

const normalizeProductShipping = (incomingShipping, existingShipping = DEFAULT_PRODUCT_SHIPPING) => {
  if (incomingShipping === undefined) {
    return existingShipping || { ...DEFAULT_PRODUCT_SHIPPING };
  }

  if (!incomingShipping || typeof incomingShipping !== "object" || Array.isArray(incomingShipping)) {
    return existingShipping || { ...DEFAULT_PRODUCT_SHIPPING };
  }

  const base = {
    ...DEFAULT_PRODUCT_SHIPPING,
    ...(existingShipping || {}),
  };

  for (const field of ["standard", "overnight", "local"]) {
    if (hasOwnShippingField(incomingShipping, field)) {
      const parsed = toShippingNumber(incomingShipping[field]);
      base[field] = parsed !== undefined ? parsed : base[field];
    }
  }

  return base;
};

const normalizeVariantShipping = (incomingShipping, existingShipping) => {
  if (incomingShipping === undefined) {
    return existingShipping === undefined ? null : existingShipping;
  }

  if (incomingShipping === null) {
    return null;
  }

  if (!incomingShipping || typeof incomingShipping !== "object" || Array.isArray(incomingShipping)) {
    return existingShipping === undefined ? null : existingShipping;
  }

  const hasAnyKnownField = ["standard", "overnight", "local"].some((field) =>
    hasOwnShippingField(incomingShipping, field)
  );

  if (!hasAnyKnownField) {
    return null;
  }

  const base = {
    standard: 0,
    overnight: 0,
    local: 0,
    ...(existingShipping || {}),
  };

  for (const field of ["standard", "overnight", "local"]) {
    if (hasOwnShippingField(incomingShipping, field)) {
      const parsed = toShippingNumber(incomingShipping[field]);
      base[field] = parsed !== undefined ? parsed : base[field];
    }
  }

  return base;
};


/**
 * Generate SKU for variant
 */
const baseGenerateSKU = (businessId, productId, attributes) => {
  const prefix = 'PRD';
  const businessCode = businessId.toString().slice(-4);
  const productCode = productId.toString().slice(-4);
  const attrString = Array.from(attributes.values()).join('-').replace(/\s/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${businessCode}-${productCode}-${attrString}-${random}`.toUpperCase();
};

const generateUniqueSKU = async (businessId, productId, attributes) => {
  let sku;
  let exists = true;

  while (exists) {
    sku = baseGenerateSKU(businessId, productId, attributes); // ✅ call base, NOT itself
    exists = await ProductVariant.findOne({ sku });
  }

  return sku;
};

/**
 * CREATE PRODUCT WITH VARIANTS
 */


exports.createProductWithVariants = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user._id;

    const {
      title,
      description,
      categoryId,
      subcategoryId,
      taxCategory,
      businessId,
      attributes,
      shipping,
      coverImage,
      galleryImages,
      metaFields,
      discount,
      variants,
      isPublished,
    } = req.body;

    // Validate variants
    // if (!Array.isArray(variants) || variants.length === 0) {
    //   return res.status(400).json({ error: 'At least one product variant is required.' });
    // }

    // Check business ownership
    const business = await Business.findOne({ _id: businessId, owner: userId });
    if (!business) {
      return res.status(403).json({ error: 'You do not own this business.' });
    }

    // Check subscription
    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({ 
        error: 'Valid subscription not found.',
        details: 'Please ensure you have an active subscription with completed payment.'
      });
    }

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const productLimit = subscriptionPlan?.limits?.productListings || 0;
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);

    const incomingVariantCount = Array.isArray(variants) ? variants.length : 0;
    const usage = await countProductListingUsage({ Product, ProductVariant, businessId });
    const quotaCheck = assertProductListingQuota({
      total: usage.total,
      incomingCount: 1 + incomingVariantCount,
      limit: productLimit,
    });

    if (!quotaCheck.ok) {
      return res.status(quotaCheck.status).json({ error: quotaCheck.error });
    }

    const galleryCount = countGalleryImages(galleryImages);
    if (galleryCount > galleryImageLimit) {
      return res.status(400).json({
        error: `Product gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    // Create Product
    const product = new Product({
      title,
      description,
      categoryId,
      subcategoryId,
      taxCategory: taxCategory || null,
      ownerId: userId,
      businessId,
      attributes: attributes || [],
      shipping: normalizeProductShipping(shipping),
      coverImage,
      galleryImages: galleryImages || [],
      metaFields: metaFields || [],
      discount: discount || null,
      isPublished: isPublished || false,
    });

    await product.save();

  // Create Variants updated section to handle varient skus rolback and ensure uniqueness


  const variantDocs = [];

for (const variant of variants) {
  const attrMap = new Map(Object.entries(variant.attributes || {}));

  let sku = variant.sku;

  // If frontend didn't send SKU
  if (!sku) {
    sku = await generateUniqueSKU(businessId, product._id, attrMap);
  }

  // Attach applicationId prefix
  const onboarding = await VendorOnboardingStage1.findOne({ userId });

  if (onboarding?.applicationId) {
    sku = `${onboarding.applicationId}-${sku}`;
  }

  // Check duplicate in DB
  const existingSku = await ProductVariant.findOne({
    sku,
    isDeleted: false,
  });

  if (existingSku) {
    const newSku = await generateUniqueSKU(businessId, product._id, attrMap);
    sku = `${onboarding.applicationId}-${newSku}`;
  }

  variantDocs.push({
    productId: product._id,
    businessId,
    ownerId: userId,
    attributes: attrMap,
    sku,
    price: Decimal128.fromString(variant.price.toString()),
    salePrice: variant.salePrice
      ? Decimal128.fromString(variant.salePrice.toString())
      : null,
    stock: variant.stock || 0,
    shipping: normalizeVariantShipping(variant.shipping),
    images: variant.images || [],
    isPublished: isPublished || false,
  });
}

// const variantDocs = [];
// const usedSkus = new Set();

// for (const variant of variants) {
//   const attrMap = new Map(Object.entries(variant.attributes || {}));
//   let sku = variant.sku;

//   // If no SKU from frontend → generate
//   if (!sku) {
//     sku = await generateUniqueSKU(businessId, product._id, attrMap);
//   }

//   // If SKU already used in this request → generate new
//   if (usedSkus.has(sku)) {
//     sku = await generateUniqueSKU(businessId, product._id, attrMap);
//   }

//   // Check database duplicate
//   const existingSku = await ProductVariant.findOne({
//     sku,
//     businessId,
//     isDeleted: false,
//   });

//   if (existingSku) {
//     sku = await generateUniqueSKU(businessId, product._id, attrMap);
//   }

//   usedSkus.add(sku);

//   variantDocs.push({
//     productId: product._id,
//     businessId,
//     ownerId: userId,
//     attributes: attrMap,
//     sku,
//     price: Decimal128.fromString(variant.price.toString()),
//     salePrice: variant.salePrice
//       ? Decimal128.fromString(variant.salePrice.toString())
//       : null,
//     stock: variant.stock || 0,
//     shipping: variant.shipping || { standard: 0, overnight: 0, local: 0 },
//     images: variant.images || [],
//     isPublished: isPublished || false,
//   });
// }

    let savedVariants;
    try {
      savedVariants = await ProductVariant.insertMany(variantDocs);
      const variantIds = savedVariants.map(v => v._id);
      await Product.findByIdAndUpdate(product._id, { $push: { variants: { $each: variantIds } } });

      // -----------------------------
      // Update product price as minimum variant price
      // -----------------------------
const prices = savedVariants.map(v => {
  const sale = v.salePrice ? parseFloat(v.salePrice.toString()) : null;
  const price = parseFloat(v.price.toString());

  return sale !== null ? sale : price;
});

const minPrice = Math.min(...prices);
const maxPrice = Math.max(...prices);

      await Product.findByIdAndUpdate(product._id, {
        price: Decimal128.fromString(minPrice.toString()),
        maxPrice: Decimal128.fromString(maxPrice.toString()),
      });

    } catch (variantErr) {

  if (variantErr.code === 11000) {

    // Extract field & value from error message
    const regex = /dup key:\s*{\s*(\w+):\s*"?(.*?)"?\s*}/;
    const match = variantErr.message.match(regex);

    const field = match ? match[1] : "field";
    const value = match ? match[2] : "";

    return res.status(400).json({
      success: false,
      error: {
        type: "DUPLICATE_FIELD",
        field,
        message: `${field} '${value}' already exists. Please use a unique value.`
      }
    });
  }

  return res.status(400).json({
    success: false,
    error: {
      type: "VARIANT_CREATION_FAILED",
      message: "Something went wrong while creating product variants."
    }
  });
} 
    return res.status(201).json({
      message: 'Product and variants created successfully.',
      product: await Product.findById(product._id), // returns product with price
      variants: savedVariants,
    });

  } catch (err) {
    console.error('Error in product creation:', err);
    return res.status(500).json({ error: 'Server error while creating product.' });
  }
};

// exports.createProductWithVariants = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({ errors: errors.array() });
//     }

//     const userId = req.user._id;

//     const {
//       title,
//       description,
//       categoryId,
//       subcategoryId,
//       businessId,
//       attributes,
//       shipping,
//       coverImage,
//       galleryImages,
//       metaFields,
//       discount,
//       variants,
//       isPublished,
//     } = req.body;

//     // Validate variants
//     if (!Array.isArray(variants) || variants.length === 0) {
//       return res.status(400).json({ error: 'At least one product variant is required.' });
//     }

//     // Check business ownership
//     const business = await Business.findOne({ _id: businessId, owner: userId });
//     if (!business) {
//       return res.status(403).json({ error: 'You do not own this business.' });
//     }

//     // Check subscription
//     const subscription = await Subscription.findOne({
//       userId,
//       status: 'active',
//       endDate: { $gte: new Date() },
//     }).sort({ createdAt: -1 });

//     if (!subscription) {
//       return res.status(403).json({ 
//         error: 'Valid subscription not found.',
//         details: 'Please ensure you have an active subscription with completed payment.'
//       });
//     }

//     const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
//     const productLimit = subscriptionPlan?.limits?.productListings || 0;

//     // Count existing variants for the business
//     const variantCount = await ProductVariant.countDocuments({ businessId, isDeleted: false });

//     // Create Product
//     const product = new Product({
//       title,
//       description,
//       categoryId,
//       subcategoryId,
//       ownerId: userId,
//       businessId,
//       attributes: attributes || [],
//       shipping: shipping || { standard: 0, overnight: 0, local: 0 },
//       coverImage,
//       galleryImages: galleryImages || [],
//       metaFields: metaFields || [],
//       discount: discount || null,
//       isPublished: isPublished || false,
//     });

//     await product.save();

//   // Create Variants updated section to handle varient skus rolback and ensure uniqueness
// const variantDocs = [];
// for (const variant of variants) {
//   const attrMap = new Map(Object.entries(variant.attributes || {}));
//   const sku = await generateUniqueSKU(businessId, product._id, attrMap); // ✅ await it
//   variantDocs.push({
//     productId: product._id,
//     businessId,
//     ownerId: userId,
//     attributes: attrMap,
//     sku, // string, ready for Mongoose
//     price: Decimal128.fromString(variant.price.toString()),
//     salePrice: variant.salePrice ? Decimal128.fromString(variant.salePrice.toString()) : null,
//     stock: variant.stock || 0,
//     shipping: variant.shipping || { standard: 0, overnight: 0, local: 0 },
//     images: variant.images || [],
//     isPublished: isPublished || false,
//   });
// }

//     // const variantDocs = variants.map((variant) => ({
//     //   productId: product._id,
//     //   businessId,
//     //   ownerId: userId,
//     //   attributes: new Map(Object.entries(variant.attributes || {})),
//     //   sku: variant.sku || generateSKU(businessId, product._id, new Map(Object.entries(variant.attributes || {}))),
//     //   price: Decimal128.fromString(variant.price?.toString() || '0'),
//     //   salePrice: variant.salePrice ? Decimal128.fromString(variant.salePrice.toString()) : null,
//     //   stock: variant.stock || 0,
//     //   shipping: variant.shipping || null,
//     //   images: variant.images || [],
//     //   isPublished: isPublished || false,
//     // }));

//     let savedVariants;
//     try {
//       savedVariants = await ProductVariant.insertMany(variantDocs);
//       const variantIds = savedVariants.map(v => v._id);
//       await Product.findByIdAndUpdate(product._id, { $push: { variants: { $each: variantIds } } });

//       // -----------------------------
//       // Update product price as minimum variant price
//       // -----------------------------
//       const prices = savedVariants.map(v => parseFloat(v.price.toString()));
//       const minPrice = Math.min(...prices);
//       const maxPrice = Math.max(...prices);

//       await Product.findByIdAndUpdate(product._id, {
//         price: Decimal128.fromString(minPrice.toString()),
//         maxPrice: Decimal128.fromString(maxPrice.toString()),
//       });

//     } catch (variantErr) {

//   if (variantErr.code === 11000) {

//     // Extract field & value from error message
//     const regex = /dup key:\s*{\s*(\w+):\s*"?(.*?)"?\s*}/;
//     const match = variantErr.message.match(regex);

//     const field = match ? match[1] : "field";
//     const value = match ? match[2] : "";

//     return res.status(400).json({
//       success: false,
//       error: {
//         type: "DUPLICATE_FIELD",
//         field,
//         message: `${field} '${value}' already exists. Please use a unique value.`
//       }
//     });
//   }

//   return res.status(400).json({
//     success: false,
//     error: {
//       type: "VARIANT_CREATION_FAILED",
//       message: "Something went wrong while creating product variants."
//     }
//   });
// } 
//     return res.status(201).json({
//       message: 'Product and variants created successfully.',
//       product: await Product.findById(product._id), // returns product with price
//       variants: savedVariants,
//     });

//   } catch (err) {
//     console.error('Error in product creation:', err);
//     return res.status(500).json({ error: 'Server error while creating product.' });
//   }
// };

/**
 * GET PRODUCT BY ID with variants
 */
exports.getProductById = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId)
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .lean();

    if (!product || product.isDeleted) {
      return sendNotFound(req, res, 'Product not found', {
        code: 'PRODUCT_NOT_FOUND',
        includeLegacyError: true,
      });
    }

    // Check ownership
    if (product.ownerId.toString() !== req.user._id.toString()) {
      return sendForbidden(req, res, 'Unauthorized', {
        code: 'PRODUCT_OWNER_REQUIRED',
        includeLegacyError: true,
      });
    }

    // Get variants
    const variants = await ProductVariant.find({
      productId,
      isDeleted: false,
    }).lean();

    const businessTaxSettings = await Business.findById(product.businessId)
      .select('owner taxSettings')
      .lean();

    const vendorOnboarding = businessTaxSettings?.owner
      ? await VendorOnboardingStage1.findOne({ userId: businessTaxSettings.owner })
          .select('address.state')
          .lean()
      : null;

    // Parse Decimal128 values
    const parsedProduct = {
      ...product,
      variants: variants.map(v => ({
        ...v,
        price: parseFloat(v.price?.toString() || '0'),
        salePrice: parseFloat(v.salePrice?.toString() || '0'),
      })),
    };

    return res.status(200).json({
      success: true,
      product: parsedProduct,
      taxContext: businessTaxSettings ? {
        registeredState: vendorOnboarding?.address?.state || null,
        enabled: Boolean(businessTaxSettings?.taxSettings?.enabled),
        categories: Array.isArray(businessTaxSettings?.taxSettings?.categories)
          ? businessTaxSettings.taxSettings.categories
          : [],
      } : null,
    });

  } catch (err) {
    console.error('Error in getProductById:', err);
    return sendError(req, res, 500, {
      message: 'Internal server error',
      includeLegacyError: true,
    });
  }
};

/**
 * UPDATE PRODUCT
 */
exports.updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    const {
      title,
      description,
      categoryId,
      subcategoryId,
      taxCategory,
      attributes,
      shipping,
      coverImage,
      galleryImages,
      metaFields,
      discount,
      isPublished,
      variants
    } = req.body;

    const product = await Product.findById(productId);

    if (!product || product.isDeleted) {
      return sendNotFound(req, res, "Product not found", {
        code: "PRODUCT_NOT_FOUND",
        includeLegacyError: true,
      });
    }

    if (product.ownerId.toString() !== userId.toString()) {
      return sendForbidden(req, res, "Unauthorized", {
        code: "PRODUCT_OWNER_REQUIRED",
        includeLegacyError: true,
      });
    }

    const subscription = await Subscription.findOne({
      userId,
      status: 'active',
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({
        error: 'Valid subscription not found.',
        details: 'Please ensure you have an active subscription with completed payment.'
      });
    }

    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);
    const nextGalleryImages = galleryImages !== undefined ? galleryImages : product.galleryImages;

    if (countGalleryImages(nextGalleryImages) > galleryImageLimit) {
      return res.status(400).json({
        error: `Product gallery can have maximum ${galleryImageLimit} images for your plan.`,
      });
    }

    // Handle cover image change
    if (coverImage && product.coverImage !== coverImage) {
      await deleteCloudinaryFile(product.coverImage);
    }

    // -----------------------------
    // Update product fields
    // -----------------------------
    product.title = title || product.title;
    product.description = description || product.description;
    product.categoryId = categoryId || product.categoryId;
    product.subcategoryId = subcategoryId || product.subcategoryId;
    product.taxCategory = taxCategory !== undefined ? (taxCategory || null) : product.taxCategory;
    product.attributes = attributes || product.attributes;
    product.shipping = normalizeProductShipping(shipping, product.shipping);
    product.coverImage = coverImage || product.coverImage;
    if (galleryImages !== undefined) {
      product.galleryImages = Array.isArray(galleryImages) ? galleryImages.filter(Boolean) : [];
    }
    product.metaFields = metaFields || product.metaFields;
    product.discount = discount || product.discount;
    product.isPublished =
      isPublished !== undefined ? isPublished : product.isPublished;

    await product.save();

    // -----------------------------
    // Update / Create Variants
    // -----------------------------
    let savedVariants = [];

    if (Array.isArray(variants) && variants.length > 0) {
      // Get onboarding info once
      const onboarding = await VendorOnboardingStage1.findOne({ userId });

      // Collect frontend variant IDs
      const frontendVariantIds = variants.filter(v => v._id).map(v => v._id.toString());

      // Remove variants not in frontend payload
      await ProductVariant.deleteMany({
        productId,
        _id: { $nin: frontendVariantIds }
      });

      for (const variant of variants) {
        const attrMap = new Map(Object.entries(variant.attributes || {}));

        // UPDATE existing variant
        if (variant._id) {
          const existingVariant = await ProductVariant.findOne({
            _id: variant._id,
            productId
          });

          if (existingVariant) {
            existingVariant.attributes = attrMap;
            existingVariant.price = Decimal128.fromString(
              variant.price.toString()
            );
            existingVariant.salePrice = variant.salePrice
              ? Decimal128.fromString(variant.salePrice.toString())
              : null;
            existingVariant.stock = variant.stock || 0;
            existingVariant.shipping = normalizeVariantShipping(
              variant.shipping,
              existingVariant.shipping
            );
            existingVariant.images = variant.images || [];
            existingVariant.isPublished =
              isPublished !== undefined ? isPublished : existingVariant.isPublished;

            await existingVariant.save();
            savedVariants.push(existingVariant);
          }
        } else {
          // CREATE new variant with robust SKU logic
          let sku = variant.sku;

          // Generate SKU if not provided
          if (!sku) {
            sku = await generateUniqueSKU(product.businessId, product._id, attrMap);
          }

          // Add applicationId prefix if exists
          if (onboarding?.applicationId) {
            sku = `${onboarding.applicationId}-${sku}`;
          }

          // Ensure SKU is unique in DB
          let existingSku = await ProductVariant.findOne({ sku });
          if (existingSku) {
            const newSku = await generateUniqueSKU(product.businessId, product._id, attrMap);
            sku = onboarding?.applicationId ? `${onboarding.applicationId}-${newSku}` : newSku;
          }

          const newVariant = new ProductVariant({
            productId,
            businessId: product.businessId,
            ownerId: userId,
            attributes: attrMap,
            sku,
            price: Decimal128.fromString(variant.price.toString()),
            salePrice: variant.salePrice
              ? Decimal128.fromString(variant.salePrice.toString())
              : null,
            stock: variant.stock || 0,
            shipping: normalizeVariantShipping(variant.shipping),
            images: variant.images || [],
            isPublished: isPublished || false
          });

          await newVariant.save();
          savedVariants.push(newVariant);
        }
      }
    } else {
      // If no variants sent, remove all variants
      await ProductVariant.deleteMany({ productId });
    }

    // -----------------------------
    // Recalculate product price based on min salePrice
    // -----------------------------
    const allVariants = await ProductVariant.find({ productId });

    if (allVariants.length > 0) {
      const prices = allVariants.map(v => {
        const sale = v.salePrice ? parseFloat(v.salePrice.toString()) : null;
        const price = parseFloat(v.price.toString());
        return sale ?? price; // salePrice has priority
      });

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      product.price = Decimal128.fromString(minPrice.toString());
      product.maxPrice = Decimal128.fromString(maxPrice.toString());
      await product.save();
    } else {
      // No variants → reset product price
      product.price = null;
      product.maxPrice = null;
      await product.save();
    }

    return res.status(200).json({
      success: true,
      message: "Product and variants updated successfully",
      product,
      variants: savedVariants
    });
  } catch (err) {
    console.error("Error updating product:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// exports.updateProduct = async (req, res) => {
//   try {
//     const { productId } = req.params;
//     const ownerId = req.user._id;
//     const {
//       title,
//       description,
//       categoryId,
//       subcategoryId,
//       attributes,
//       shipping,
//       coverImage,
//       galleryImages,
//       metaFields,
//       discount,
//       isPublished,
//     } = req.body;

//     const product = await Product.findById(productId);
//     if (!product || product.isDeleted) {
//       return res.status(404).json({ error: 'Product not found' });
//     }

//     if (product.ownerId.toString() !== ownerId.toString()) {
//       return res.status(403).json({ error: 'Unauthorized' });
//     }

//     // Handle cover image update
//     if (coverImage && product.coverImage !== coverImage) {
//       await deleteCloudinaryFile(product.coverImage);
//     }

//     // Update fields
//     product.title = title || product.title;
//     product.description = description || product.description;
//     product.categoryId = categoryId || product.categoryId;
//     product.subcategoryId = subcategoryId || product.subcategoryId;
//     product.attributes = attributes || product.attributes;
//     product.shipping = shipping || product.shipping;
//     product.coverImage = coverImage || product.coverImage;
//     product.galleryImages = galleryImages || product.galleryImages;
//     product.metaFields = metaFields || product.metaFields;
//     product.discount = discount || product.discount;
//     product.isPublished = isPublished !== undefined ? isPublished : product.isPublished;

//     await product.save();

//     // Update variants publish status to match product
//     if (isPublished !== undefined) {
//       await ProductVariant.updateMany(
//         { productId: product._id },
//         { $set: { isPublished } }
//       );
//     }

//     return res.status(200).json({
//       message: 'Product updated successfully',
//       product,
//     });

//   } catch (err) {
//     console.error('Error updating product:', err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
// };

/**
 * DELETE PRODUCT (Soft delete)
 */
exports.deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Soft delete product
    product.isDeleted = true;
    await product.save();

    // Soft delete all variants
    await ProductVariant.updateMany(
      { productId },
      { $set: { isDeleted: true } }
    );

    return res.status(200).json({
      message: 'Product and variants deleted successfully',
    });

  } catch (err) {
    console.error('Error deleting product:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET ALL PRODUCTS for a business
 */
exports.getBusinessProducts = async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = req.user._id;

    // Verify business ownership
    const business = await Business.findOne({ _id: businessId, owner: userId });
    if (!business) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const products = await Product.find({
      businessId,
      isDeleted: false,
    })
      .populate('categoryId', 'name')
      .populate('subcategoryId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Get variant counts and total stock for each product
    const productsWithDetails = await Promise.all(
      products.map(async (product) => {
        const variants = await ProductVariant.find({
          productId: product._id,
          isDeleted: false,
        }).lean();
        
        const totalStock = variants.reduce((sum, v) => sum + (v.stock || 0), 0);
        const minPrice = variants.length > 0 
          ? Math.min(...variants.map(v => parseFloat(v.price?.toString() || 0)))
          : 0;
        const maxPrice = variants.length > 0
          ? Math.max(...variants.map(v => parseFloat(v.price?.toString() || 0)))
          : 0;

        return {
          ...product,
          variantCount: variants.length,
          totalStock,
          priceRange: {
            min: minPrice,
            max: maxPrice,
          },
        };
      })
    );

    return res.status(200).json({
      success: true,
      products: productsWithDetails,
    });

  } catch (err) {
    console.error('Error fetching products:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * ADD VARIANTS to existing product
 */
/**
 * ADD VARIANTS to existing product
 */
exports.addVariants = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId } = req.params;
    const { variants } = req.body;

    const product = await Product.findById(productId);
    if (!product || product.isDeleted) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Check business exists
    const business = await Business.findById(product.businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // ✅ FIXED: Find subscription by userId (not by business.subscriptionId)
    const subscription = await Subscription.findOne({
      userId: req.user._id,  // Find by user ID
      status: 'active',
      paymentStatus: { $in: ['PENDING', 'COMPLETED', 'PAID'] },
      endDate: { $gte: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(403).json({ 
        error: 'Valid subscription not found.',
        details: 'Please ensure you have an active subscription.'
      });
    }

    // Get subscription plan
    const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
    if (!subscriptionPlan) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    const productLimit = subscriptionPlan?.limits?.productListings || 0;
    const incomingVariantCount = Array.isArray(variants) ? variants.length : 0;
    const usage = await countProductListingUsage({
      Product,
      ProductVariant,
      businessId: product.businessId,
    });
    const quotaCheck = assertProductListingQuota({
      total: usage.total,
      incomingCount: incomingVariantCount,
      limit: productLimit,
    });

    if (!quotaCheck.ok) {
      return res.status(quotaCheck.status).json({ error: quotaCheck.error });
    }

    // Create new variants with unique SKUs
    const variantDocs = variants.map((variant) => {
      // Generate unique SKU for each variant
      const attributeMap = new Map(Object.entries(variant.attributes || {}));
      const timestamp = Date.now();
      const random = Math.floor(1000 + Math.random() * 9000);
      const sku = variant.sku || `PRD-${timestamp}-${random}`;
      
      return {
        productId: product._id,
        businessId: business._id,
        ownerId: req.user._id,
        attributes: attributeMap,
        sku: sku,
        price: variant.price,
        salePrice: variant.salePrice,
        stock: variant.stock || 0,
        shipping: normalizeVariantShipping(variant.shipping),
        images: variant.images || [],
        isPublished: product.isPublished,
      };
    });

    const savedVariants = await ProductVariant.insertMany(variantDocs);
    const variantIds = savedVariants.map(v => v._id);
    
    await Product.findByIdAndUpdate(productId, {
      $push: { variants: { $each: variantIds } },
    });

    return res.status(201).json({
      message: 'Variants added successfully',
      variants: savedVariants,
    });

  } catch (err) {
    console.error('Error adding variants:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * UPDATE VARIANT
 */
exports.updateVariant = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, variantId } = req.params;
    const {
      attributes,
      sku,
      price,
      salePrice,
      stock,
      shipping,
      images,
      isPublished,
    } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (!mongoose.Types.ObjectId.isValid(variantId)) {
  return res.status(400).json({ error: 'Invalid variant ID' });
}

    const variant = await ProductVariant.findOne({ _id: variantId, productId });
    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    // Handle image cleanup if changed
    if (images && images.length > 0) {
      const oldImages = variant.images || [];
      const imagesToDelete = oldImages.filter(img => !images.includes(img));
      for (const oldImage of imagesToDelete) {
        await deleteCloudinaryFile(oldImage);
      }
    }

    // Update variant
    if (attributes) variant.attributes = new Map(Object.entries(attributes));
    if (sku) variant.sku = sku;
    if (price !== undefined) variant.price = price;
    if (salePrice !== undefined) variant.salePrice = salePrice;
    if (stock !== undefined) variant.stock = stock;
    if (shipping !== undefined) {
      variant.shipping = normalizeVariantShipping(shipping, variant.shipping);
    }
    if (images) variant.images = images;
    if (isPublished !== undefined) variant.isPublished = isPublished;

    await variant.save();

    // Auto-publish/unpublish product based on variants
    if (isPublished === true && !product.isPublished) {
      product.isPublished = true;
      await product.save();
    } else if (isPublished === false) {
      const publishedVariants = await ProductVariant.countDocuments({
        productId,
        isPublished: true,
        isDeleted: false,
      });
      if (publishedVariants === 0) {
        product.isPublished = false;
        await product.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Variant updated successfully',
      variant,
    });

  } catch (err) {
    console.error('Error updating variant:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * DELETE VARIANT (Soft delete)
 */
exports.deleteVariant = async (req, res) => {
  try {
    const { productId, variantId } = req.params;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const variant = await ProductVariant.findOne({ _id: variantId, productId });
    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    // Soft delete
    variant.isDeleted = true;
    await variant.save();

    // Remove from product's variants array
    product.variants = product.variants.filter(v => v.toString() !== variantId);
    
    // Check if any published variants remain
    const publishedVariants = await ProductVariant.countDocuments({
      productId,
      isPublished: true,
      isDeleted: false,
    });

    if (publishedVariants === 0) {
      product.isPublished = false;
    }

    await product.save();

    return res.status(200).json({
      success: true,
      message: 'Variant deleted successfully',
    });

  } catch (err) {
    console.error('Error deleting variant:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET VARIANT BY ID
 */
exports.getVariantById = async (req, res) => {
  try {
    const { productId, variantId } = req.params;

    const variant = await ProductVariant.findOne({
      _id: variantId,
      productId,
      isDeleted: false,
    }).lean();

    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    // Parse Decimal128 values
    const parsedVariant = {
      ...variant,
      price: parseFloat(variant.price?.toString() || '0'),
      salePrice: parseFloat(variant.salePrice?.toString() || '0'),
    };

    return res.status(200).json({
      success: true,
      variant: parsedVariant,
    });

  } catch (err) {
    console.error('Error fetching variant:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * UPDATE VARIANT STOCK
 */
exports.updateVariantStock = async (req, res) => {
  try {
    const { variantId } = req.params;
    const { stock, operation } = req.body; // operation: 'set', 'increment', 'decrement'

    const variant = await ProductVariant.findOne({
      _id: variantId,
      ownerId: req.user._id,
      isDeleted: false,
    });

    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    const stockValue = Number(stock);
    if (!Number.isFinite(stockValue)) {
      return res.status(400).json({ error: 'Invalid stock value' });
    }

    switch (operation) {
      case 'set':
        if (stockValue < 0) {
          return res.status(400).json({ error: 'Stock cannot be negative' });
        }
        variant.stock = stockValue;
        break;
      case 'increment':
        if (stockValue < 0) {
          return res.status(400).json({ error: 'Increment amount cannot be negative' });
        }
        variant.stock += stockValue;
        break;
      case 'decrement':
        if (stockValue < 0) {
          return res.status(400).json({ error: 'Decrement amount cannot be negative' });
        }
        if (variant.stock - stockValue < 0) {
          return res.status(400).json({ error: 'Insufficient stock' });
        }
        variant.stock -= stockValue;
        break;
      default:
        return res.status(400).json({
          error: 'Invalid operation. Allowed: set, increment, decrement',
        });
    }

    await variant.save();

    return res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      stock: variant.stock,
    });

  } catch (err) {
    console.error('Error updating stock:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};


exports.getProductUploadUrl = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fileName, fileType, documentType, productId, variantIndex, currentImageCount } = req.query;

    if (!fileName || !fileType || !documentType) {
      return res.status(400).json({
        message: "fileName, fileType, and documentType are required",
      });
    }

    // Allowed product image types
    const allowedDocTypes = [
      "product-cover",     // Main product cover image
      "product-gallery",   // Product gallery images  
      "product-variant"    // Variant images
    ];

    if (!allowedDocTypes.includes(documentType)) {
      return res.status(400).json({
        message: "Invalid document type. Allowed: product-cover, product-gallery, product-variant",
      });
    }

    // Validate file type (images only)
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(fileType)) {
      return res.status(400).json({
        message: "Only image files are allowed (JPEG, JPG, PNG, GIF, WEBP)",
      });
    }

    if (documentType === "product-gallery") {
      const subscription = await Subscription.findOne({
        userId,
        status: 'active',
        endDate: { $gte: new Date() },
      }).sort({ createdAt: -1 });

      if (!subscription) {
        return res.status(403).json({
          message: 'Valid subscription not found.',
        });
      }

      const subscriptionPlan = await SubscriptionPlan.findById(subscription.subscriptionPlanId);
      const galleryImageLimit = getGalleryImageLimit(subscriptionPlan);
      const currentCount = Number(currentImageCount || 0);

      if (currentCount + 1 > galleryImageLimit) {
        return res.status(403).json({
          message: `Gallery image upload limit reached. Maximum ${galleryImageLimit} gallery images allowed for your plan.`,
        });
      }
    }

    const bucketName = process.env.AWS_S3_BUCKET;

    // Organize folder structure based on document type
    let folderPath;
    switch (documentType) {
      case "product-cover":
        folderPath = `products/${userId}/covers`;
        break;
      case "product-gallery":
        folderPath = `products/${userId}/gallery`;
        break;
      case "product-variant":
        // If productId and variantIndex provided, organize in variant-specific folder
        if (productId && variantIndex) {
          folderPath = `products/${userId}/${productId}/variants/${variantIndex}`;
        } else {
          folderPath = `products/${userId}/variants/temp`;
        }
        break;
      default:
        folderPath = `products/${userId}/temp`;
    }

    // Clean filename and add timestamp to prevent collisions
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const key = `${folderPath}/${timestamp}-${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300, // 5 minutes
    });

    // Construct public URL
    const region = process.env.AWS_REGION || 'us-east-1';
    const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    return res.json({
      success: true,
      uploadUrl,
      fileUrl,
      documentType,
      key,
      expiresIn: 300
    });

  } catch (error) {
    console.error("Presigned URL error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
    });
  }
};

exports.getVariantImageUploadUrl = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fileName, fileType, productId, variantSku } = req.query;

    if (!fileName || !fileType || !productId) {
      return res.status(400).json({
        message: "fileName, fileType, and productId are required",
      });
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(fileType)) {
      return res.status(400).json({
        message: "Only image files are allowed",
      });
    }

    const bucketName = process.env.AWS_S3_BUCKET;

    // Create folder path with variant SKU if provided
    let folderPath;
    if (variantSku) {
      folderPath = `products/${userId}/${productId}/variants/${variantSku}`;
    } else {
      folderPath = `products/${userId}/${productId}/variants`;
    }

    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const key = `${folderPath}/${timestamp}-${cleanFileName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });

    const region = process.env.AWS_REGION || 'us-east-1';
    const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    return res.json({
      success: true,
      uploadUrl,
      fileUrl,
      key
    });

  } catch (error) {
    console.error("Variant image URL error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate variant image upload URL",
    });
  }
};
