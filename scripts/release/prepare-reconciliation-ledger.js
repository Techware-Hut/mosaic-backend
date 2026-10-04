#!/usr/bin/env node
'use strict';

const CONFIRMATION = 'PREPARE_RECONCILIATION_LEDGER';

function blocked(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function parseArgs(argv) {
  if (argv.length === 0) return { confirmed: false };
  if (argv.length === 2 && argv[0] === '--confirm' && argv[1] === CONFIRMATION) {
    return { confirmed: true };
  }
  blocked('PREPARE_CONFIRMATION_REQUIRED');
}

async function inspectStorage({ mongoose, ReleaseReconciliationLedger, reconciliation }) {
  const exists = await reconciliation.ledgerCollectionExists({ mongoose, ReleaseReconciliationLedger });
  if (!exists) return { exists: false, ready: false };
  try {
    const indexes = await ReleaseReconciliationLedger.collection.indexes();
    reconciliation.assertLedgerIndexes(indexes);
    return { exists: true, ready: true };
  } catch (error) {
    if (error?.safeCode === 'LEDGER_STORAGE_NOT_PREPARED') {
      return { exists: true, ready: false };
    }
    throw error;
  }
}

async function prepareStorage({ mongoose, ReleaseReconciliationLedger, reconciliation, confirmed }) {
  const collectionName = reconciliation.ledgerCollectionName(ReleaseReconciliationLedger);
  const before = await inspectStorage({ mongoose, ReleaseReconciliationLedger, reconciliation });
  if (!confirmed) return { mode: 'dry-run', collection: collectionName, ...before };
  if (!before.exists) await mongoose.connection.db.createCollection(collectionName);
  const existing = await ReleaseReconciliationLedger.collection.indexes();
  for (const index of existing) {
    if (index.name === '_id_') continue;
    const allowed = reconciliation.REQUIRED_LEDGER_INDEXES.some((required) =>
      index.name === required.name && index.key && index.key[required.field] === 1
        && Object.keys(index.key).length === 1 && index.unique === true);
    if (!allowed) blocked('LEDGER_STORAGE_NOT_PREPARED');
  }
  for (const required of reconciliation.REQUIRED_LEDGER_INDEXES) {
    const exists = existing.some((index) => index.name === required.name
      && index.key && index.key[required.field] === 1
      && Object.keys(index.key).length === 1 && index.unique === true);
    if (!exists) {
      await ReleaseReconciliationLedger.collection.createIndex(
        { [required.field]: 1 },
        { unique: true, name: required.name }
      );
    }
  }
  await reconciliation.verifyLedgerStoragePrepared({ mongoose, ReleaseReconciliationLedger });
  return { mode: 'apply', collection: collectionName, exists: true, ready: true };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!process.env.MONGODB_URI) blocked('CONNECTION_CONFIG_REQUIRED');
  const mongoose = require('mongoose');
  const reconciliation = require('./reconcile-terminal-payment-liabilities');
  const ReleaseReconciliationLedger = require('../../models/ReleaseReconciliationLedger');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      autoCreate: false,
      autoIndex: false,
    });
    const result = await prepareStorage({
      mongoose, ReleaseReconciliationLedger, reconciliation, confirmed: parsed.confirmed,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`BLOCKED: ${error?.safeCode || 'UNEXPECTED_FAILURE'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION,
  parseArgs,
  inspectStorage,
  prepareStorage,
};
