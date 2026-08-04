/**
 * Migration: Service.location String → GeoJSON Point
 *
 * Upgrades existing Service documents where location is a plain string
 * (old schema) to the new GeoJSON Point format:
 *   { type: 'Point', coordinates: [lng, lat], address: '...' }
 *
 * Run once after deploying the feature/geolocation branch:
 *   node scripts/migrateServiceLocation.js
 *
 * Safe to re-run — already-migrated docs are skipped automatically.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { geocodeAddress } = require('../utils/geocode');

const SERVICE_COLLECTION = 'services';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅  Connected to MongoDB');

  const db = mongoose.connection.db;
  const collection = db.collection(SERVICE_COLLECTION);

  // Find all services where location is a non-empty string (old format)
  const cursor = collection.find({
    location: { $type: 'string', $ne: '' },
  });

  let total = 0;
  let migrated = 0;
  let failed = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    total++;

    const oldLocation = doc.location;

    if (typeof oldLocation !== 'string' || !oldLocation.trim()) {
      skipped++;
      continue;
    }

    try {
      let geoPoint = {
        type: 'Point',
        coordinates: undefined,
        address: oldLocation.trim(),
      };

      // Try to geocode if API key is available
      if (process.env.GOOGLE_GEOCODING_API_KEY) {
        try {
          const result = await geocodeAddress(oldLocation.trim());
          geoPoint.coordinates = [result.lng, result.lat];
          geoPoint.address = result.formatted_address;
        } catch (geoErr) {
          console.warn(`  ⚠️  Geocoding failed for "${oldLocation}": ${geoErr.message} — saving address only`);
        }
      }

      await collection.updateOne(
        { _id: doc._id },
        { $set: { location: geoPoint } }
      );

      console.log(`  ✓ [${doc._id}] "${oldLocation}" → ${geoPoint.coordinates ? `[${geoPoint.coordinates}]` : 'no coordinates'}`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ [${doc._id}] Failed: ${err.message}`);
      failed++;
    }
  }

  console.log('\n──────────────────────────────');
  console.log(`Total found : ${total}`);
  console.log(`Migrated    : ${migrated}`);
  console.log(`Failed      : ${failed}`);
  console.log(`Skipped     : ${skipped}`);
  console.log('──────────────────────────────');

  await mongoose.disconnect();
  console.log('✅  Done. Disconnected from MongoDB.');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
