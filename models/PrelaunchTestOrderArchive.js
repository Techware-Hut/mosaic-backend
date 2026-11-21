const crypto = require('crypto');
const mongoose = require('mongoose');

const IMMUTABLE_ERROR = 'PrelaunchTestOrderArchive records are immutable';

// Restricted release record. Do not expose this model through an HTTP route.
const prelaunchTestOrderArchiveSchema = new mongoose.Schema(
  {
    archiveEntryId: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID(),
    },
    sourceOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    priorPaymentId: {
      type: String,
      default: null,
      index: true,
    },
    classification: {
      type: String,
      required: true,
      enum: ['A1', 'B', 'D', 'G'],
      index: true,
    },
    sourceOrder: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    stripeSummary: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    businessReason: {
      type: String,
      required: true,
      enum: ['prelaunch_test_data_retirement'],
    },
    sourceBackendSha: {
      type: String,
      required: true,
      match: /^[0-9a-f]{40}$/i,
    },
    archivedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    autoCreate: false,
    autoIndex: false,
  }
);

const blockMutation = function blockMutation() {
  throw new Error(IMMUTABLE_ERROR);
};

prelaunchTestOrderArchiveSchema.pre('save', function blockExistingSave() {
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
  prelaunchTestOrderArchiveSchema.pre(operation, blockMutation);
}

prelaunchTestOrderArchiveSchema.pre('bulkWrite', blockMutation);
prelaunchTestOrderArchiveSchema.pre('deleteOne', { document: true, query: false }, blockMutation);

module.exports = mongoose.model('PrelaunchTestOrderArchive', prelaunchTestOrderArchiveSchema);
module.exports.IMMUTABLE_ERROR = IMMUTABLE_ERROR;
