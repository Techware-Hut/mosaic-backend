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

test('getFrontendBaseUrl defaults to the apex production marketplace domain', () => {
  assert.equal(getFrontendBaseUrl({}), DEFAULT_FRONTEND_URL);
});

test('getFrontendBaseUrl uses the first approved configured frontend origin', () => {
  assert.equal(
    getFrontendBaseUrl({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://mosaicbizhub.com',
      APP_URL: 'https://app.mosaicbizhub.com',
    }),
    'https://mosaicbizhub.com'
  );
});

test('getFrontendBaseUrl ignores the legacy app subdomain as a configured default', () => {
  assert.equal(
    getFrontendBaseUrl({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.mosaicbizhub.com',
      APP_URL: 'https://app.mosaicbizhub.com',
    }),
    'https://mosaicbizhub.com'
  );
});

test('getFrontendBaseUrl ignores www because it should redirect to apex', () => {
  assert.equal(
    getFrontendBaseUrl({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://www.mosaicbizhub.com',
      APP_URL: 'https://www.mosaicbizhub.com',
    }),
    'https://mosaicbizhub.com'
  );
});

test('buildFrontendUrl falls back to apex when production env still points at legacy app', () => {
  assert.equal(
    buildFrontendUrl('/partners/connect/return?businessId=abc', {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.mosaicbizhub.com',
    }),
    'https://mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('normalizeFrontendUrl preserves apex links', () => {
  assert.equal(
    normalizeFrontendUrl('https://mosaicbizhub.com/partners/connect/return?businessId=abc'),
    'https://mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('normalizeFrontendUrl moves the legacy app subdomain back to apex by default', () => {
  assert.equal(
    normalizeFrontendUrl('https://app.mosaicbizhub.com/partners/connect/return?businessId=abc'),
    'https://mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('normalizeFrontendUrl preserves the legacy app subdomain only when rollback is explicit', () => {
  assert.equal(
    normalizeFrontendUrl('https://app.mosaicbizhub.com/partners/connect/return?businessId=abc', {
      NODE_ENV: 'production',
      ALLOW_LEGACY_FRONTEND_ORIGIN: 'true',
    }),
    'https://app.mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('normalizeFrontendUrl replaces unapproved origins with the apex origin and keeps the path', () => {
  assert.equal(
    normalizeFrontendUrl('https://evil.example/partners/connect/return?businessId=abc', {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://mosaicbizhub.com',
    }),
    'https://mosaicbizhub.com/partners/connect/return?businessId=abc'
  );
});

test('sanitizeFrontendRedirectUrl rejects unapproved user-supplied redirect origins', () => {
  assert.equal(
    sanitizeFrontendRedirectUrl(
      'https://evil.example/portal',
      {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://mosaicbizhub.com',
      },
      '/partner/507f1f77bcf86cd799439011/my-account'
    ),
    'https://mosaicbizhub.com/partner/507f1f77bcf86cd799439011/my-account'
  );
});

test('sanitizeFrontendRedirectUrl rejects legacy app redirects unless rollback is explicit', () => {
  assert.equal(
    sanitizeFrontendRedirectUrl(
      'https://app.mosaicbizhub.com/partners/dashboard?tab=payout-setup',
      {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://mosaicbizhub.com',
      },
      '/partners/dashboard'
    ),
    'https://mosaicbizhub.com/partners/dashboard'
  );

  assert.equal(
    sanitizeFrontendRedirectUrl(
      'https://app.mosaicbizhub.com/partners/dashboard?tab=payout-setup',
      {
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://mosaicbizhub.com',
        ALLOW_LEGACY_FRONTEND_ORIGIN: '1',
      },
      '/partners/dashboard'
    ),
    'https://app.mosaicbizhub.com/partners/dashboard?tab=payout-setup'
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

test('getFrontendLogoUrl points at the static public logo asset', () => {
  assert.equal(
    getFrontendLogoUrl({ FRONTEND_URL: 'https://mosaicbizhub.com' }),
    'https://mosaicbizhub.com/logo.png'
  );
  assert.equal(
    getFrontendLogoUrl({
      FRONTEND_URL: 'https://mosaicbizhub.com',
      MAIL_LOGO_URL: 'https://cdn.example.com/brand.png',
    }),
    'https://cdn.example.com/brand.png'
  );
});

test('isAllowedFrontendOrigin approves fixed origins and explicit rollback without trusting an unconfigured Preview', () => {
  assert.equal(isAllowedFrontendOrigin('https://mosaicbizhub.com', { NODE_ENV: 'production' }), true);
  assert.equal(isAllowedFrontendOrigin('https://app.mosaicbizhub.com', { NODE_ENV: 'production' }), false);
  assert.equal(
    isAllowedFrontendOrigin('https://app.mosaicbizhub.com', {
      NODE_ENV: 'production',
      ALLOW_LEGACY_FRONTEND_ORIGIN: 'true',
    }),
    true
  );
  assert.equal(
    isAllowedFrontendOrigin('https://mosaic-biz-frontend-launch.vercel.app', { NODE_ENV: 'production' }),
    true
  );
  assert.equal(
    isAllowedFrontendOrigin('https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app', { NODE_ENV: 'production' }),
    false
  );
  assert.equal(isAllowedFrontendOrigin('https://www.mosaicbizhub.com', { NODE_ENV: 'production' }), false);
  assert.equal(isAllowedFrontendOrigin('https://api.mosaicbizhub.com', { NODE_ENV: 'production' }), false);
  assert.equal(isAllowedFrontendOrigin('http://localhost:3000', { NODE_ENV: 'development' }), true);
  assert.equal(isAllowedFrontendOrigin('http://localhost:3000', { NODE_ENV: 'production' }), false);
});

test('getFrontendBaseUrl and buildFrontendUrl support candidate Vercel preview origins', () => {
  const env = {
    NODE_ENV: 'production',
    RELEASE_ENVIRONMENT: 'staging',
    FRONTEND_URL: 'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app',
  };

  assert.equal(
    getFrontendBaseUrl(env),
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app'
  );
  assert.equal(
    buildFrontendUrl('/partners/business/payment', env),
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/partners/business/payment'
  );
  assert.equal(
    buildFrontendUrl('/login?type=vendor', env),
    'https://mosaic-biz-frontend-launch-23bhu2726-digital-builders.vercel.app/login?type=vendor'
  );
});

// STG-004: environment containment, using only synthetic configuration.
const APP = 'https://app.mosaicbizhub.com';
const QA = 'https://mosaic-biz-frontend-launch.vercel.app';
const PREVIEW = 'https://mosaic-biz-frontend-launch-controlled-digital-builders.vercel.app';
const stage = (values = {}) => ({ NODE_ENV: 'production', RELEASE_ENVIRONMENT: 'staging', ...values });
const destination = (value, origin, pathname) => {
  const parsed = new URL(value);
  assert.equal(parsed.origin, origin);
  assert.equal(parsed.username, '');
  assert.equal(parsed.password, '');
  if (pathname !== undefined) assert.equal(parsed.pathname, pathname);
  return parsed;
};

for (const marker of [
  { RELEASE_ENVIRONMENT: 'staging' }, { SENTRY_ENVIRONMENT: 'staging' },
  { RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging' },
]) {
  for (const configured of [APP, QA, PREVIEW]) {
    test('STG004 explicit staging origin ' + configured + ' with ' + JSON.stringify(marker), () => {
      const env = { NODE_ENV: 'production', ...marker, FRONTEND_URL: configured };
      assert.equal(getFrontendBaseUrl(env), configured);
      const url = destination(buildFrontendUrl('/partners/connect/return?businessId=synthetic#complete', env), configured, '/partners/connect/return');
      assert.equal(url.searchParams.get('businessId'), 'synthetic');
      assert.equal(url.hash, '#complete');
    });
  }
}

for (const key of ['CANONICAL_FRONTEND_URL', 'PUBLIC_FRONTEND_URL', 'NEXT_PUBLIC_APP_URL', 'FRONTEND_URL', 'APP_URL']) {
  test('STG004 supports staging selection through ' + key, () => {
    assert.equal(getFrontendBaseUrl(stage({ [key]: APP })), APP);
  });
}

test('STG004 preserves valid priority and configured base paths/trailing slashes', () => {
  const env = stage({ CANONICAL_FRONTEND_URL: APP + '/base///?ignored=1#ignored', PUBLIC_FRONTEND_URL: QA, FRONTEND_URL: PREVIEW });
  assert.equal(getFrontendBaseUrl(env), APP + '/base');
  destination(buildFrontendUrl('partners?tab=one#two', env), APP, '/base/partners');
  destination(buildFrontendUrl('/partners?tab=one#two', env), APP, '/partners');
});

for (const value of [undefined, '', '   ', 'not a URL', DEFAULT_FRONTEND_URL, 'https://evil.example', 'https://api-staging.mosaicbizhub.com', APP + ':8443', 'https://user:synthetic-password@app.mosaicbizhub.com', '//app.mosaicbizhub.com', 'https:///app.mosaicbizhub.com']) {
  test('STG004 known staging safe fallback for invalid configuration ' + JSON.stringify(value), () => {
    const env = stage({ CANONICAL_FRONTEND_URL: value, FRONTEND_URL: DEFAULT_FRONTEND_URL });
    assert.equal(getFrontendBaseUrl(env), QA);
    destination(buildFrontendUrl('/login', env), QA, '/login');
    destination(sanitizeFrontendRedirectUrl(DEFAULT_FRONTEND_URL + '/billing', env, '/account'), QA, '/account');
  });
}

for (const markers of [
  { RELEASE_ENVIRONMENT: 'production', SENTRY_ENVIRONMENT: 'staging' },
  { RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'production' },
]) {
  test('STG004 conflicting hosting markers contain to existing staging fallback ' + JSON.stringify(markers), () => {
    const env = { NODE_ENV: 'production', ...markers, FRONTEND_URL: APP };
    assert.equal(getFrontendBaseUrl(env), QA);
  });
}

for (const origin of [APP, QA, PREVIEW]) {
  test('STG004 selected staging origin is the authority, including stale first-party links ' + origin, () => {
    const env = stage({ FRONTEND_URL: origin });
    for (const stale of [DEFAULT_FRONTEND_URL, APP, QA, 'https://mosaic-biz-frontend-launch-unrelated-digital-builders.vercel.app']) {
      const normalized = destination(normalizeFrontendUrl(stale + '/partners?tab=billing#return', env), origin, '/partners');
      assert.equal(normalized.search, '?tab=billing');
      assert.equal(normalized.hash, '#return');
      if (stale !== origin) assert.equal(isAllowedFrontendOrigin(stale, env), false);
      destination(sanitizeFrontendRedirectUrl(stale + '/partners', env, '/safe'), origin, stale === origin ? '/partners' : '/safe');
    }
  });
}

const unsafeInputs = [
  'https://evil.example/steal', 'https://app.mosaicbizhub.com.evil.example/steal',
  'https://api-staging.mosaicbizhub.com/api', 'https://api.mosaicbizhub.com/api',
  'https://user:synthetic-password@app.mosaicbizhub.com/private',
  'https://app.mosaicbizhub.com:8443/private', 'javascript:alert(1)', 'data:text/html,unsafe',
  '//evil.example/steal', '/\\evil.example/steal', 'https:\\evil.example/steal',
  'https://app.mosaicbizhub.com/\nheader', '/%5c%5cevil.example', '/%2f%2fevil.example',
  '/%0d%0aLocation:evil', 'https:///evil.example/steal',
];
for (const input of unsafeInputs) {
  test('STG004 contains unsafe primary AND fallback ' + JSON.stringify(input), () => {
    const env = stage({ FRONTEND_URL: APP });
    destination(normalizeFrontendUrl(input, env), APP);
    destination(sanitizeFrontendRedirectUrl(input, env, input), APP, '/');
  });
}

test('STG004 never grants unconfigured Preview trust just for a hostname pattern', () => {
  assert.equal(isAllowedFrontendOrigin(PREVIEW, { NODE_ENV: 'production' }), false);
  assert.equal(isAllowedFrontendOrigin(PREVIEW, stage({ FRONTEND_URL: QA })), false);
  assert.equal(isAllowedFrontendOrigin(PREVIEW, stage({ FRONTEND_URL: PREVIEW })), true);
});

test('STG004 safely rebases paths beginning with two slashes without reparsing an authority', () => {
  destination(normalizeFrontendUrl('https://evil.example//outside.example/path?x=1#two', stage({ FRONTEND_URL: APP })), APP, '//outside.example/path');
});

test('STG004 preserves nested query values without claiming recursive redirect validation', () => {
  const nested = encodeURIComponent(DEFAULT_FRONTEND_URL + '/after');
  const parsed = destination(buildFrontendUrl('/login?redirect=' + nested + '&businessId=synthetic#resume', stage({ FRONTEND_URL: APP })), APP, '/login');
  assert.equal(parsed.searchParams.get('redirect'), DEFAULT_FRONTEND_URL + '/after');
  assert.equal(parsed.searchParams.get('businessId'), 'synthetic');
  assert.equal(parsed.hash, '#resume');
});

test('STG004 preserves explicit local and production contracts and external mail-logo override', () => {
  assert.equal(getFrontendBaseUrl({ NODE_ENV: 'development', FRONTEND_URL: 'http://localhost:3000/base/' }), 'http://localhost:3000/base');
  assert.equal(getFrontendBaseUrl({ NODE_ENV: 'production', RELEASE_ENVIRONMENT: 'production', FRONTEND_URL: DEFAULT_FRONTEND_URL }), DEFAULT_FRONTEND_URL);
  assert.equal(getFrontendBaseUrl({ NODE_ENV: 'production' }), DEFAULT_FRONTEND_URL);
  assert.equal(getFrontendLogoUrl(stage({ FRONTEND_URL: APP, MAIL_LOGO_URL: 'https://cdn.example.com/logo.png' })), 'https://cdn.example.com/logo.png');
  assert.equal(getFrontendLogoUrl(stage({ FRONTEND_URL: APP })), APP + '/logo.png');
});

test('STG004 no cross-environment cache leakage on sequential calls or module import', () => {
  const saved = {};
  const keys = ['NODE_ENV', 'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'CANONICAL_FRONTEND_URL', 'PUBLIC_FRONTEND_URL', 'NEXT_PUBLIC_APP_URL', 'FRONTEND_URL', 'APP_URL'];
  const helperPath = require.resolve('../../utils/frontendUrl');
  const previous = require.cache[helperPath];
  try {
    keys.forEach(key => { saved[key] = process.env[key]; delete process.env[key]; });
    process.env.RELEASE_ENVIRONMENT = 'staging';
    delete require.cache[helperPath];
    const fresh = require('../../utils/frontendUrl');
    destination(fresh.buildFrontendUrl('/customer/order'), QA);
    process.env.FRONTEND_URL = APP;
    destination(fresh.buildFrontendUrl('/customer/order'), APP);
    delete process.env.RELEASE_ENVIRONMENT;
    process.env.FRONTEND_URL = DEFAULT_FRONTEND_URL;
    destination(fresh.buildFrontendUrl('/customer/order'), DEFAULT_FRONTEND_URL);
  } finally {
    keys.forEach(key => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
    delete require.cache[helperPath];
    if (previous) require.cache[helperPath] = previous;
  }
});

for (const path of ['/%2f%2fevil.example', '/%252f%252fevil.example', '/%25252f%25252fevil.example']) {
  test('STG004 rejects absolute and relative encoded authority-like paths ' + path, () => {
    const env = stage({ FRONTEND_URL: APP });
    for (const value of [path, APP + path]) {
      destination(sanitizeFrontendRedirectUrl(value, env, '/safe'), APP, '/safe');
    }
  });
}
