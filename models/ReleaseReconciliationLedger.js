const crypto = require('crypto');
const mongoose = require('mongoose');

const IMMUTABLE_ERROR = 'ReleaseReconciliationLedger records are immutable';

// Restricted operator/database record. Do not expose this model through an HTTP route.
const releaseReconciliationLedgerSchema = new mongoose.Schema(
  {
    ledgerEntryId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
      validate: {
        validator: (value) => typeof value === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
        message: 'ledgerEntryId must be a UUID',
      },
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    priorPaymentId: {
      type: String,
      required: true,
      unique: true,
    },
    classification: {
      type: String,
      required: true,
      enum: ['A1', 'B'],
    },
    priorPaymentStatus: {
      type: String,
      required: true,
    },
    priorOrderStatus: {
      type: String,
      required: true,
    },
    stripeTerminalStatus: {
      type: String,
      required: true,
      enum: ['succeeded', 'canceled'],
    },
    reason: {
      type: String,
      required: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    outcome: {
      type: String,
      required: true,
      enum: ['success'],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

const blockMutation = function blockMutation() {
  throw new Error(IMMUTABLE_ERROR);
};

releaseReconciliationLedgerSchema.pre('save', function blockExistingSave() {
  if (!this.isNew) blockMutation();
});

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  releaseReconciliationLedgerSchema.pre(operation, blockMutation);
}

releaseReconciliationLedgerSchema.pre('bulkWrite', blockMutation);
releaseReconciliationLedgerSchema.pre('deleteOne', { document: true, query: false }, blockMutation);

module.exports = mongoose.model('ReleaseReconciliationLedger', releaseReconciliationLedgerSchema);
module.exports.IMMUTABLE_ERROR = IMMUTABLE_ERROR;
