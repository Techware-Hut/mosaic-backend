const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "ProductVariant",
    },
    color: {
      type: String,
      required: true,
    },
    size: {
      type: String, // ✅ Add size info
      required: true,
    },
    sku: {
      type: String, // ✅ Store SKU at the time of purchase
    },
    quantity: {
      type: Number,
      required: true,
    },
    price: {
      // Price at the time of purchase
      type: Number,
      required: true,
    },
    tax: {
      categoryCode: String,
      categoryLabel: String,
      rate: { type: Number, default: 0 },
      taxIncluded: { type: Boolean, default: true },
      unitPriceExclTax: Number,
      unitPriceInclTax: Number,
      lineBaseAmount: Number,
      lineTaxAmount: Number,
      lineTotalAmount: Number,
    },
    chargeId: { type: String }, // from payment_intent.succeeded (charge.id)
    transferId: { type: String }, // from charge.transfer if using direct/automatic transfers
    applicationFeeId: { type: String }, // if you query application_fee later
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    groupOrderId: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: "Business",
      required: true, // 🔥 REQUIRED to filter vendor orders by business
    },
    items: {
      type: [orderItemSchema],
      required: true,
    },
    totalAmount: {
      type: Number, // stored in smallest currency unit (e.g. paise if INR)
      required: true,
    },
    subtotalAmount: {
      type: Number,
      required: true,
    },
    couponCode: {
      type: String,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    taxSummary: {
      subtotalExclTaxAmount: {
        type: Number,
        default: 0,
      },
      taxTotal: {
        type: Number,
        default: 0,
      },
      taxIncluded: {
        type: Boolean,
        default: true,
      },
    },
    currency: {
      type: String,
      default: "USD",
    },
    status: {
      type: String,
      enum: [
        "created", // ✅ updated from 'ordered'
        "ordered",
        "accepted",
        "rejected",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
        "refunded",
      ],
      default: "created",
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    trackingInfo: {
      trackingId: String,
      trackingUrl: String,
    },
    vendorNote: String,
    userNote: String,
    shippingAddress: {
      fullName: String,
      phone: String,
      addressLine1: String,
      addressLine2: String,
      city: String,
      state: String,
      country: String,
      pincode: String,
    },
    shipping: {
      deliverySpeed: {
        type: String,
        enum: ["standard", "express", "local"],
      },
      method: {
        type: String,
        enum: ["flat_rate", "quantity_based", "free_shipping", "legacy_product_shipping"],
      },
      amount: {
        type: Number,
        default: 0,
      },
      freeShippingApplied: {
        type: Boolean,
        default: false,
      },
      freeShippingThreshold: {
        type: Number,
        default: null,
      },
      quantityTier: {
        minQuantity: Number,
        maxQuantity: Number,
      },
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    paymentId: {
      type: String, // Stripe PaymentIntent ID
      required: false,
    },
    paidConfirmationEmailSentAt: {
      type: Date,
      default: null,
    },
    lifecycleEmailLog: [
      {
        event: String,
        fingerprint: String,
        orderStatus: String,
        paymentStatus: String,
        deliveryStatus: {
          type: String,
          enum: ["sent", "skipped", "failed"],
        },
        recipientRole: String,
        attemptedAt: {
          type: Date,
          default: Date.now,
        },
        error: String,
      },
    ],
    stripeCustomerId: {
      type: String, // Optional: if using Stripe Customer objects
    },
    paymentMethod: {
      type: String,
      enum: ["stripe"],
      default: "stripe",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ userId: 1, vendorId: 1, status: 1 });
orderSchema.index({ groupOrderId: 1 });

module.exports = mongoose.model("Order", orderSchema);
