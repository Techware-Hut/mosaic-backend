const crypto = require('crypto');
const mongoose = require('mongoose');

const IMMUTABLE_ERROR = 'AdminAuditEvent records are immutable';

const adminAuditEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      required: true,
      trim: true,
    },
    actionCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    changeSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    requestId: {
      type: String,
      default: null,
      index: true,
    },
    outcome: {
      type: String,
      required: true,
      enum: ['success', 'failure'],
      index: true,
    },
    note: {
      type: String,
      default: null,
      maxlength: 2000,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

adminAuditEventSchema.index({ createdAt: -1 });

const blockMutation = function blockMutation() {
  throw new Error(IMMUTABLE_ERROR);
};

adminAuditEventSchema.pre('updateOne', blockMutation);
adminAuditEventSchema.pre('updateMany', blockMutation);
adminAuditEventSchema.pre('findOneAndUpdate', blockMutation);
adminAuditEventSchema.pre('replaceOne', blockMutation);
adminAuditEventSchema.pre('deleteOne', blockMutation);
adminAuditEventSchema.pre('deleteMany', blockMutation);
adminAuditEventSchema.pre('findOneAndDelete', blockMutation);

module.exports = mongoose.model('AdminAuditEvent', adminAuditEventSchema);
module.exports.IMMUTABLE_ERROR = IMMUTABLE_ERROR;
