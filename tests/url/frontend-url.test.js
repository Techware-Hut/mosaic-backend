const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_FRONTEND_URL,
  buildFrontendUrl,
  getFrontendBaseUrl,
  getFrontendLogoUrl,
  normalizeFrontendUrl,
} = require('../../utils/frontendUrl');

test('getFrontendBaseUrl defaults to the production app domain', () => {
  assert.equal(getFrontendBaseUrl({}), DEFAULT_FRONTEND_URL);
});

test('getFrontendBaseUrl uses the first configured frontend origin', () => {
  assert.equal(
    getFrontendBaseUrl({
      FRONTEND_URL: 'https://app.mosaicbizhub.com',
      APP_URL: 'https://mosaicbizhub.com',
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

test('buildFrontendUrl keeps non-legacy preview origins', () => {
  const env = {
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
