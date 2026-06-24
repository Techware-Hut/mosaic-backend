const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const cookieHelperPath = path.resolve(__dirname, '../../utils/cookieHelper.js');

function loadCookieHelper(envOverrides = {}) {
  const saved = {};
  for (const key of [
    'NODE_ENV',
    'COOKIE_SECURE',
    'COOKIE_SAMESITE',
    'COOKIE_DOMAIN',
    'API_BASE_URL',
  ]) {
    saved[key] = process.env[key];
    if (Object.prototype.hasOwnProperty.call(envOverrides, key)) {
      if (envOverrides[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envOverrides[key];
      }
    }
  }

  delete require.cache[cookieHelperPath];
  const helper = require(cookieHelperPath);

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return helper;
}

test('getCookieOptions uses production defaults when NODE_ENV=production', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_SECURE: undefined,
    COOKIE_SAMESITE: undefined,
    COOKIE_DOMAIN: undefined,
  });

  const options = getCookieOptions(3600000);

  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'none');
  assert.equal(options.domain, '.mosaicbizhub.com');
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 3600000);
});

test('getCookieOptions honors explicit production env overrides', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'none',
    COOKIE_DOMAIN: '.mosaicbizhub.com',
  });

  const options = getCookieOptions(86400000);

  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'none');
  assert.equal(options.domain, '.mosaicbizhub.com');
});

test('getCookieOptions omits domain when COOKIE_DOMAIN is empty string', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_DOMAIN: '   ',
  });

  const options = getCookieOptions(1000);

  assert.equal('domain' in options, false);
});

test('getCookieOptions normalizes COOKIE_SAMESITE casing', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_SAMESITE: 'None',
  });

  const options = getCookieOptions(1000);

  assert.equal(options.sameSite, 'none');
});

test('getCookieOptions allows non-httpOnly override for user_session cookie', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'development',
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    COOKIE_DOMAIN: undefined,
  });

  const options = getCookieOptions(1000, { httpOnly: false });

  assert.equal(options.httpOnly, false);
  assert.equal(options.secure, false);
  assert.equal(options.sameSite, 'lax');
  assert.equal('domain' in options, false);
});

test('getCookieOptions falls back when COOKIE_DOMAIN is invalid for API host', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_DOMAIN: 'app.mosaicbizhub.com',
    API_BASE_URL: 'https://api.mosaicbizhub.com',
  });

  const options = getCookieOptions(1000);

  assert.equal(options.domain, '.mosaicbizhub.com');
});

test('getCookieOptions omits domain when invalid COOKIE_DOMAIN in non-production', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'development',
    COOKIE_DOMAIN: 'app.mosaicbizhub.com',
    API_BASE_URL: 'https://api.mosaicbizhub.com',
  });

  const options = getCookieOptions(1000);

  assert.equal('domain' in options, false);
});

test('getCookieOptions accepts parent domain for API host', () => {
  const { getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_DOMAIN: '.mosaicbizhub.com',
    API_BASE_URL: 'https://api.mosaicbizhub.com',
  });

  const options = getCookieOptions(1000);

  assert.equal(options.domain, '.mosaicbizhub.com');
});

test('clearCookie sets expires and maxAge zero for logout compatibility', () => {
  const { clearCookie, getCookieOptions } = loadCookieHelper({
    NODE_ENV: 'production',
    COOKIE_DOMAIN: '.mosaicbizhub.com',
  });

  const cleared = [];
  const res = {
    clearCookie(name, options) {
      cleared.push({ name, options });
    },
  };

  clearCookie(res, 'token');
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].name, 'token');
  assert.equal(cleared[0].options.maxAge, 0);
  assert.ok(cleared[0].options.expires instanceof Date);
  assert.equal(cleared[0].options.domain, getCookieOptions(1000).domain);
});
