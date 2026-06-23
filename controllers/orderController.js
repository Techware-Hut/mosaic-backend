// const Order = require('../models/Order');
// const ProductVariant = require('../models/ProductVariant');
// const { processPayment } = require('../utils/paymentGateway'); // Utility function to process payment
// const { isValidPhoneNumber } = require('libphonenumber-js'); // For validating international phone numbers

// Create Order and Process Payment
// const createOrder = async (req, res) => {
//   const { userId, shippingAddress, orderItems, paymentDetails } = req.body;

//   try {
//     // Step 1: Validate the provided address object
//     if (!shippingAddress || !shippingAddress.name || !shippingAddress.street || !shippingAddress.city || !shippingAddress.state || !shippingAddress.country || !shippingAddress.pincode || !shippingAddress.phoneNumber) {
//       return res.status(400).json({ message: 'All address fields are required' });
//     }

//     // Validate phone number using libphonenumber
//     if (!isValidPhoneNumber(shippingAddress.phoneNumber, shippingAddress.country)) {
//       return res.status(400).json({ message: 'Invalid phone number format' });
//     }

//     // Optional: Validate address format (regex validation for pincode)
//     const validPincode = /^[0-9]{5,6}$/;  // Pincode validation (5-6 digits)
//     if (!validPincode.test(shippingAddress.pincode)) {
//       return res.status(400).json({ message: 'Invalid pincode format' });
//     }

//     // Step 2: Validate stock availability for each item in the order
//     for (let item of orderItems) {
//       const productVariant = await ProductVariant.findById(item.productVariantId);
//       if (productVariant.isDeleted) {
//         return res.status(400).json({ message: `Product variant is no longer available.` });
//       }

//       const sizeVariant = productVariant.sizes.find(s => s.size === item.size);
//       if (!sizeVariant || sizeVariant.stock < item.quantity) {
//         return res.status(400).json({ message: `Not enough stock for ${productVariant.productId} ${item.size}` });
//       }
//     }

//     // Step 3: Calculate total amount for the order
//     let totalAmount = 0;
//     for (let item of orderItems) {
//       const productVariant = await ProductVariant.findById(item.productVariantId);
//       const sizeVariant = productVariant.sizes.find(s => s.size === item.size);
//       const price = sizeVariant.salePrice || sizeVariant.price;  // Apply sale price if valid
//       totalAmount += price * item.quantity;
//     }

//     // Step 4: Create the order, embedding the shipping address directly in the order
//     const order = new Order({
//       userId,
//       shippingAddress,  // Directly embed the validated address
//       orderItems,
//       totalAmount,
//       paymentStatus: 'pending',
//       transactionId: paymentDetails.transactionId,
//       orderStatus: 'pending',
//       orderStatusHistory: [{ status: 'pending' }],
//     });

//     await order.save();  // Save the order to the database

//     // Step 5: Process payment
//     const paymentStatus = await processPayment(paymentDetails);
//     if (paymentStatus === 'success') {
//       order.paymentStatus = 'paid';
//       order.orderStatus = 'completed';
//       await order.save();  // Update the order with payment details

//       // Step 6: Update stock after successful payment
//       for (let item of orderItems) {
//         const productVariant = await ProductVariant.findById(item.productVariantId);
//         const sizeVariant = productVariant.sizes.find(s => s.size === item.size);
//         sizeVariant.stock -= item.quantity;
//         await productVariant.save();  // Save the updated product variant with new stock
//       }

//       res.status(201).json({ success: true, order });  // Send the created order as response
//     } else {
//       res.status(400).json({ message: 'Payment Failed' });
//     }
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: 'Failed to process the order' });
//   }
// };

// module.exports = { createOrder };

// controllers/orderController.js
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const Order = require("../models/Order");
const User = require("../models/User");
const ProductVariant = require("../models/ProductVariant")  ;
const Business = require("../models/Business");
const { getBusinessCheckoutBlock } = require("../utils/checkoutGuards");
const { sendOrderStatusEmail, sendOrderUpdateEmail } = require("../utils/orderPhase");
const {
  calculateShippingForVendor,
  normalizeDeliverySpeed,
} = require("../utils/vendorShipping");
const {
  getResolvedTaxCategory,
  getTaxRateForCategory,
  buildTaxAwareAmounts,
  extractTaxFromInclusiveAmount,
  roundCurrency,
} = require("../utils/vendorTax");

const toNum = (value) => {
  if (value && typeof value === "object" && value.$numberDecimal != null) {
    return Number(value.$numberDecimal);
  }

  return value == null ? null : Number(value);
};

const ADMIN_PAYMENT_BUCKETS = ["pending", "paid", "failed", "refunded"];
const ADMIN_STATUS_BUCKETS = [
  "created",
  "ordered",
  "accepted",
  "rejected",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
  "refunded",
];

const toObjectIdIfValid = (value) => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return value;
  return new mongoose.Types.ObjectId(value);
};

const buildAdminOrderMatch = (query = {}) => {
  const {
    status,
    paymentStatus,
    businessId,
    vendorId,
    userId,
    from,
    to,
    q,
  } = query;

  const match = {};
  if (status) match.status = status;
  if (paymentStatus) match.paymentStatus = paymentStatus;
  if (businessId) match.businessId = toObjectIdIfValid(businessId);
  if (vendorId) match.vendorId = toObjectIdIfValid(vendorId);
  if (userId) match.userId = toObjectIdIfValid(userId);
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) match.createdAt.$lte = new Date(to);
  }
  if (q) {
    const searchClauses = [{ groupOrderId: q }];
    if (mongoose.Types.ObjectId.isValid(q)) {
      searchClauses.push({ _id: new mongoose.Types.ObjectId(q) });
    }
    match.$or = searchClauses;
  }

  return match;
};

