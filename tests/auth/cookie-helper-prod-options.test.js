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

function withSessionCookieEnv(overrides, fn) {
  const values = {
    NODE_ENV: 'production',
    AUTH_SESSION_POLICY: 'staging-v1',
    RELEASE_ENVIRONMENT: 'staging',
    SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com',
    COOKIE_DOMAIN: '.mosaicbizhub.com',
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'none',
    TEMP_COOKIE_NAME: undefined,
    ...overrides,
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[cookieHelperPath];
    return fn(require(cookieHelperPath));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[cookieHelperPath];
  }
}

test('STG-005 staging markers and production runtime do not activate cookie names by default', () => {
  for (const selector of [undefined, 'legacy']) {
    withSessionCookieEnv({ AUTH_SESSION_POLICY: selector }, (helper) => {
      const issued = [];
      const cleared = [];
      const res = {
        cookie: (name, value, options) => issued.push({ name, value, options }),
        clearCookie: (name, options) => cleared.push({ name, options }),
      };
      helper.setAuthCookies(res, 'synthetic-session', { gender: 'other' }, 604800000);
      helper.clearAuthCookies(res);
      assert.deepEqual(issued.map((cookie) => cookie.name), ['token', 'user_session', 'user_gender']);
      assert.deepEqual(cleared.map((cookie) => cookie.name), ['token', 'user_session', 'user_gender']);
      assert.equal(issued[0].options.domain, '.mosaicbizhub.com');
      assert.equal(issued[0].options.secure, true);
      assert.equal(issued[0].options.sameSite, 'none');
      assert.equal(issued[0].options.path, '/');
      assert.equal(issued[0].options.maxAge, 604800000);
    });
  }
});

test('STG-005 opt-in cookie issuance and clearing own only the five staging names', () => {
  withSessionCookieEnv({}, (helper) => {
    const issued = [];
    const cleared = [];
    const res = {
      cookie: (name, value, options) => issued.push({ name, value, options }),
      clearCookie: (name, options) => cleared.push({ name, options }),
    };
    helper.setAuthCookies(res, 'synthetic-session', { gender: 'other' }, 604800000);
    helper.setCookie(res, 'otpPending', 'true', { maxAge: 600000 });
    helper.setCookie(res, 'mbh_tmp', 'synthetic-temp', { maxAge: 900000 });
    helper.clearAuthCookies(res);
    helper.clearCookie(res, 'otpPending');
    helper.clearCookie(res, 'mbh_tmp');
    const names = ['mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender', 'mbh_stg_otp_pending', 'mbh_stg_tmp'];
    assert.deepEqual(issued.map((cookie) => cookie.name), names);
    assert.deepEqual(cleared.map((cookie) => cookie.name), names);
    assert.deepEqual(issued.map((cookie) => cookie.options.httpOnly), [true, false, false, true, true]);
    assert.deepEqual(issued.map((cookie) => cookie.options.maxAge), [604800000, 604800000, 604800000, 600000, 900000]);
    for (let i = 0; i < names.length; i += 1) {
      assert.equal(issued[i].options.domain.replace(/^\./, ''), 'mosaicbizhub.com');
      assert.equal(issued[i].options.secure, true);
      assert.equal(issued[i].options.sameSite, 'none');
      assert.equal(issued[i].options.path, '/');
      assert.equal(cleared[i].options.domain, issued[i].options.domain);
      assert.equal(cleared[i].options.path, issued[i].options.path);
      assert.equal(cleared[i].options.maxAge, 0);
      assert.equal(cleared[i].options.expires.getTime(), 0);
    }
  });
});

test('STG-005 incompatible cookie configuration fails before issuing a cookie', () => {
  for (const overrides of [
    { COOKIE_DOMAIN: 'app.mosaicbizhub.com' },
    { COOKIE_SECURE: 'false' },
    { COOKIE_SAMESITE: 'lax' },
    { TEMP_COOKIE_NAME: 'token' },
  ]) {
    withSessionCookieEnv(overrides, (helper) => {
      let calls = 0;
      assert.throws(() => helper.setAuthCookies({ cookie() { calls += 1; } }, 'synthetic', {}));
      assert.equal(calls, 0);
    });
  }
});
