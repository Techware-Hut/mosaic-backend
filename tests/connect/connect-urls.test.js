const test = require('node:test');
const assert = require('node:assert/strict');
const { getReturnAndRefreshUrls } = require('../../lib/connect/connectUrls');

const businessId = '507f1f77bcf86cd799439011';

test('getReturnAndRefreshUrls uses the apex frontend host and default Connect paths', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
  });

  assert.equal(
    urls.returnUrl,
    'https://mosaicbizhub.com/partners/connect/return?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaicbizhub.com/partners/connect/refresh?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls ignores legacy app FRONTEND_URL for generated defaults', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://app.mosaicbizhub.com',
  });

  assert.equal(
    urls.returnUrl,
    'https://mosaicbizhub.com/partners/connect/return?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaicbizhub.com/partners/connect/refresh?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls honors full URL overrides', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
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
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
    CONNECT_RETURN_PATH: '/partners/connect/return',
    CONNECT_REFRESH_PATH: '/partners/connect/refresh',
  });

  assert.ok(urls.returnUrl.includes('/partners/connect/return'));
  assert.ok(urls.refreshUrl.includes('/partners/connect/refresh'));
});

test('getReturnAndRefreshUrls moves unsafe full URL overrides back to the apex host', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
    CONNECT_RETURN_URL: 'https://www.mosaicbizhub.com/partners/connect/return',
    CONNECT_REFRESH_URL: 'https://evil.example/partners/connect/refresh',
  });

  assert.equal(
    urls.returnUrl,
    'https://mosaicbizhub.com/partners/connect/return?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaicbizhub.com/partners/connect/refresh?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls moves legacy app full URL overrides back to apex by default', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
    CONNECT_RETURN_URL: 'https://app.mosaicbizhub.com/partners/connect/return',
    CONNECT_REFRESH_URL: 'https://app.mosaicbizhub.com/partners/connect/refresh',
  });

  assert.equal(
    urls.returnUrl,
    'https://mosaicbizhub.com/partners/connect/return?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaicbizhub.com/partners/connect/refresh?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls preserves legacy app overrides only for explicit rollback', () => {
  const urls = getReturnAndRefreshUrls(businessId, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaicbizhub.com',
    CONNECT_RETURN_URL: 'https://app.mosaicbizhub.com/partners/connect/return',
    CONNECT_REFRESH_URL: 'https://app.mosaicbizhub.com/partners/connect/refresh',
    ALLOW_LEGACY_FRONTEND_ORIGIN: 'true',
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

test('getReturnAndRefreshUrls routes to candidate preview frontend and redirects away from stale apex in staging', () => {
  const stagingEnv = {
    NODE_ENV: 'production',
    RELEASE_ENVIRONMENT: 'staging',
    FRONTEND_URL: 'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app',
    CONNECT_RETURN_URL: 'https://mosaicbizhub.com/partners/payout-setup',
    CONNECT_REFRESH_URL: 'https://mosaicbizhub.com/partners/payout-setup',
  };

  const urls = getReturnAndRefreshUrls(businessId, stagingEnv);

  assert.equal(
    urls.returnUrl,
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/payout-setup?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/payout-setup?businessId=507f1f77bcf86cd799439011'
  );
});

test('getReturnAndRefreshUrls routes to preview when CONNECT_RETURN_URL is explicitly preview', () => {
  const stagingEnv = {
    NODE_ENV: 'production',
    RELEASE_ENVIRONMENT: 'staging',
    FRONTEND_URL: 'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app',
    CONNECT_RETURN_URL: 'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/payout-setup',
    CONNECT_REFRESH_URL: 'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/payout-setup',
  };

  const urls = getReturnAndRefreshUrls(businessId, stagingEnv);

  assert.equal(
    urls.returnUrl,
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/payout-setup?businessId=507f1f77bcf86cd799439011'
  );
  assert.equal(
    urls.refreshUrl,
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/payout-setup?businessId=507f1f77bcf86cd799439011'
  );
});
