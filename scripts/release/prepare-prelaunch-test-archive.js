#!/usr/bin/env node
'use strict';

const CONFIRMATION = 'PREPARE_PRELAUNCH_TEST_ARCHIVE';

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

async function inspectStorage({ mongoose, PrelaunchTestOrderArchive, reset }) {
  const exists = await reset.archiveCollectionExists({ mongoose, PrelaunchTestOrderArchive });
  if (!exists) return { exists: false, ready: false };
  try {
    reset.assertArchiveIndexes(await PrelaunchTestOrderArchive.collection.indexes());
    return { exists: true, ready: true };
  } catch (error) {
    if (error?.safeCode === 'ARCHIVE_STORAGE_NOT_PREPARED') {
      return { exists: true, ready: false };
    }
    throw error;
  }
}

async function prepareStorage({ mongoose, PrelaunchTestOrderArchive, reset, confirmed }) {
  const collection = reset.archiveCollectionName(PrelaunchTestOrderArchive);
  const before = await inspectStorage({ mongoose, PrelaunchTestOrderArchive, reset });
  if (!confirmed) return { mode: 'dry-run', collection, ...before };
  if (!before.exists) await mongoose.connection.db.createCollection(collection);
  const existing = await PrelaunchTestOrderArchive.collection.indexes();
  for (const index of existing) {
    if (index.name === '_id_') continue;
    const allowed = reset.REQUIRED_ARCHIVE_INDEXES.some((required) =>
      index.name === required.name && index.key && index.key[required.field] === 1
        && Object.keys(index.key).length === 1 && index.unique === true);
    if (!allowed) blocked('ARCHIVE_STORAGE_NOT_PREPARED');
  }
  for (const required of reset.REQUIRED_ARCHIVE_INDEXES) {
    const exists = existing.some((index) => index.name === required.name
      && index.key && index.key[required.field] === 1
      && Object.keys(index.key).length === 1 && index.unique === true);
    if (!exists) {
      await PrelaunchTestOrderArchive.collection.createIndex(
        { [required.field]: 1 },
        { unique: true, name: required.name }
      );
    }
  }
  await reset.verifyArchiveStoragePrepared({ mongoose, PrelaunchTestOrderArchive });
  return { mode: 'apply', collection, exists: true, ready: true };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!process.env.MONGODB_URI) blocked('CONNECTION_CONFIG_REQUIRED');
  const mongoose = require('mongoose');
  const reset = require('./reset-prelaunch-test-liabilities');
  const PrelaunchTestOrderArchive = require('../../models/PrelaunchTestOrderArchive');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      autoCreate: false,
      autoIndex: false,
    });
    const result = await prepareStorage({
      mongoose, PrelaunchTestOrderArchive, reset, confirmed: parsed.confirmed,
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
