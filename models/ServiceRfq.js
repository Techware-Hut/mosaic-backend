const mongoose = require('mongoose');

const serviceRfqSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    customerPhone: {
      type: String,
      trim: true,
      default: '',
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    requestedServices: {
      type: [String],
      default: [],
    },
    budget: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'viewed', 'responded', 'closed'],
      default: 'pending',
      index: true,
    },
    source: {
      type: String,
      trim: true,
      default: 'service_rfq',
    },
  },
  {
    timestamps: true,
  }
);

serviceRfqSchema.index({ businessId: 1, createdAt: -1 });
serviceRfqSchema.index({ vendorId: 1, createdAt: -1 });

module.exports =
  mongoose.models.ServiceRfq ||
  mongoose.model('ServiceRfq', serviceRfqSchema);
