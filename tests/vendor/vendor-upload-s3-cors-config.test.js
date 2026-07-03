const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildS3UploadCorsConfiguration,
  getS3UploadCorsOrigins,
  isSafeBrowserOrigin,
} = require('../../utils/s3UploadCorsConfig');

test('vendor upload S3 CORS origins include app and local browser origins', () => {
  const origins = getS3UploadCorsOrigins({
    S3_UPLOAD_CORS_ORIGINS:
      'https://preview.example.vercel.app,https://api.mosaicbizhub.com,*',
    FRONTEND_URL: 'https://mosaicbizhub.com',
  });

  assert.ok(origins.includes('https://preview.example.vercel.app'));
  assert.ok(origins.includes('https://mosaicbizhub.com'));
  assert.ok(origins.includes('https://www.mosaicbizhub.com'));
  assert.ok(origins.includes('https://app.mosaicbizhub.com'));
  assert.ok(origins.includes('https://mosaic-biz-frontend-launch.vercel.app'));
  assert.ok(origins.includes('https://mosaic-biz-frontend-launch-digital-builders.vercel.app'));
  assert.ok(origins.includes('https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app'));
  assert.ok(origins.includes('https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app'));
  assert.ok(origins.includes('https://mosaic-biz-frontend-launch-*.vercel.app'));
  assert.ok(origins.includes('http://localhost:3000'));
  assert.ok(origins.includes('http://127.0.0.1:3000'));
  assert.equal(origins.includes('https://api.mosaicbizhub.com'), false);
  assert.equal(origins.includes('*'), false);
});

test('vendor upload S3 CORS rule allows browser presigned uploads', () => {
  const corsConfiguration = buildS3UploadCorsConfiguration({
    S3_UPLOAD_CORS_ORIGINS: 'https://mosaicbizhub.com',
  });
  const [rule] = corsConfiguration.CORSRules;

  assert.equal(rule.ID, 'MosaicVendorPresignedUploads');
  assert.deepEqual(rule.AllowedMethods, ['GET', 'HEAD', 'PUT', 'POST']);
  assert.deepEqual(rule.AllowedHeaders, ['*']);
  assert.deepEqual(rule.ExposeHeaders, ['ETag', 'x-amz-request-id', 'x-amz-id-2']);
  assert.equal(rule.MaxAgeSeconds, 3000);
  assert.equal(rule.AllowedMethods.includes('DELETE'), false);
  assert.equal(rule.AllowedMethods.includes('OPTIONS'), false);
});

test('vendor upload S3 CORS origins are normalized without trailing slashes', () => {
  const origins = getS3UploadCorsOrigins({
    S3_UPLOAD_CORS_ORIGINS:
      'https://mosaicbizhub.com/,https://preview.example.vercel.app/,https://mosaicbizhub.com/path',
  });

  assert.ok(origins.includes('https://mosaicbizhub.com'));
  assert.ok(origins.includes('https://preview.example.vercel.app'));
  assert.equal(origins.includes('https://mosaicbizhub.com/'), false);
  assert.equal(origins.includes('https://preview.example.vercel.app/'), false);
  assert.equal(origins.includes('https://mosaicbizhub.com/path'), false);
});

test('vendor upload S3 CORS origin validation rejects non-browser or wildcard origins', () => {
  assert.equal(isSafeBrowserOrigin('https://*.vercel.app'), true);
  assert.equal(isSafeBrowserOrigin('https://mosaic-biz-frontend-launch-*.vercel.app'), true);
  assert.equal(isSafeBrowserOrigin('https://mosaicbizhub.com'), true);
  assert.equal(isSafeBrowserOrigin('https://mosaicbizhub.com/'), true);
  assert.equal(isSafeBrowserOrigin('http://localhost:3000'), true);
  assert.equal(isSafeBrowserOrigin('*'), false);
  assert.equal(isSafeBrowserOrigin('https://*'), false);
  assert.equal(isSafeBrowserOrigin('https://api.mosaicbizhub.com'), false);
  assert.equal(isSafeBrowserOrigin('https://mosaicbizhub.com/path'), false);
  assert.equal(isSafeBrowserOrigin('not-a-url'), false);
});
