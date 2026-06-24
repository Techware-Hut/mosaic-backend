const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_FRONTEND_URL,
  buildFrontendUrl,
  getFrontendBaseUrl,
  getFrontendLogoUrl,
  isAllowedFrontendOrigin,
  normalizeFrontendUrl,
  sanitizeFrontendRedirectUrl,
} = require('../../utils/frontendUrl');

test('getFrontendBaseUrl defaults to the production app domain', () => {
  assert.equal(getFrontendBaseUrl({}), DEFAULT_FRONTEND_URL);
});

test('getFrontendBaseUrl uses the first approved configured frontend origin', () => {
  assert.equal(
    getFrontendBaseUrl({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.mosaicbizhub.com',
      APP_URL: 'https://mosaicbizhub.com',
    }),
    'https://app.mosaicbizhub.com'
  );
});

test('getFrontendBaseUrl ignores the separate community root domain', () => {
  assert.equal(
    getFrontendBaseUrl({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://mosaicbizhub.com',
      APP_URL: 'https://www.mosaicbizhub.com',
    }),
    'https://app.mosaicbizhub.com'
  );
});

test('normalizeFrontendUrl preserves app-host links', () => {
  assert.equal(
    normalizeFrontendUrl('https://app.mosaicbizhub.com/partners/connect/return?businessId=abc'),
    'https://app.mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('normalizeFrontendUrl replaces unapproved origins with the app origin and keeps the path', () => {
  assert.equal(
    normalizeFrontendUrl('https://evil.example/partners/connect/return?businessId=abc', {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.mosaicbizhub.com',
    }),
    'https://app.mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('sanitizeFrontendRedirectUrl rejects unapproved user-supplied redirect origins', () => {
  assert.equal(
    sanitizeFrontendRedirectUrl(
      'https://evil.example/portal',
      {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.mosaicbizhub.com',
      },
      '/partner/507f1f77bcf86cd799439011/my-account'
    ),
    'https://app.mosaicbizhub.com/partner/507f1f77bcf86cd799439011/my-account'
  );
});

test('buildFrontendUrl keeps non-legacy preview origins', () => {
  const env = {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://mosaic-biz-frontend-launch.vercel.app',
  };

  assert.equal(
    buildFrontendUrl('/partners/connect/return', env),
    'https://mosaic-biz-frontend-launch.vercel.app/partners/connect/return'
  );
});

test('getFrontendLogoUrl points at the app frontend asset host', () => {
  assert.equal(
    getFrontendLogoUrl({ FRONTEND_URL: 'https://app.mosaicbizhub.com' }),
    'https://app.mosaicbizhub.com/_next/image?url=%2Flogo.png&w=750&q=75'
  );
});

test('isAllowedFrontendOrigin only approves app, launch Vercel, and dev origins outside production', () => {
  assert.equal(isAllowedFrontendOrigin('https://app.mosaicbizhub.com', { NODE_ENV: 'production' }), true);
  assert.equal(
    isAllowedFrontendOrigin('https://mosaic-biz-frontend-launch.vercel.app', { NODE_ENV: 'production' }),
    true
  );
  assert.equal(isAllowedFrontendOrigin('https://mosaicbizhub.com', { NODE_ENV: 'production' }), false);
  assert.equal(isAllowedFrontendOrigin('https://www.mosaicbizhub.com', { NODE_ENV: 'production' }), false);
  assert.equal(isAllowedFrontendOrigin('http://localhost:3000', { NODE_ENV: 'development' }), true);
  assert.equal(isAllowedFrontendOrigin('http://localhost:3000', { NODE_ENV: 'production' }), false);
});
