const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

const middlewarePath = path.resolve(__dirname, '../../middlewares/authenticate.js');
const cookieHelperPath = path.resolve(__dirname, '../../utils/cookieHelper.js');
const KEY = 'stg005-synthetic-middleware-key-not-a-hosted-secret';
const OTHER_KEY = 'stg005-synthetic-other-middleware-key';
const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439012';
const COOKIE = 'mbh_stg_token';
const users = {
  [A]: { _id: A, role: 'business_owner', sessionVersion: 2 },
  [B]: { _id: B, role: 'customer', sessionVersion: 2 },
};
const envKeys = [
  'AUTH_SESSION_POLICY', 'RELEASE_ENVIRONMENT', 'SENTRY_ENVIRONMENT', 'API_BASE_URL',
  'COOKIE_DOMAIN', 'COOKIE_SECURE', 'COOKIE_SAMESITE', 'TEMP_COOKIE_NAME', 'NODE_ENV', 'JWT_SECRET',
];

function mint(user = A, payload = {}, options = {}, key = KEY) {
  return jwt.sign(
    { sub: user, role: users[user]?.role || 'customer', sessionVersion: 2, token_use: 'session', ...payload },
    key,
    {
      algorithm: 'HS256', issuer: 'https://api-staging.mosaicbizhub.com',
      audience: 'mosaic-staging-api', expiresIn: '7d', ...options,
    }
  );
}

