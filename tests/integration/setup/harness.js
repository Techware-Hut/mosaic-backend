const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  installProviderStubs,
  resetStripeStub,
  resetOtpEmailFailCount,
} = require('../helpers/providerStubs');
const { resetOtpCapture } = require('../helpers/otpCapture');

let mongoServer = null;
let app = null;
let started = false;

function applyIntegrationEnv(mongoUri) {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongoUri;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'integration-test-jwt-secret-min-32-chars';
  process.env.GOOGLE_CLIENT_ID =
    process.env.GOOGLE_CLIENT_ID || 'integration-test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET || 'integration-test-google-client-secret';
  process.env.API_BASE_URL =
    process.env.API_BASE_URL || 'http://127.0.0.1:3001';
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || 'sk_test_integration_mock_key_000000000';
  process.env.STRIPE_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_integration_mock';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
  process.env.CORS_ORIGINS =
    process.env.CORS_ORIGINS || 'http://127.0.0.1:3000';
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
  process.env.AWS_SECRET_ACCESS_KEY =
    process.env.AWS_SECRET_ACCESS_KEY || 'test';
  process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
  process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'integration-test-bucket';
  process.env.CLOUDINARY_CLOUD_NAME =
    process.env.CLOUDINARY_CLOUD_NAME || 'integration-test';
  process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test';
  process.env.CLOUDINARY_API_SECRET =
    process.env.CLOUDINARY_API_SECRET || 'test';
  delete process.env.SENTRY_DSN;
  process.env.SENTRY_ENABLED = 'false';
}

async function startHarness() {
  if (started && app) {
    return app;
  }

  installProviderStubs();
  mongoServer = await MongoMemoryServer.create();
  applyIntegrationEnv(mongoServer.getUri());

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  // eslint-disable-next-line global-require
  app = require('../../../app');
  started = true;
  return app;
}

async function resetDatabase() {
  resetOtpCapture();
  resetStripeStub();
  resetOtpEmailFailCount();

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  for (const collection of Object.values(mongoose.connection.collections)) {
    await collection.deleteMany({});
  }
}

async function stopHarness() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
  app = null;
  started = false;
}

function getApp() {
  if (!app) {
    throw new Error('Integration harness not started. Call startHarness() first.');
  }
  return app;
}

module.exports = {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
};