const summarizeBuckets = (buckets, rows) => {
  const summary = Object.fromEntries(buckets.map((bucket) => [bucket, 0]));
  rows.forEach((row) => {
    if (row?._id != null && Object.prototype.hasOwnProperty.call(summary, row._id)) {
      summary[row._id] = row.count;
    }
  });
  return summary;
};

const currencyExpression = { $ifNull: ["$currency", "USD"] };
const amountExpression = (field, fallback = 0) => ({ $ifNull: [field, fallback] });

const toCurrencySummary = (row) => ({
  currency: row._id || "USD",
  totalOrders: row.totalOrders || 0,
  grossSalesAmount: row.grossSalesAmount || 0,
  paidSalesAmount: row.paidSalesAmount || 0,
  refundedSalesAmount: row.refundedSalesAmount || 0,
  subtotalAmount: row.subtotalAmount || 0,
  taxAmount: row.taxAmount || 0,
  shippingAmount: row.shippingAmount || 0,
});

const toVendorSalesSummary = (row) => ({
  vendorId: row.vendorId ? String(row.vendorId) : null,
  currency: row.currency || "USD",
  orderCount: row.orderCount || 0,
  totalSalesAmount: row.totalSalesAmount || 0,
});

const getVariantAttribute = (variantDoc, key) => {
  if (!variantDoc?.attributes) return null;

  if (typeof variantDoc.attributes.get === "function") {
    const direct = variantDoc.attributes.get(key);
    if (direct != null) return direct;

    const fallbackKey = Array.from(variantDoc.attributes.keys()).find(
      (attrKey) =>
        String(attrKey).toLowerCase() === String(key).toLowerCase()
    );

    return fallbackKey ? variantDoc.attributes.get(fallbackKey) : null;
  }

  const entries = Object.entries(variantDoc.attributes);
  const match = entries.find(
    ([attrKey]) => String(attrKey).toLowerCase() === String(key).toLowerCase()
  );
  return match ? match[1] : null;
};

const normalizeCapabilityStatus = (status) => {
  return typeof status === "string" ? status.toLowerCase() : "inactive";
};

const getTransferCapabilityStatus = (account) => {
  const capabilities = account?.capabilities || {};

  return (
    normalizeCapabilityStatus(capabilities.transfers) ||
    normalizeCapabilityStatus(
      capabilities?.stripe_balance?.stripe_transfers
    ) ||
    "inactive"
  );
};

const resolveVariantSelection = (variantDoc, requestedValue) => {
  const requested = requestedValue == null ? "" : String(requestedValue).trim();
  const sizes = Array.isArray(variantDoc?.sizes) ? variantDoc.sizes : null;

  if (sizes) {
    const selectedSize = sizes.find((entry) => String(entry.size) === requested);
    if (!selectedSize) return null;

    return {
      key: String(selectedSize.size),
      stock: Number(selectedSize.stock || 0),
      sku: selectedSize.sku || variantDoc.sku || null,
      price: toNum(selectedSize.price),
      salePrice: toNum(selectedSize.salePrice),
      discountEndDate: selectedSize.discountEndDate || null,
      allowBackorder: Boolean(variantDoc.allowBackorder),
      stockSource: selectedSize,
      usesNestedSizes: true,
    };
  }

  const attributeSize = getVariantAttribute(variantDoc, "size");
  const normalizedKey = requested || attributeSize || "default";

  if (
    attributeSize &&
    requested &&
    String(attributeSize).toLowerCase() !== requested.toLowerCase()
  ) {
    return null;
  }

  return {
    key: String(normalizedKey),
    stock: Number(variantDoc?.stock || 0),
    sku: variantDoc?.sku || null,
    price: toNum(variantDoc?.price),
    salePrice: toNum(variantDoc?.salePrice),
    discountEndDate: null,
    allowBackorder: Boolean(variantDoc?.allowBackorder),
    stockSource: variantDoc,
    usesNestedSizes: false,
  };
};

const resolveRequestedDeliverySpeed = (body) => {
  return normalizeDeliverySpeed(
    body?.deliverySpeed ||
      body?.selectedDeliverySpeed ||
      body?.deliveryOption ||
      body?.speed ||
      body?.shippingMethod ||
      body?.shippingType ||
      body?.shippingOption ||
      body?.shipping?.deliverySpeed ||
      body?.shipping?.selectedDeliverySpeed ||
      body?.shipping?.speed ||
      body?.shipping?.method ||
      body?.shipping?.type
  );
};

// exports.initiateOrder = async (req, res) => {
//   try {
//     const { items, shippingAddress, userNote } = req.body;
//     const userId = req.user.id;

//     if (!Array.isArray(items) || items.length === 0) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Items are required" });
//     }

//     if (
//       !shippingAddress?.fullName ||
//       !shippingAddress?.phone ||
//       !shippingAddress?.addressLine1
//     ) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Shipping address is incomplete" });
//     }

//     // Build vendor map (to detect multiple vendors) & validate each item
//     const vendorItemMap = {};
//     const seen = new Set();

//     for (const item of items) {
//       const { productId, variantId, size, quantity, price } = item;
//       if (!productId || !variantId || !size || !quantity || !price) {
//         return res
//           .status(400)
//           .json({ success: false, message: "Invalid item structure" });
//       }

