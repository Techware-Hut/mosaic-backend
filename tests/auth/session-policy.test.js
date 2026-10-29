const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

const policyPath = path.resolve(__dirname, '../../utils/sessionPolicy.js');
const {
  resolveSessionPolicy,
  jwtSignOptions,
  jwtClaims,
  verifyPolicyToken,
} = require(policyPath);

const KEY = 'stg005-synthetic-policy-key-not-a-hosted-secret';
const OTHER_KEY = 'stg005-synthetic-distinct-production-key';
const USER_ID = '507f1f77bcf86cd799439011';
const activeEnv = (overrides = {}) => ({
  AUTH_SESSION_POLICY: 'staging-v1',
  RELEASE_ENVIRONMENT: 'staging',
  SENTRY_ENVIRONMENT: 'staging',
  API_BASE_URL: 'https://api-staging.mosaicbizhub.com',
  ...overrides,
});

function token(payload = {}, options = {}, key = KEY) {
  return jwt.sign(
    { sub: USER_ID, role: 'business_owner', sessionVersion: 2, token_use: 'session', ...payload },
    key,
    {
      algorithm: 'HS256',
      issuer: 'https://api-staging.mosaicbizhub.com',
      audience: 'mosaic-staging-api',
      expiresIn: '7d',
      ...options,
    }
  );
}

