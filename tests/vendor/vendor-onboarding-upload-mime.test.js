const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const allowlistPath = path.resolve(
  __dirname,
  '../../utils/vendorOnboardingUploadMimeAllowlist.js'
);
const uploadControllerPath = path.resolve(
  __dirname,
  '../../controllers/vendorOnboardingUpload.controller.js'
);
const authenticatePath = path.resolve(__dirname, '../../middlewares/authenticate.js');
const requireVerifiedVendorPath = path.resolve(
  __dirname,
  '../../middlewares/requireVerifiedVendor.js'
);

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function loadUploadController() {
  process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'test-bucket';
  process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-key';
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret';

  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === '@aws-sdk/client-s3') {
      return {
        S3Client: class S3Client {},
        PutObjectCommand: class PutObjectCommand {
          constructor(input) {
            this.input = input;
          }
        },
      };
    }
    if (request === '@aws-sdk/s3-request-presigner') {
      return {
        getSignedUrl: async (_client, command) =>
          `https://signed.example.com/${command.input.Key}`,
      };
    }
    if (request === '../utils/vendorOnboardingUploadMimeAllowlist') {
      return require(allowlistPath);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[uploadControllerPath];
  const loaded = require(uploadControllerPath);
  Module._load = originalLoad;
  return loaded;
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('vendor onboarding MIME allowlist accepts expected safe types', () => {
  const {
    ALLOWED_VENDOR_ONBOARDING_MIME_TYPES,
    isAllowedVendorOnboardingMime,
    normalizeMimeType,
  } = require(allowlistPath);

  assert.deepEqual(ALLOWED_VENDOR_ONBOARDING_MIME_TYPES, ALLOWED);
  assert.equal(isAllowedVendorOnboardingMime('image/jpeg'), true);
  assert.equal(isAllowedVendorOnboardingMime('image/png'), true);
  assert.equal(isAllowedVendorOnboardingMime('image/webp'), true);
  assert.equal(isAllowedVendorOnboardingMime('application/pdf'), true);
  assert.equal(normalizeMimeType(' image/PNG ; charset=binary '), 'image/png');
  assert.equal(isAllowedVendorOnboardingMime('application/javascript'), false);
  assert.equal(isAllowedVendorOnboardingMime('text/html'), false);
  assert.equal(isAllowedVendorOnboardingMime('application/x-msdownload'), false);
});

test('getStage1UploadUrl allows image and PDF MIME types', async () => {
  const { getStage1UploadUrl } = loadUploadController();
  const userId = '507f1f77bcf86cd799439011';

  for (const [fileType, documentType] of [
    ['image/jpeg', 'business-profile'],
    ['image/png', 'feature-banner'],
    ['application/pdf', 'tax-doc'],
  ]) {
    const res = mockResponse();
    await getStage1UploadUrl(
      {
        user: { _id: userId },
        query: {
          fileName: 'proof-file',
          fileType,
          documentType,
        },
      },
      res
    );

    assert.equal(res.statusCode, null, `${fileType} should succeed`);
    assert.equal(res.body.success, true, `${fileType} should succeed`);
    assert.match(res.body.uploadUrl, /^https:\/\/signed\.example\.com\//);
    assert.equal(res.body.documentType, documentType);
  }
});

test('getStage1UploadUrl rejects unsafe MIME types with 400', async () => {
  const { getStage1UploadUrl } = loadUploadController();
  const res = mockResponse();

  await getStage1UploadUrl(
    {
      user: { _id: '507f1f77bcf86cd799439011' },
      query: {
        fileName: 'malware.exe',
        fileType: 'application/x-msdownload',
        documentType: 'tax-doc',
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Invalid file type/);
  assert.match(res.body.message, /image\/jpeg/);
  assert.match(res.body.message, /application\/pdf/);
});

test('vendor onboarding upload route remains blocked without authentication', async () => {
  const authenticate = require(authenticatePath);
  const req = { headers: {}, cookies: {} };
  const res = mockResponse();
  let calledNext = false;

  await authenticate(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Authentication required');
});

test('vendor onboarding upload route blocks non-vendor roles', async () => {
  const requireVerifiedVendor = require(requireVerifiedVendorPath);
  const req = { user: { role: 'customer', isOtpVerified: true } };
  const res = mockResponse();
  let calledNext = false;

  await requireVerifiedVendor(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, 'Only vendors allowed');
});