async function request(options = {}) {
  const saved = Object.fromEntries(envKeys.map((name) => [name, process.env[name]]));
  const originalLoad = Module._load;
  const databaseReads = [];
  const writes = [];
  const req = { headers: {}, cookies: {}, ...options.req };
  const res = {
    statusCode: 200,
    body: undefined,
    cleared: [],
    status(status) { this.statusCode = status; return this; },
    json(body) { this.body = body; return this; },
    clearCookie(name, attributes) { this.cleared.push({ name, attributes }); return this; },
    cookie() { writes.push('set-cookie'); return this; },
  };
  let nextCount = 0;
  try {
    for (const name of envKeys) delete process.env[name];
    Object.assign(process.env, {
      AUTH_SESSION_POLICY: 'staging-v1', RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
      API_BASE_URL: 'https://api-staging.mosaicbizhub.com', NODE_ENV: 'production', JWT_SECRET: KEY,
      ...options.env,
    });
    if (options.legacy) delete process.env.AUTH_SESSION_POLICY;
    Module._load = function loadWithDatabaseStub(specifier, parent, isMain) {
      if (specifier === '../models/User' && parent?.filename === middlewarePath) {
        return {
          findById: async (id) => {
            databaseReads.push(id);
            return (options.users || users)[id] || null;
          },
          create: async () => { writes.push('database'); throw new Error('Unexpected database write'); },
        };
      }
      return originalLoad.call(this, specifier, parent, isMain);
    };
    delete require.cache[middlewarePath];
    delete require.cache[cookieHelperPath];
    const authenticate = require(middlewarePath);
    Module._load = originalLoad;
    await authenticate(req, res, () => { nextCount++; });
    return { req, res, nextCount, databaseReads, writes };
  } finally {
    Module._load = originalLoad;
    delete require.cache[middlewarePath];
    delete require.cache[cookieHelperPath];
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

function assertDenied(result, { reads = 0, destructive = false } = {}) {
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body?.success, false);
  assert.equal(result.nextCount, 0);
  assert.equal(result.databaseReads.length, reads);
  assert.deepEqual(result.writes, []);
  if (!destructive) assert.deepEqual(result.res.cleared, []);
}

test('active cookie-only authentication uses the verified database user', async () => {
  const result = await request({ req: { headers: { cookie: `${COOKIE}=${mint()}` } } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user, users[A]);
  assert.deepEqual(result.databaseReads, [A]);
  assert.deepEqual(result.res.cleared, []);
});

test('active bearer-only API clients remain supported', async () => {
  const result = await request({ req: { headers: { authorization: `Bearer ${mint(B)}` } } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user, users[B]);
  assert.deepEqual(result.databaseReads, [B]);
});

test('parsed selected cookies remain supported when no raw Cookie header exists', async () => {
  const result = await request({ req: { headers: {}, cookies: { [COOKIE]: mint() } } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user, users[A]);
});

test('active cookie plus bearer for the same current identity is accepted once', async () => {
  const result = await request({ req: { headers: {
    cookie: `${COOKIE}=${mint()}`,
    authorization: `Bearer ${mint(A, { iat: Math.floor(Date.now() / 1000) - 1 })}`,
  } } });
  assert.equal(result.nextCount, 1);
  assert.deepEqual(result.databaseReads, [A]);
});

for (const [label, bearer] of [
  ['expired', () => mint(A, {}, { expiresIn: -1 })],
  ['malformed', () => 'malformed-jwt'],
  ['wrong-environment', () => mint(A, {}, { issuer: 'https://api.mosaicbizhub.com' })],
  ['wrong-key', () => mint(A, {}, {}, OTHER_KEY)],
]) {
  test(`active valid cookie plus ${label} bearer rejects without clearing valid cookie`, async () => {
    const result = await request({ req: { headers: { cookie: `${COOKIE}=${mint()}`, authorization: `Bearer ${bearer()}` } } });
    assertDenied(result);
  });
}

test('active valid bearer plus invalid cookie cannot silently fall back', async () => {
  const result = await request({ req: { headers: { cookie: `${COOKIE}=bad-cookie`, authorization: `Bearer ${mint()}` } } });
  assertDenied(result);
});

test('two valid credentials for different users conflict before any database lookup', async () => {
  const result = await request({ req: { headers: { cookie: `${COOKIE}=${mint()}`, authorization: `Bearer ${mint(B)}` } } });
  assertDenied(result);
});

test('same-user credentials carrying different session versions conflict without fallback', async () => {
  const result = await request({ req: { headers: {
    cookie: `${COOKIE}=${mint()}`, authorization: `Bearer ${mint(A, { sessionVersion: 3 })}`,
  } } });
  assertDenied(result);
});

test('missing active credentials and legacy cookie names are not an implicit staging login', async () => {
  assertDenied(await request());
  assertDenied(await request({ req: { headers: { cookie: `token=${mint()}; auth_token=${mint()}` }, cookies: { token: mint() } } }));
});

for (const [label, cookie] of [
  ['same values', () => `${COOKIE}=${mint()}; ${COOKIE}=${mint()}`],
  ['valid then invalid', () => `${COOKIE}=${mint()}; ${COOKIE}=bad`],
  ['invalid then valid', () => `${COOKIE}=bad; ${COOKIE}=${mint()}`],
]) {
  test(`duplicate active Cookie names reject independent of order: ${label}`, async () => {
    assertDenied(await request({ req: { headers: { cookie: cookie() }, cookies: { [COOKIE]: mint() } } }));
  });
}

test('duplicate active Cookie names across raw header lines reject before parser collapse', async () => {
  assertDenied(await request({ req: {
    headers: { cookie: `${COOKIE}=${mint()}` },
    cookies: { [COOKIE]: mint() },
    rawHeaders: ['Cookie', `${COOKIE}=${mint()}`, 'Cookie', `${COOKIE}=bad`],
  } }));
});

test('Cookie header arrays cannot hide a duplicate selected cookie', async () => {
  assertDenied(await request({ req: {
    headers: { cookie: [`${COOKIE}=${mint()}`, `${COOKIE}=bad`] },
    cookies: { [COOKIE]: mint() },
  } }));
});

test('raw cookie identity is authoritative over an already-collapsed cookie object', async () => {
  const result = await request({ req: {
    headers: { cookie: `${COOKIE}=${mint()}` },
    cookies: { [COOKIE]: mint(B) },
  } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user, users[A]);
});

test('selected cookie URL decoding is compatible with cookie-parser', async () => {
  const signed = mint();
  const encoded = signed.replaceAll('.', '%2E');
  const result = await request({ req: { headers: { cookie: `${COOKIE}=${encoded}` } } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user, users[A]);
});

for (const authorization of ['', 'Bearer', 'Bearer ', 'Basic credentials', 'Bearer one two', 'Bearer one, Bearer two']) {
  test(`ambiguous or empty Authorization is rejected before cookie fallback: ${JSON.stringify(authorization)}`, async () => {
    assertDenied(await request({ req: { headers: { authorization, cookie: `${COOKIE}=${mint()}` } } }));
  });
}

test('repeated raw Authorization headers reject even when both contain a valid token', async () => {
  const bearer = `Bearer ${mint()}`;
  assertDenied(await request({ req: {
    headers: { authorization: bearer }, rawHeaders: ['Authorization', bearer, 'Authorization', bearer],
  } }));
});

test('header arrays cannot hide duplicate Authorization values', async () => {
  const bearer = `Bearer ${mint()}`;
  assertDenied(await request({ req: { headers: { authorization: [bearer, bearer] } } }));
});

test('raw and normalized Authorization identity disagreement rejects without choosing either', async () => {
  assertDenied(await request({ req: {
    headers: { authorization: `Bearer ${mint(B)}` }, rawHeaders: ['Authorization', `Bearer ${mint()}`],
  } }));
});

test('a single invalid selected cookie may clear only its staging-owned family', async () => {
  const result = await request({ req: { headers: { cookie: `${COOKIE}=invalid; token=legacy-preserved` } } });
  assertDenied(result, { destructive: true });
  for (const cleared of result.res.cleared) {
    assert.ok(cleared.name.startsWith('mbh_stg_'));
    assert.equal(cleared.attributes.path, '/');
    assert.equal(cleared.attributes.domain.replace(/^\./, ''), 'mosaicbizhub.com');
  }
});

test('expired cookie and unsupported temporary-profile token cannot authenticate a session', async () => {
  for (const value of [mint(A, {}, { expiresIn: -1 }), mint(A, { token_use: 'profile_completion' }, { audience: 'mosaic-staging-profile' })]) {
    const result = await request({ req: { headers: { cookie: `${COOKIE}=${value}` } } });
    assertDenied(result, { destructive: true });
  }
});

test('database session-version checks still reject a signed stale session', async () => {
  const result = await request({ req: { headers: { cookie: `${COOKIE}=${mint(A, { sessionVersion: 1 })}` } } });
  assertDenied(result, { reads: 1, destructive: true });
});

test('the database role remains authoritative rather than a signed role claim', async () => {
  const result = await request({ req: { headers: { authorization: `Bearer ${mint(A, { role: 'admin' })}` } } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user.role, 'business_owner');
});

test('missing database user cannot become an authenticated identity', async () => {
  const result = await request({ req: { headers: { authorization: `Bearer ${mint()}` } }, users: {} });
  assertDenied(result, { reads: 1 });
});

test('invalid activation configuration denies rather than falling back to legacy cookies', async () => {
  const result = await request({
    env: { API_BASE_URL: 'https://api.mosaicbizhub.com' },
    req: { headers: { cookie: `token=${mint()}` }, cookies: { token: mint() } },
  });
  assertDenied(result);
});

test('dormant middleware preserves legacy bearer precedence and historical session shape', async () => {
  const legacyA = jwt.sign({ sub: A, role: 'business_owner', sessionVersion: 2 }, KEY, { expiresIn: '7d' });
  const legacyB = jwt.sign({ sub: B, role: 'customer', sessionVersion: 2 }, KEY, { expiresIn: '7d' });
  const result = await request({ legacy: true, req: { headers: { authorization: `Bearer ${legacyB}` }, cookies: { token: legacyA } } });
  assert.equal(result.nextCount, 1);
  assert.equal(result.req.user, users[B]);
  assert.deepEqual(result.res.cleared, []);
});

test('dormant middleware preserves existing stale-bearer rejection and legacy clearing', async () => {
  const legacyA = jwt.sign({ sub: A, sessionVersion: 2 }, KEY, { expiresIn: '7d' });
  const result = await request({ legacy: true, req: { headers: { authorization: 'Bearer invalid' }, cookies: { token: legacyA } } });
  assertDenied(result, { destructive: true });
  assert.deepEqual(result.res.cleared.map(({ name }) => name).sort(), ['token', 'user_gender', 'user_session']);
});

test('switching synthetic policy environments between requests does not leak active state', async () => {
  const active = await request({ req: { headers: { cookie: `${COOKIE}=${mint()}` } } });
  assert.equal(active.nextCount, 1);
  const legacy = jwt.sign({ sub: A, sessionVersion: 2 }, KEY, { expiresIn: '7d' });
  const dormant = await request({ legacy: true, req: { headers: {}, cookies: { token: legacy } } });
  assert.equal(dormant.nextCount, 1);
  assert.equal(dormant.req.user, users[A]);
});