//       const key = `${variantId}-${size}`;
//       if (seen.has(key)) {
//         return res
//           .status(400)
//           .json({ success: false, message: "Duplicate item in cart" });
//       }
//       seen.add(key);

//       const variant = await ProductVariant.findById(variantId).populate(
//         "productId"
//       ); // ensures product linkage integrity

//       if (
//         !variant ||
//         !variant.productId ||
//         variant.productId._id.toString() !== productId
//       ) {
//         return res
//           .status(404)
//           .json({ success: false, message: "Product or variant not found" });
//       }

//       const selectedVariant = resolveVariantSelection(variant, size);
//       if (!selectedVariant) {
//         return res
//           .status(400)
//           .json({ success: false, message: `Size ${size} not available` });
//       }

//       if (!selectedVariant.allowBackorder && selectedVariant.stock < quantity) {
//         return res
//           .status(400)
//           .json({ success: false, message: `${variant.productId.title} is Out of stock for size ${size} remove it first` });
//       }

//       // Verify price (handles sale price with end date)
//       const discountEnd = selectedVariant.discountEndDate
//         ? new Date(selectedVariant.discountEndDate)
//         : null;
//       const validDiscount = !!(
//         selectedVariant.salePrice &&
//         (!discountEnd || discountEnd.getTime() > Date.now())
//       );
//       const actualPrice = validDiscount
//         ? Number(selectedVariant.salePrice)
//         : Number(selectedVariant.price);
//       if (Number(price) !== actualPrice) {
//         return res
//           .status(400)
//           .json({ success: false, message: `Price mismatch for size ${size}` });
//       }

//       const vendorId = variant.ownerId.toString();

//       // Collect items per vendor
//       if (!vendorItemMap[vendorId]) {
//         vendorItemMap[vendorId] = {
//           businessId: variant.businessId,
//           items: [],
//         };
//       }

//       vendorItemMap[vendorId].items.push({
//         productId,
//         variantId,
//         quantity,
//         price: actualPrice,
//         size,
//         sku: selectedVariant.sku,
//         color: variant.color || getVariantAttribute(variant, "color") || "default",
//       });
//     }

//     // Enforce single-vendor checkout (for now)
//     const vendorIds = Object.keys(vendorItemMap);
//     if (vendorIds.length !== 1) {
//       return res.status(400).json({
//         success: false,
//         message: "Single-vendor checkout only at this time.",
//       });
//     }

//     // Compute totals and create a single order
//     const vendorId = vendorIds[0];
//     const { businessId, items: vendorItems } = vendorItemMap[vendorId];
//     const totalAmount = vendorItems.reduce(
//       (sum, i) => sum + i.price * i.quantity,
//       0
//     );

//     // Load Business to get Connect account
//     const business = await Business.findById(businessId);
//     if (!business || !business.stripeConnectAccountId) {
//       return res.status(400).json({
//         success: false,
//         message: "Vendor is not connected to Stripe. Please contact support.",
//       });
//     }

//     const account = await stripe.accounts.retrieve(business.stripeConnectAccountId);
//     const transferCapability = getTransferCapabilityStatus(account);

//     business.chargesEnabled = !!account.charges_enabled;
//     business.payoutsEnabled = !!account.payouts_enabled;
//     business.capabilities = {
//       card_payments: normalizeCapabilityStatus(account?.capabilities?.card_payments),
//       transfers: transferCapability,
//     };
//     business.onboardingStatus =
//       business.chargesEnabled && business.payoutsEnabled && transferCapability === "active"
//         ? "completed"
//         : "requirements_due";
//     if (business.onboardingStatus === "completed" && !business.onboardedAt) {
//       business.onboardedAt = new Date();
//     }
//     await business.save();

//     if (!business.chargesEnabled || transferCapability !== "active") {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Vendor Stripe onboarding is incomplete. The connected account can't receive transfers yet.",
//       });
//     }

//     const groupOrderId = uuidv4();

//     const order = await new Order({
//       groupOrderId,
//       userId,
//       vendorId,
//       businessId,
//       items: vendorItems,
//       totalAmount, // kept in major units (USD); Stripe gets cents below
//       currency: "USD",
//       status: "created",
//       statusHistory: [{ status: "created" }],
//       shippingAddress,
//       userNote,
//       paymentStatus: "pending",
//       paymentMethod: "stripe",
//     }).save();

//     // Platform fee in cents (e.g., 50 => $0.50). Set via env.
//     const platformFeeCents = Number.parseInt(
//       process.env.PLATFORM_FEE_CENTS || "0"
//     );

//     // Create a vendor-directed PaymentIntent with Connect transfer
//     const paymentIntent = await stripe.paymentIntents.create(
//       {
//         amount: Math.round(totalAmount * 100), // cents
//         currency: "usd",
//         metadata: {
//           groupOrderId,
//           orderId: order._id.toString(),
//         },
//         application_fee_amount: platformFeeCents,
//         transfer_data: {
//           destination: business.stripeConnectAccountId,
//         },
//       },
//       {
//         // Helps prevent accidental duplicate charges on retries
//         idempotencyKey: `pi:${order._id.toString()}`,
//       }
//     );

//     // Save PI id on order
//     order.paymentId = paymentIntent.id;
//     await order.save();