test('missing or explicit legacy policy stays dormant despite staging markers and production NODE_ENV', () => {
  for (const env of [
    {},
    { NODE_ENV: 'production' },
    { RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging' },
    { NODE_ENV: 'production', RELEASE_ENVIRONMENT: 'staging', API_BASE_URL: 'https://api-staging.mosaicbizhub.com' },
    { AUTH_SESSION_POLICY: 'legacy', RELEASE_ENVIRONMENT: 'staging' },
    { AUTH_SESSION_POLICY: 'legacy', RELEASE_ENVIRONMENT: 'production' },
  ]) {
    const policy = resolveSessionPolicy(env);
    assert.equal(policy.mode, 'legacy');
    assert.equal(policy.staging, false);
    assert.equal(policy.cookieNames.token, 'token');
    assert.equal(policy.cookieNames.otpPending, 'otpPending');
    assert.deepEqual(jwtClaims('session', env), {});
    assert.deepEqual(jwtSignOptions('session', env), {});
  }
});

test('only explicit valid staging-v1 policy owns the fixed five-cookie namespace', () => {
  const policy = resolveSessionPolicy(activeEnv());
  assert.equal(policy.mode, 'staging-v1');
  assert.equal(policy.staging, true);
  assert.deepEqual(policy.cookieNames, {
    token: 'mbh_stg_token',
    user_session: 'mbh_stg_user_session',
    user_gender: 'mbh_stg_user_gender',
    otpPending: 'mbh_stg_otp_pending',
    mbh_tmp: 'mbh_stg_tmp',
  });
  for (const env of [
    activeEnv({ SENTRY_ENVIRONMENT: undefined }),
    activeEnv({ RELEASE_ENVIRONMENT: undefined }),
    activeEnv({ NODE_ENV: 'production' }),
    activeEnv({ COOKIE_DOMAIN: '.mosaicbizhub.com', COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none' }),
  ]) {
    assert.equal(resolveSessionPolicy(env).staging, true);
  }
});

test('unknown activation values and missing/conflicting deployment identity fail closed', () => {
  for (const env of [
    { AUTH_SESSION_POLICY: 'true' },
    { AUTH_SESSION_POLICY: 'staging' },
    activeEnv({ RELEASE_ENVIRONMENT: undefined, SENTRY_ENVIRONMENT: undefined }),
    activeEnv({ RELEASE_ENVIRONMENT: 'production' }),
    activeEnv({ SENTRY_ENVIRONMENT: 'production' }),
    activeEnv({ RELEASE_ENVIRONMENT: 'preview', SENTRY_ENVIRONMENT: undefined }),
  ]) {
    assert.throws(() => resolveSessionPolicy(env));
  }
});

test('active policy rejects non-staging, malformed and credential-bearing API destinations', () => {
  for (const api of [
    undefined,
    '',
    'https://api.mosaicbizhub.com',
    'http://api-staging.mosaicbizhub.com',
    'https://api-staging.mosaicbizhub.com.attacker.example',
    'https://api-staging.mosaicbizhub.com:444',
    'https://operator@api-staging.mosaicbizhub.com',
    'https://api-staging.mosaicbizhub.com/api',
    'https://api-staging.mosaicbizhub.com/?environment=staging',
    'https://api-staging.mosaicbizhub.com/#staging',
    '//api-staging.mosaicbizhub.com',
  ]) {
    assert.throws(() => resolveSessionPolicy(activeEnv({ API_BASE_URL: api })));
  }
});

test('active policy refuses incompatible cookie attributes and unowned temp-cookie names', () => {
  for (const overrides of [
    { COOKIE_DOMAIN: '' },
    { COOKIE_DOMAIN: 'app.mosaicbizhub.com' },
    { COOKIE_DOMAIN: 'attacker.example' },
    { COOKIE_SECURE: 'false' },
    { COOKIE_SAMESITE: 'lax' },
    { COOKIE_SAMESITE: 'strict' },
    { TEMP_COOKIE_NAME: 'token' },
    { TEMP_COOKIE_NAME: 'arbitrary_tmp' },
  ]) {
    assert.throws(() => resolveSessionPolicy(activeEnv(overrides)));
  }
});

test('policy resolution does not cache active configuration or mutate its input', () => {
  const env = activeEnv();
  const before = { ...env };
  resolveSessionPolicy(env);
  assert.deepEqual(env, before);
  assert.equal(resolveSessionPolicy({}).mode, 'legacy');
  assert.equal(resolveSessionPolicy(activeEnv()).mode, 'staging-v1');
  assert.equal(resolveSessionPolicy({ AUTH_SESSION_POLICY: 'legacy' }).cookieNames.token, 'token');
});

test('real JWT session signing options and claims implement the fixed staging contract', () => {
  const env = activeEnv();
  assert.deepEqual(jwtClaims('session', env), { token_use: 'session' });
  assert.deepEqual(jwtSignOptions('session', env), {
    algorithm: 'HS256',
    issuer: 'https://api-staging.mosaicbizhub.com',
    audience: 'mosaic-staging-api',
  });
  const signed = jwt.sign(
    { sub: USER_ID, sessionVersion: 2, ...jwtClaims('session', env) },
    KEY,
    { ...jwtSignOptions('session', env), expiresIn: '7d' }
  );
  const verified = verifyPolicyToken(signed, KEY, 'session', env);
  assert.equal(verified.sub, USER_ID);
  assert.equal(verified.sessionVersion, 2);
  assert.equal(verified.token_use, 'session');
  assert.equal(verified.exp - verified.iat, 7 * 24 * 60 * 60);
});

test('real JWT temporary profile tokens have a distinct audience and purpose', () => {
  const env = activeEnv();
  assert.deepEqual(jwtClaims('profile_completion', env), { token_use: 'profile_completion' });
  assert.deepEqual(jwtSignOptions('profile_completion', env), {
    algorithm: 'HS256',
    issuer: 'https://api-staging.mosaicbizhub.com',
    audience: 'mosaic-staging-profile',
  });
  const signed = jwt.sign(
    { sub: USER_ID, ...jwtClaims('profile_completion', env) },
    KEY,
    { ...jwtSignOptions('profile_completion', env), expiresIn: 900 }
  );
  const verified = verifyPolicyToken(signed, KEY, 'profile_completion', env);
  assert.equal(verified.token_use, 'profile_completion');
  assert.equal(verified.exp - verified.iat, 900);
  assert.throws(() => verifyPolicyToken(signed, KEY, 'session', env));
  assert.throws(() => verifyPolicyToken(token(), KEY, 'profile_completion', env));
});

const rejectedTokens = [
  ['wrong signing key', () => token({}, {}, OTHER_KEY)],
  ['wrong issuer', () => token({}, { issuer: 'https://api.mosaicbizhub.com' })],
  ['wrong audience', () => token({}, { audience: 'mosaic-production-api' })],
  ['ambiguous audience array', () => token({}, { audience: ['mosaic-staging-api', 'another-application'] })],
  ['wrong purpose', () => token({ token_use: 'profile_completion' })],
  ['unsupported HMAC algorithm', () => token({}, { algorithm: 'HS384' })],
  ['unsigned token', () => jwt.sign(
    { sub: USER_ID, sessionVersion: 2, token_use: 'session' },
    null,
    { algorithm: 'none', issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api', expiresIn: '7d' }
  )],
  ['expired token', () => token({}, { expiresIn: -1 })],
  ['not-yet-valid token', () => token({}, { notBefore: 3600 })],
  ['missing subject', () => token({ sub: undefined })],
  ['empty subject', () => token({ sub: '' })],
  ['missing session version', () => token({ sessionVersion: undefined })],
  ['fractional session version', () => token({ sessionVersion: 1.5 })],
  ['negative session version', () => token({ sessionVersion: -1 })],
  ['missing purpose', () => token({ token_use: undefined })],
  ['missing expiry', () => {
    const payload = { sub: USER_ID, sessionVersion: 2, token_use: 'session' };
    return jwt.sign(payload, KEY, {
      algorithm: 'HS256', issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api',
    });
  }],
  ['unscoped legacy token', () => jwt.sign({ sub: USER_ID, sessionVersion: 2 }, KEY, { expiresIn: '7d' })],
  ['malformed token', () => 'not-a-jwt'],
];

for (const [description, makeToken] of rejectedTokens) {
  test(`active JWT verification rejects ${description}`, () => {
    assert.throws(() => verifyPolicyToken(makeToken(), KEY, 'session', activeEnv()));
  });
}

test('dormant verification preserves historical unscoped JWT compatibility', () => {
  const legacy = jwt.sign({ userId: USER_ID, role: 'customer' }, KEY, { expiresIn: '7d' });
  assert.equal(verifyPolicyToken(legacy, KEY, 'session', {}).userId, USER_ID);
  assert.throws(() => verifyPolicyToken(legacy, OTHER_KEY, 'session', {}));
});

test('synthetic distinct production key rejects staging JWT without claiming deployed-key separation', () => {
  assert.throws(() => jwt.verify(token(), OTHER_KEY));
});

test('policy import is inert even with invalid explicit configuration and no signing key', () => {
  const saved = {};
  for (const name of ['AUTH_SESSION_POLICY', 'JWT_SECRET']) saved[name] = process.env[name];
  const originalLoad = Module._load;
  const originalSetInterval = global.setInterval;
  const transports = [
    [require('node:http'), 'request'],
    [require('node:http'), 'get'],
    [require('node:https'), 'request'],
    [require('node:https'), 'get'],
    [require('node:net'), 'connect'],
    [require('node:tls'), 'connect'],
    [global, 'fetch'],
  ].map(([owner, name]) => ({ owner, name, original: owner[name] }));
  let forbiddenImports = 0;
  let schedulerStarts = 0;
  let transportAttempts = 0;
  try {
    process.env.AUTH_SESSION_POLICY = 'invalid-test-only-policy';
    delete process.env.JWT_SECRET;
    Module._load = function guardedLoad(request, parent, isMain) {
      if (/dotenv|secrets-manager|secretsmanager|client-ssm|jobs\//i.test(request)) {
        forbiddenImports++;
        throw new Error('Unexpected external configuration or scheduler import');
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    global.setInterval = function forbiddenScheduler() {
      schedulerStarts++;
      throw new Error('Unexpected scheduler start');
    };
    for (const { owner, name } of transports) {
      owner[name] = function forbiddenTransport() {
        transportAttempts++;
        throw new Error('Unexpected transport during policy import');
      };
    }
    delete require.cache[policyPath];
    assert.doesNotThrow(() => require(policyPath));
    assert.equal(forbiddenImports, 0);
    assert.equal(schedulerStarts, 0);
    assert.equal(transportAttempts, 0);
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    for (const { owner, name, original } of transports) owner[name] = original;
    delete require.cache[policyPath];
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
