const test = require('node:test');
const assert = require('node:assert/strict');
const { getReturnAndRefreshUrls } = require('../../lib/connect/connectUrls');

const businessId = '507f1f77bcf86cd799439011';

test('getReturnAndRefreshUrls uses the app frontend host and default Connect paths', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    FRONTEND_URL: 'https://app.mosaicbizhub.com',
  });

  assert.equal(
    urls.returnUrl,
    'https://app.mosaicbizhub.com/partners/connect/return?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://app.mosaicbizhub.com/partners/connect/refresh?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls honors full URL overrides', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    FRONTEND_URL: 'https://app.mosaicbizhub.com',
    CONNECT_RETURN_URL: 'https://mosaic-biz-frontend-launch.vercel.app/partners/connect/return',
    CONNECT_REFRESH_URL: 'https://mosaic-biz-frontend-launch.vercel.app/partners/connect/refresh',
  });

  assert.equal(
    urls.returnUrl,
    'https://mosaic-biz-frontend-launch.vercel.app/partners/connect/return?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaic-biz-frontend-launch.vercel.app/partners/connect/refresh?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls honors custom path env vars', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    FRONTEND_URL: 'https://app.mosaicbizhub.com',
    CONNECT_RETURN_PATH: '/partners/connect/return',
    CONNECT_REFRESH_PATH: '/partners/connect/refresh',
  });

  assert.ok(urls.returnUrl.includes('/partners/connect/return'));
  assert.ok(urls.refreshUrl.includes('/partners/connect/refresh'));
});
