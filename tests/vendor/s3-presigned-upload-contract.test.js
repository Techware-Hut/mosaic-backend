const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES,
  ALLOWED_IMAGE_S3_UPLOAD_MIME_TYPES,
  MAX_IMAGE_S3_UPLOAD_BYTES,
  buildPresignedS3UploadContract,
  isAllowedGenericS3UploadMimeType,
  isAllowedImageS3UploadMimeType,
  parseS3UploadSizeBytes,
  resolveGenericS3UploadMimeType,
  resolveImageS3UploadMimeType,
  sanitizeS3UploadFileName,
} = require('../../utils/s3PresignedUploadContract');

test('presigned S3 upload contract documents the browser PUT requirements', () => {
  assert.deepEqual(buildPresignedS3UploadContract('application/pdf'), {
    method: 'PUT',
    uploadMethod: 'PUT',
    requiredHeaders: {
      'Content-Type': 'application/pdf',
    },
    expiresIn: 300,
  });
});

test('generic S3 upload helper normalizes safe media MIME types', () => {
  assert.deepEqual(ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES, [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
  ]);
  assert.equal(resolveGenericS3UploadMimeType('image/jpg', 'photo.jpg'), 'image/jpeg');
  assert.equal(resolveGenericS3UploadMimeType('', 'clip.MP4'), 'video/mp4');
  assert.equal(resolveGenericS3UploadMimeType('application/octet-stream', 'logo.WEBP'), 'image/webp');
  assert.equal(isAllowedGenericS3UploadMimeType('video/mp4', 'clip.mp4'), true);
  assert.equal(isAllowedGenericS3UploadMimeType('image/svg+xml', 'payload.svg'), false);
  assert.equal(isAllowedGenericS3UploadMimeType('text/html', 'payload.html'), false);
});

test('image S3 upload helper resolves empty browser MIME types from safe extensions', () => {
  assert.deepEqual(ALLOWED_IMAGE_S3_UPLOAD_MIME_TYPES, [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ]);
  assert.equal(resolveImageS3UploadMimeType('', 'cover.WEBP'), 'image/webp');
  assert.equal(resolveImageS3UploadMimeType('application/octet-stream', 'gallery.gif'), 'image/gif');
  assert.equal(resolveImageS3UploadMimeType('image/jpg', 'photo.jpg'), 'image/jpeg');
  assert.equal(isAllowedImageS3UploadMimeType('', 'cover.webp'), true);
  assert.equal(isAllowedImageS3UploadMimeType('video/mp4', 'clip.mp4'), false);
});

test('generic S3 upload filenames are sanitized before key construction', () => {
  assert.equal(sanitizeS3UploadFileName('../bad folder/policy.pdf'), '.._bad_folder_policy.pdf');
  assert.equal(sanitizeS3UploadFileName(''), 'upload');
});

test('image S3 upload helper parses optional file size limits', () => {
  assert.equal(MAX_IMAGE_S3_UPLOAD_BYTES, 5 * 1024 * 1024);
  assert.equal(parseS3UploadSizeBytes(undefined), null);
  assert.equal(parseS3UploadSizeBytes('1024'), 1024);
  assert.equal(Number.isNaN(parseS3UploadSizeBytes('-1')), true);
  assert.equal(Number.isNaN(parseS3UploadSizeBytes('not-a-number')), true);
});

test('listing presign routes require business owner authorization', () => {
  const routeFiles = [
    '../../routes/productRoutes.js',
    '../../routes/serviceRoutes.js',
    '../../routes/foodRoutes.js',
  ].map((routePath) => fs.readFileSync(path.resolve(__dirname, routePath), 'utf8'));

  assert.match(
    routeFiles[0],
    /router\.get\(\s*['"]\/upload-url['"],\s*authenticate,\s*isBusinessOwner,\s*getProductUploadUrl\s*\)/s
  );
  assert.match(
    routeFiles[0],
    /router\.get\(\s*['"]\/variant-upload-url['"],\s*authenticate,\s*isBusinessOwner,\s*getVariantImageUploadUrl\s*\)/s
  );
  assert.match(
    routeFiles[1],
    /router\.get\(\s*['"]\/upload-url['"],\s*authenticate,\s*isBusinessOwner,\s*getServiceUploadUrl\s*\)/s
  );
  assert.match(
    routeFiles[2],
    /router\.get\(['"]\/upload-url['"],\s*authenticate,\s*isBusinessOwner,\s*getFoodUploadUrl\)/s
  );
});
