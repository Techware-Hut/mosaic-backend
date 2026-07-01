const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_GENERIC_S3_UPLOAD_MIME_TYPES,
  buildPresignedS3UploadContract,
  isAllowedGenericS3UploadMimeType,
  resolveGenericS3UploadMimeType,
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

test('generic S3 upload filenames are sanitized before key construction', () => {
  assert.equal(sanitizeS3UploadFileName('../bad folder/policy.pdf'), '.._bad_folder_policy.pdf');
  assert.equal(sanitizeS3UploadFileName(''), 'upload');
});
