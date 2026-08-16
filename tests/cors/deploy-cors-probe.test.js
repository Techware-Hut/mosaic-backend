const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORS_ORIGINS,
} = require('../../scripts/release/verify-production-public-surfaces');

test('production deploy CORS probe matches credentialed browser origins', () => {
  assert.deepEqual(CORS_ORIGINS, [
    'https://mosaicbizhub.com',
    'https://app.mosaicbizhub.com',
    'https://mosaic-biz-frontend-launch.vercel.app',
    'https://mosaic-biz-frontend-launch-digital-builders.vercel.app',
    'https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app',
    'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
  ]);
  assert.equal(CORS_ORIGINS.includes('https://www.mosaicbizhub.com'), false);
});