//     return res.status(201).json({
//       success: true,
//       message: "Order initialized",
//       groupOrderId,
//       orderId: order._id,
//       clientSecret: paymentIntent.client_secret,
//     });
//   } catch (err) {
//     console.error("Order initiation failed:", err);
//     if (err?.code === "insufficient_capabilities_for_transfer") {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Vendor Stripe onboarding is incomplete. The connected account needs transfer capability enabled before checkout can start.",
//       });
//     }
//     return res.status(500).json({ success: false, message: "Server error" });
//   }
// };


exports.initiateOrder = async (req, res) => {
  try {
    const { items, shippingAddress, userNote } = req.body;
    const userId = req.user.id;
    const deliverySpeed = resolveRequestedDeliverySpeed(req.body);

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items are required",
      });
    }

    if (
      !shippingAddress?.fullName ||
      !shippingAddress?.phone ||
      !shippingAddress?.addressLine1
    ) {
      return res.status(400).json({
        success: false,
        message: "Shipping address is incomplete",
      });
    }

    const vendorItemMap = {};
    const seen = new Set();

    for (const item of items) {
      const { productId, variantId, size, quantity, price } = item;

      if (!productId || !variantId || !size || !quantity || !price) {
        return res.status(400).json({
          success: false,
          message: "Invalid item structure",
        });
      }

      const key = `${variantId}-${size}`;
      if (seen.has(key)) {
        return res.status(400).json({
          success: false,
          message: "Duplicate item in cart",
        });
      }
      seen.add(key);

      const variant = await ProductVariant.findById(variantId).populate(
        "productId"
      );

      if (
        !variant ||
        !variant.productId ||
        variant.productId._id.toString() !== productId
      ) {
        return res.status(404).json({
          success: false,
          message: "Product or variant not found",
        });
      }

      const selectedVariant = resolveVariantSelection(variant, size);

      if (!selectedVariant) {
        return res.status(400).json({
          success: false,
          message: `Size ${size} not available`,
        });
      }

      if (!selectedVariant.allowBackorder && selectedVariant.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `${variant.productId.title} is out of stock for size ${size}`,
        });
      }

      const discountEnd = selectedVariant.discountEndDate
        ? new Date(selectedVariant.discountEndDate)
        : null;

      const validDiscount =
        selectedVariant.salePrice &&
        (!discountEnd || discountEnd.getTime() > Date.now());

      const actualPrice = validDiscount
        ? Number(selectedVariant.salePrice)
        : Number(selectedVariant.price);

      const vendorId = variant.ownerId.toString();

      if (!vendorItemMap[vendorId]) {
        vendorItemMap[vendorId] = {
          businessId: variant.businessId,
          items: [],
        };
      }

      vendorItemMap[vendorId].items.push({
        productId,
        variantId,
        quantity,
        submittedPrice: Number(price),
        priceExclTax: actualPrice,
        size,
        sku: selectedVariant.sku,
        taxCategory: getResolvedTaxCategory(variant.productId),
        color:
          variant.color ||
          getVariantAttribute(variant, "color") ||
          "default",
      });
    }

    const vendorIds = Object.keys(vendorItemMap);

    if (vendorIds.length !== 1) {
      return res.status(400).json({
        success: false,
        message: "Single-vendor checkout only at this time.",
      });
    }

    const vendorId = vendorIds[0];
    const { businessId, items: rawVendorItems } = vendorItemMap[vendorId];

    // Load user + business
    const business = await Business.findById(businessId);
    const user = await User.findById(userId).select("email");

    const checkoutBlock = getBusinessCheckoutBlock(business);
    if (checkoutBlock) {
      return res.status(checkoutBlock.status).json({
        success: false,
        message: checkoutBlock.message,
      });
    }

    const account = await stripe.accounts.retrieve(
      business.stripeConnectAccountId
    );

    const transferCapability = getTransferCapabilityStatus(account);

    business.chargesEnabled = !!account.charges_enabled;
    business.payoutsEnabled = !!account.payouts_enabled;
    business.capabilities = {
      card_payments: normalizeCapabilityStatus(
        account?.capabilities?.card_payments
      ),
      transfers: transferCapability,
    };

    business.onboardingStatus =
      business.chargesEnabled &&
      business.payoutsEnabled &&
      transferCapability === "active"
        ? "completed"
        : "requirements_due";

    if (business.onboardingStatus === "completed" && !business.onboardedAt) {
      business.onboardedAt = new Date();
    }

    await business.save();

    if (!business.chargesEnabled || transferCapability !== "active") {
      return res.status(400).json({
        success: false,
        message: "Vendor Stripe onboarding incomplete.",
      });
    }

    const vendorItems = rawVendorItems.map((item) => {
      const taxRate = getTaxRateForCategory(
        business.taxSettings,
        item.taxCategory
      );
      const taxPricing = buildTaxAwareAmounts({
        priceExclTax: item.priceExclTax,
        salePriceExclTax: null,
        taxRate,
      });
      const unitPriceInclTax = taxPricing.priceInclTax ?? roundCurrency(item.priceExclTax);
      const lineAmounts = extractTaxFromInclusiveAmount({
        inclusiveAmount: unitPriceInclTax * Number(item.quantity || 0),
        taxRate,
      });
      const submittedPrice = Number(item.submittedPrice);
      const acceptsLegacyPrice =
        Math.abs(submittedPrice - Number(item.priceExclTax || 0)) < 0.01;
      const acceptsTaxInclusivePrice =
        Math.abs(submittedPrice - Number(unitPriceInclTax || 0)) < 0.01;

      if (!acceptsLegacyPrice && !acceptsTaxInclusivePrice) {
        const error = new Error(`Price mismatch for size ${item.size}`);
        error.statusCode = 400;
        throw error;
      }

      return {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        price: unitPriceInclTax,
        size: item.size,
        sku: item.sku,
        color: item.color,
        tax: {
          categoryCode: item.taxCategory?.code || null,
          categoryLabel: item.taxCategory?.label || null,
          rate: taxRate,
          taxIncluded: true,
          unitPriceExclTax: taxPricing.priceExclTax,
          unitPriceInclTax,
          lineBaseAmount: lineAmounts.amountExclTax,
          lineTaxAmount: lineAmounts.taxAmount,
          lineTotalAmount: lineAmounts.amountInclTax,
        },
      };
    });

    const subtotalAmount = vendorItems.reduce(
      (sum, i) => sum + Number(i.tax?.lineTotalAmount || (i.price * i.quantity) || 0),
      0
    );
    const subtotalExclTaxAmount = vendorItems.reduce(
      (sum, i) => sum + Number(i.tax?.lineBaseAmount || 0),
      0
    );
    const taxTotal = vendorItems.reduce(
      (sum, i) => sum + Number(i.tax?.lineTaxAmount || 0),
      0
    );
    const totalQuantity = vendorItems.reduce(
      (sum, i) => sum + Number(i.quantity || 0),
      0
    );

    let shippingCalculation;
    try {
      shippingCalculation = calculateShippingForVendor(
        business.shippingSettings,
        {
          deliverySpeed,
          subtotal: subtotalAmount,
          totalQuantity,
        }
      );
    } catch (shippingError) {
      return res.status(400).json({
        success: false,
        message: shippingError.message,
      });
    }

    const totalAmount =
      subtotalAmount + Number(shippingCalculation.amount || 0);

    const groupOrderId = uuidv4();

    const order = await new Order({
      groupOrderId,
      userId,
      vendorId,
      businessId,
      items: vendorItems,
      subtotalAmount,
      taxSummary: {
        subtotalExclTaxAmount,
        taxTotal,
        taxIncluded: true,
      },
      totalAmount,
      currency: "USD",
      status: "created",
      statusHistory: [{ status: "created" }],
      shippingAddress,
      shipping: {
        deliverySpeed: shippingCalculation.deliverySpeed,
        method: shippingCalculation.method,
        amount: Number(shippingCalculation.amount || 0),
        freeShippingApplied: Boolean(shippingCalculation.freeShippingApplied),
        freeShippingThreshold: shippingCalculation.freeShippingThreshold,
        quantityTier: shippingCalculation.matchedTier
          ? {
              minQuantity: shippingCalculation.matchedTier.minQuantity,
              maxQuantity: shippingCalculation.matchedTier.maxQuantity,
            }
          : undefined,
      },
      userNote,
      paymentStatus: "pending",
      paymentMethod: "stripe",
    }).save();

    const platformFeeCents = Number.parseInt(
      process.env.PLATFORM_FEE_CENTS || "0"
    );

    console.log("Initiating order payment intent", {
      orderId: order._id.toString(),
      groupOrderId,
      businessId: business?._id?.toString?.() || String(businessId),
      vendorId: vendorId?.toString?.() || String(vendorId),
      stripeConnectAccountId: business?.stripeConnectAccountId || null,
      amountCents: Math.round(totalAmount * 100),
      currency: "usd",
      platformFeeCents,
    });

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(totalAmount * 100),
        currency: "usd",
        metadata: {
          groupOrderId,
          orderId: order._id.toString(),
        },
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: business.stripeConnectAccountId,
        },
      },
      {
        idempotencyKey: `pi:${order._id.toString()}`,
      }
    );

    console.log("Order payment intent created", {
      orderId: order._id.toString(),
      paymentIntentId: paymentIntent.id,
      clientSecretPresent: Boolean(paymentIntent.client_secret),
      stripeConnectAccountId: business?.stripeConnectAccountId || null,
    });

    order.paymentId = paymentIntent.id;
    await order.save();

    return res.status(201).json({
      success: true,
      message: "Order initialized",
      groupOrderId,
      orderId: order._id,
      clientSecret: paymentIntent.client_secret,
      totals: {
        subtotalExclTaxAmount,
        subtotalAmount,
        taxTotal,
        shippingAmount: Number(shippingCalculation.amount || 0),
        totalAmount,
        deliverySpeed: shippingCalculation.deliverySpeed,
        shippingMethod: shippingCalculation.method,
        freeShippingApplied: Boolean(shippingCalculation.freeShippingApplied),
      },
      shipping: {
        deliverySpeed: shippingCalculation.deliverySpeed,
        amount: Number(shippingCalculation.amount || 0),
        method: shippingCalculation.method,
        freeShippingApplied: Boolean(shippingCalculation.freeShippingApplied),
        freeShippingThreshold: shippingCalculation.freeShippingThreshold,
        matchedTier: shippingCalculation.matchedTier || null,
      },
      taxSummary: {
        subtotalExclTaxAmount,
        subtotalInclTaxAmount: subtotalAmount,
        taxTotal,
        taxIncluded: true,
      },
    });
  } catch (err) {
    console.error("Order initiation failed:", err);
    console.error("Order initiation Stripe details:", {
      type: err?.type,
      code: err?.code,
      message: err?.message,
      statusCode: err?.statusCode,
      requestId: err?.requestId,
    });

    if (err?.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: err.message || "Invalid order payload",
      });
    }

    if (err?.code === "insufficient_capabilities_for_transfer") {
      return res.status(400).json({
        success: false,
        message: "Vendor Stripe onboarding incomplete.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};  


exports.getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const status = req.query.status; // optional query param

    const filter = { userId, status: { $ne: "created" } };
    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate("vendorId", "name") // populate vendor name
      .populate("items.productId", "title coverImage")
      .populate("items.variantId", "color sizes images");

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error("Failed to fetch user orders:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getVendorOrders = async (req, res) => {
  try {
    const vendorId = req.user._id;
    const status = req.query.status;
    const businessId = req.query.businessId;

    const filter = { vendorId, paymentStatus: { $in: ["paid", "refunded"] } };
    if (status) filter.status = status;
    if (businessId) filter.businessId = businessId;

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate("userId", "name email") // buyer info
      .populate("items.productId", "title coverImage")
      .populate("items.variantId", "color sizes");

    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error("Error fetching vendor orders:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.acceptOrder = async (req, res) => {
  try {
    const vendorId = req.user._id;
    const orderId = req.params.orderId;

    const order = await Order.findOne({ _id: orderId, vendorId }).populate('userId');
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found or unauthorized" });
    }

    if (order.status !== "ordered") {
      return res.status(400).json({
        success: false,
        message: 'Only "ordered" orders can be accepted',
      });
    }

    // 🔁 Decrease stock
    for (const item of order.items) {
      const variant = await ProductVariant.findById(item.variantId);
      if (!variant) continue;

      const selectedVariant = resolveVariantSelection(variant, item.size);
      if (!selectedVariant) {
        return res.status(500).json({
          success: false,
          message: "Order Cannot Be Accepted - Item configuration is invalid",
        });
      }

      if (selectedVariant.stock === 0) {
        return res.status(500).json({
          success: false,
          message: "Order Cannot Be Accepted - Item Out of Stock",
        });
      }

      selectedVariant.stockSource.stock = Math.max(
        0,
        Number(selectedVariant.stockSource.stock || 0) - Number(item.quantity || 0)
      );

      await variant.save();
    }

    order.status = "accepted";
    order.statusHistory.push({ status: "accepted" });
    await order.save();

    try {
      const customerEmail = order.userId.email; // use whichever you store
      if (customerEmail) {
        await sendOrderStatusEmail(customerEmail, order._id.toString(), "accepted");
      }
    } catch (e) {
      console.error("Failed to send acceptance email:", e?.message || e);
    }

    res.json({
      success: true,
      message: "Order accepted and stock updated",
      order,
    });
  } catch (err) {
    console.error("Error accepting order:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.rejectOrder = async (req, res) => {
  try {
    const vendorId = req.user._id;
    const orderId = req.params.orderId;

    const order = await Order.findOne({ _id: orderId, vendorId }).populate('businessId').populate('userId');
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found or unauthorized" });
    }

    if (order.status !== "ordered") {
      return res.status(400).json({
        success: false,
        message: 'Only "ordered" orders can be rejected',
      });
    }

    order.status = "rejected";
    order.statusHistory.push({ status: "rejected" });

    // Refund if already paid
    if (order.paymentStatus === "paid" && order.paymentId) {
      const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

      const vendorStripeAccountId = order.businessId.stripeConnectAccountId; // Vendor's Stripe Connect Account ID

      try {
        // Create the refund from the vendor's Stripe account
        const refund = await stripe.refunds.create({
          payment_intent: order.paymentId,               // pi_...
          amount: Math.round(order.totalAmount * 100),   // in the smallest currency unit
          reason: "requested_by_customer",
          metadata: {
            custom_reason: "rejected_by_merchant"
          },
          // ensure funds are pulled back from the connected account & app fee is refunded
          reverse_transfer: true,
          refund_application_fee: true,
        });


        // Update order and payment status
        order.paymentStatus = "refunded";
        order.statusHistory.push({ status: "refunded" });

        console.log("Refund initiated for order", {
          orderId,
          paymentIntentId: order.paymentId,
        });
      } catch (err) {
        console.error("Error processing refund via Stripe Connect:", err);
        return res.status(500).json({ success: false, message: "Refund failed" });
      }
    }

    await order.save();
    try {
      const customerEmail = order.userId.email; // use whichever you store
      if (customerEmail) {
        await sendOrderStatusEmail(customerEmail, order._id.toString(), "rejected");
      }
    } catch (e) {
      console.error("Failed to send rejection email:", e?.message || e);
    }

    res.json({
      success: true,
      message: "Order rejected and refunded (if paid)",
      order,
    });
  } catch (err) {
    console.error("Error rejecting order:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.shipOrder = async (req, res) => {
  try {
    const vendorId = req.user._id;
    const orderId = req.params.orderId;
    const { trackingId, trackingUrl, vendorNote } = req.body;

    if (!trackingId || !trackingUrl) {
      return res.status(400).json({
        success: false,
        message: "Tracking ID and URL are required",
      });
    }

    const order = await Order.findOne({ _id: orderId, vendorId })
      .populate("userId", "email"); // ✅ FIX

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or unauthorized",
      });
    }

    if (order.status !== "accepted") {
      return res.status(400).json({
        success: false,
        message: "Only accepted orders can be shipped",
      });
    }

    order.trackingInfo = { trackingId, trackingUrl };
    if (vendorNote) order.vendorNote = vendorNote;

    order.status = "shipped";
    order.statusHistory.push({ status: "shipped" });

    await order.save();

    // ✅ FIX EMAIL SENDING
    const email = order.userId?.email;

    if (email) {
      await sendOrderUpdateEmail(email, "shipped", trackingUrl);
    } else {
      console.error("Missing user email for order:", order._id);
    }

    res.json({
      success: true,
      message: "Order marked as shipped",
      order,
    });
  } catch (err) {
    console.error("Error in shipOrder:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deliverOrder = async (req, res) => {
  try {
    const vendorId = req.user._id;
    const orderId = req.params.orderId;

    const order = await Order.findOne({ _id: orderId, vendorId })
      .populate("userId", "email"); // ✅ IMPORTANT FIX

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or unauthorized",
      });
    }

    if (order.status !== "shipped") {
      return res.status(400).json({
        success: false,
        message: "Order must be shipped before it can be delivered",
      });
    }

    order.status = "delivered";
    order.statusHistory.push({ status: "delivered" });

    await order.save();

    // ✅ FIX EMAIL
    const email = order.userId?.email;

    if (email) {
      await sendOrderUpdateEmail(email, "delivered");
    } else {
      console.error("Missing user email for order:", order._id);
    }

    res.json({
      success: true,
      message: "Order marked as delivered successfully",
      order,
    });
  } catch (err) {
    console.error("Error delivering order:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.initiateReturn = async (req, res) => {
  try {
    const userId = req.user.id;
    const orderId = req.params.orderId;

    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or unauthorized" });
    }

    if (order.status !== "delivered") {
      return res.status(400).json({
        success: false,
        message: 'Order must be delivered before it can be returned',
      });
    }

    // Step 1: Mark as returned when the customer initiates the return
    order.status = "returned";  // Change order status to returned
    order.statusHistory.push({ status: "returned" });  // Add returned to status history

    await order.save();  // Save the order after marking it as returned

    res.json({
      success: true,
      message: 'Return initiated successfully',
      order,
    });
  } catch (err) {
    console.error("Error initiating return:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};



exports.acceptReturn = async (req, res) => {
  try {
    const vendorId = req.user._id;
    const orderId = req.params.orderId;

    const order = await Order.findOne({ _id: orderId, vendorId }).populate('businessId');
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or unauthorized" });
    }

    if (order.status !== "returned") {
      return res.status(400).json({
        success: false,
        message: 'Order must be marked as returned before it can be accepted',
      });
    }

    // Step 1: Mark the order as 'refunded'
    order.status = "refunded";  // Change order status to refunded
    order.statusHistory.push({ status: "refunded" });  // Add refunded to status history

    // Step 2: Process the refund if the order is paid
    if (order.paymentStatus === "paid" && order.paymentId) {
      const vendorStripeAccountId = order.businessId.stripeConnectAccountId;  // Vendor's Stripe Account ID

      try {
        // Refund the payment through Stripe Connect (vendor's account)
        const refund = await stripe.refunds.create({
          payment_intent: order.paymentId,
          amount: Math.round(order.totalAmount * 100), // Convert to cents
          reason: "requested_by_customer",
          reverse_transfer: true,
          refund_application_fee: true,
          metadata: {
            custom_reason: "return_accepted",
          },
        });

        // Step 3: After successful refund, update order status to 'refunded'
        order.paymentStatus = "refunded";  // Update payment status to refunded
        console.log("Refund initiated for order", {
          orderId,
          paymentIntentId: order.paymentId,
        });
      } catch (err) {
        console.error("Error processing refund via Stripe Connect:", err);
        return res.status(500).json({ success: false, message: "Refund failed" });
      }
    }

    await order.save();  // Save the updated order

    res.json({
      success: true,
      message: 'Return accepted and refund processed (if paid)',
      order,
    });
  } catch (err) {
    console.error("Error accepting return:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


exports.getAllOrdersAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;
    const match = buildAdminOrderMatch(req.query);

    const [rows, total, paymentAgg, statusAgg] = await Promise.all([
      Order.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "name email")
        .populate("vendorId", "name email")
        .populate("businessId", "businessName slug")
        .lean(),
      Order.countDocuments(match),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      message: "Orders fetched successfully",
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        payment: summarizeBuckets(ADMIN_PAYMENT_BUCKETS, paymentAgg),
        status: summarizeBuckets(ADMIN_STATUS_BUCKETS, statusAgg),
      },
    });
  } catch (err) {
    console.error("getAllOrdersAdmin error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

exports.getAdminSalesSummary = async (req, res) => {
  try {
    const match = buildAdminOrderMatch(req.query);
    const paidVendorMatch =
      match.paymentStatus && match.paymentStatus !== "paid"
        ? null
        : { ...match, paymentStatus: "paid" };
    const vendorSalesPipeline = paidVendorMatch
      ? [
          { $match: paidVendorMatch },
          {
            $group: {
              _id: {
                vendorId: "$vendorId",
                currency: currencyExpression,
              },
              orderCount: { $sum: 1 },
              totalSalesAmount: { $sum: amountExpression("$totalAmount") },
            },
          },
          {
            $project: {
              _id: 0,
              vendorId: "$_id.vendorId",
              currency: "$_id.currency",
              orderCount: 1,
              totalSalesAmount: 1,
            },
          },
          { $sort: { totalSalesAmount: -1 } },
          { $limit: 10 },
        ]
      : null;

    const [salesByCurrency, vendorSales, paymentAgg, statusAgg] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: currencyExpression,
            totalOrders: { $sum: 1 },
            grossSalesAmount: { $sum: amountExpression("$totalAmount") },
            paidSalesAmount: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "paid"] },
                  amountExpression("$totalAmount"),
                  0,
                ],
              },
            },
            refundedSalesAmount: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "refunded"] },
                  amountExpression("$totalAmount"),
                  0,
                ],
              },
            },
            subtotalAmount: { $sum: amountExpression("$subtotalAmount") },
            taxAmount: { $sum: amountExpression("$taxSummary.taxTotal") },
            shippingAmount: { $sum: amountExpression("$shipping.amount") },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      vendorSalesPipeline
        ? Order.aggregate(vendorSalesPipeline)
        : Promise.resolve([]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      message: "Admin sales summary fetched successfully",
      data: {
        salesByCurrency: salesByCurrency.map(toCurrencySummary),
        topVendors: vendorSales.map(toVendorSalesSummary),
        platformRevenue: {
          supported: false,
          amount: null,
          reason: "Order records do not persist platform fee amounts yet.",
        },
        summary: {
          payment: summarizeBuckets(ADMIN_PAYMENT_BUCKETS, paymentAgg),
          status: summarizeBuckets(ADMIN_STATUS_BUCKETS, statusAgg),
        },
      },
    });
  } catch (err) {
    console.error("getAdminSalesSummary error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};



exports.cancelOrderByUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    // Load the order for this user
    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found or unauthorized" });
    }

    // Only orders in 'ordered' or 'accepted' may be canceled by the user
    if (!(order.status === "ordered" || order.status === "accepted")) {
      return res.status(400).json({
        success: false,
        message: 'Only "ordered" or "accepted" orders can be cancelled by the user',
      });
    }
    if (order.paymentStatus === "refunded") {
      return res.status(400).json({
        success: false,
        message: 'all ready refunded',
      });
    }

    // If status is 'accepted', we previously decremented stock. Restore it.
    if (order.status === "accepted") {
      for (const item of order.items) {
        const variant = await ProductVariant.findById(item.variantId);
        if (!variant) continue;

        const selectedVariant = resolveVariantSelection(variant, item.size);
        if (selectedVariant) {
          selectedVariant.stockSource.stock =
            Number(selectedVariant.stockSource.stock || 0) +
            Number(item.quantity || 0);
        }
        await variant.save();
      }
    }

    // If payment captured, refund the whole order
    // (Assumes single PaymentIntent for the order. Adjust for partial refunds if needed.)
    if (order.paymentStatus === "paid" && order.paymentId) {
      try {
        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

        const refund = await stripe.refunds.create({
          payment_intent: order.paymentId,
          // amount: Math.round(order.totalAmount * 100), // optional; omit for full refund
          reason: "requested_by_customer",
          reverse_transfer: true,
          refund_application_fee: true,
          metadata: {
            custom_reason: "order_cancelled_by_user",
            order_id: String(order._id),
          },
        });

        order.paymentStatus = "refunded";
      } catch (err) {
        console.error("Stripe refund failed:", err);
        return res.status(502).json({
          success: false,
          message: "Failed to process refund. Please try again or contact support.",
        });
      }
    } else {
      // Not paid yet (e.g., pending) – ensure we reflect that:
      order.paymentStatus = order.paymentStatus || "pending";
    }

    order.status = "cancelled";
    order.statusHistory.push({ status: "cancelled" });
    await order.save();

    return res.json({
      success: true,
      message: "Order cancelled successfully",
      order,
    });
  } catch (err) {
    console.error("Error cancelling order:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};








// exports.shipOrder = async (req, res) => {
//   try {
//     const vendorId = req.user.id;
//     const orderId = req.params.orderId;
//     const { trackingId, trackingUrl, vendorNote } = req.body;

//     if (!trackingId || !trackingUrl) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Tracking ID and URL are required" });
//     }

//     const order = await Order.findOne({ _id: orderId, vendorId });

//     if (!order) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Order not found or unauthorized" });
//     }

//     if (order.status !== "accepted") {
//       return res.status(400).json({
//         success: false,
//         message: "Only accepted orders can be shipped",
//       });
//     }

//     order.trackingInfo = { trackingId, trackingUrl };
//     if (vendorNote) order.vendorNote = vendorNote;

//     order.status = "shipped";
//     order.statusHistory.push({ status: "shipped" });

//     await order.save();
//     await sendOrderUpdateEmail(order.customerEmail, "shipped", trackingUrl);  

//     res.json({
//       success: true,
//       message: "Order marked as shipped",
//       order,
//     });
//   } catch (err) {
//     console.error("Error in shipOrder:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };


// exports.deliverOrder = async (req, res) => {
//   try {
//     const vendorId = req.user.id;
//     const orderId = req.params.orderId;

//     const order = await Order.findOne({ _id: orderId, vendorId });
//     console.log("deliverOrder found order:", order) // Debug log
//     if (!order) {
//       return res.status(404).json({ success: false, message: "Order not found or unauthorized" });
//     }

//     if (order.status !== "shipped") {
//       return res.status(400).json({
//         success: false,
//         message: 'Order must be shipped before it can be delivered',
//       });
//     }

//     // Mark as delivered
//     order.status = "delivered";
//     await sendOrderUpdateEmail(order.customerEmail, "delivered");

//     await order.save();
//     await sendOrderUpdateEmail(order.customerEmail, "delivered");

//     res.json({
//       success: true,
//       message: 'Order marked as delivered successfully',
//       order,
//     });
//   } catch (err) {
//     console.error("Error delivering order:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };


// Customer initiates return

