const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  startHarness,
  resetDatabase,
  stopHarness,
  getApp,
} = require('./setup/harness');
const { createAgent, parseCookies } = require('./helpers/client');
const {
  registerAndVerify,
  login,
  registerUser,
  verifyRegistrationOtp,
  seedApprovedBusiness,
} = require('./helpers/factories');
const { setOtpEmailFailCount } = require('./helpers/providerStubs');
const User = require('../../models/User');

test.before(async () => {
  await startHarness();
});

test.afterEach(async () => {
  await resetDatabase();
});

test.after(async () => {
  await stopHarness();
});

test('register → OTP verify → login → auth/check → logout session flow', async () => {
  const agent = createAgent(getApp());

  const { registerRes, email, password } = await registerAndVerify(agent, {
    role: 'customer',
  });

  assert.equal(registerRes.status, 201);
  assert.equal(registerRes.body.success, true);

  const loginRes = await login(agent, email, password);
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.body.token);
  assert.equal(loginRes.headers['set-cookie']?.some((c) => c.startsWith('token=')), true);

  const authCheck = await agent.get('/api/users/auth/check');
  assert.equal(authCheck.status, 200);
  assert.equal(authCheck.body.loggedIn, true);
  assert.equal(authCheck.body.user.role, 'customer');

  const logoutRes = await agent.post('/api/users/logout');
  assert.equal(logoutRes.status, 200);

  const afterLogout = await agent.get('/api/users/auth/check');
  assert.equal(afterLogout.status, 401);
});

test('business_owner register → verify → login → auth/check → logout session flow', async () => {
  const agent = createAgent(getApp());

  const { registerRes, email, password } = await registerAndVerify(agent, {
    role: 'business_owner',
  });

  assert.equal(registerRes.status, 201);
  assert.equal(registerRes.body.success, true);

  const loginRes = await login(agent, email, password);
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.body.token);
  assert.equal(loginRes.body.user.role, 'business_owner');
  assert.equal(loginRes.headers['set-cookie']?.some((c) => c.startsWith('token=')), true);
  assert.equal(
    loginRes.headers['set-cookie']?.some((c) => c.startsWith('user_session=')),
    true
  );

  const authCheck = await agent.get('/api/users/auth/check');
  assert.equal(authCheck.status, 200);
  assert.equal(authCheck.body.loggedIn, true);
  assert.equal(authCheck.body.user.role, 'business_owner');
  assert.equal(authCheck.body.user.isOtpVerified, true);

  const logoutRes = await agent.post('/api/users/logout');
  assert.equal(logoutRes.status, 200);

  const afterLogout = await agent.get('/api/users/auth/check');
  assert.equal(afterLogout.status, 401);
});

test('OTP verification uses captured fixture OTP from mailer stub', async () => {
  const agent = createAgent(getApp());
  const { email } = await registerUser(agent, { role: 'business_owner' });

  const verifyRes = await verifyRegistrationOtp(agent, email);
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.success, true);
  assert.equal(verifyRes.body.user.role, 'business_owner');
});

test('auth check rejects invalidated session after sessionVersion bump', async () => {
  const agent = createAgent(getApp());
  const { email, password } = await registerAndVerify(agent, { role: 'customer' });

  await login(agent, email, password);
  const ok = await agent.get('/api/users/auth/check');
  assert.equal(ok.status, 200);

  const user = await User.findOne({ email });
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();

  const stale = await agent.get('/api/users/auth/check');
  assert.equal(stale.status, 401);
  assert.match(stale.body.message, /Session expired/i);
});

test('unauthenticated auth check returns 401', async () => {
  const agent = createAgent(getApp());
  const res = await agent.get('/api/users/auth/check');
  assert.equal(res.status, 401);
});

test('register sets otpPending cookie', async () => {
  const agent = createAgent(getApp());
  const { res, email } = await registerUser(agent, { role: 'customer' });
  assert.equal(res.status, 201);
  const cookies = parseCookies(res.headers['set-cookie']);
  assert.equal(cookies.otpPending, 'true');
  assert.ok(email);
});

test('business_owner register OTP delivery failure → resend → verify → login → auth/check', async () => {
  setOtpEmailFailCount(1);

  const agent = createAgent(getApp());
  const password = 'Secret123!';
  const email = `business_owner-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const mobile = `+1415555${String(Date.now()).slice(-4)}`;

  const registerRes = await agent.post('/api/users/register').send({
    name: 'business_owner Integration',
    email,
    password,
    mobile,
    role: 'business_owner',
  });

  assert.equal(registerRes.status, 502);
  assert.equal(registerRes.body.code, 'OTP_DELIVERY_FAILED');
  assert.equal(registerRes.body.accountCreated, true);
  assert.equal(registerRes.body.otpPending, true);
  assert.equal(registerRes.body.user.role, 'business_owner');
  assert.equal(registerRes.body.user.email, email);

  const cookies = parseCookies(registerRes.headers['set-cookie']);
  assert.equal(cookies.otpPending, 'true');

  const resendRes = await agent.post('/api/users/resend-otp').send({ email });
  assert.equal(resendRes.status, 200);
  assert.equal(resendRes.body.success, true);

  const verifyRes = await verifyRegistrationOtp(agent, email);
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.user.role, 'business_owner');

  const loginRes = await login(agent, email, password);
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.user.role, 'business_owner');

  const authCheck = await agent.get('/api/users/auth/check');
  assert.equal(authCheck.status, 200);
  assert.equal(authCheck.body.user.role, 'business_owner');
  assert.equal(authCheck.body.user.isOtpVerified, true);
});

test('verify-otp rejects invalid OTP with 400', async () => {
  const agent = createAgent(getApp());
  const { email } = await registerUser(agent, { role: 'business_owner' });

  const verifyRes = await agent.post('/api/users/verify-otp').send({
    email,
    otp: '000000',
  });

  assert.equal(verifyRes.status, 400);
  assert.equal(verifyRes.body.success, false);
});

async function withStagingSessionPolicy(fn) {
  const values = {
    AUTH_SESSION_POLICY: 'staging-v1', RELEASE_ENVIRONMENT: 'staging', SENTRY_ENVIRONMENT: 'staging',
    API_BASE_URL: 'https://api-staging.mosaicbizhub.com', COOKIE_DOMAIN: '.mosaicbizhub.com',
    COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'none', TEMP_COOKIE_NAME: undefined,
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('STG-005 opt-in registration, OTP, login, auth/check and logout preserve legacy cookies', async () => {
  await withStagingSessionPolicy(async () => {
    const jwt = require('jsonwebtoken');
    const agent = createAgent(getApp());
    const { registerRes, verifyRes, email, password } = await registerAndVerify(agent, { role: 'business_owner' });
    assert.equal(registerRes.status, 201);
    assert.equal(parseCookies(registerRes.headers['set-cookie']).mbh_stg_otp_pending, 'true');
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.headers['set-cookie'].some((cookie) => cookie.startsWith('mbh_stg_token=')), true);
    const loginRes = await login(agent, email, password);
    assert.equal(loginRes.status, 200);
    const selected = parseCookies(loginRes.headers['set-cookie']).mbh_stg_token;
    assert.ok(selected);
    const payload = jwt.verify(selected, process.env.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'https://api-staging.mosaicbizhub.com', audience: 'mosaic-staging-api',
    });
    assert.equal(payload.token_use, 'session');
    assert.equal(payload.exp - payload.iat, 604800);
    const sessionHeader = loginRes.headers['set-cookie'].find((cookie) => cookie.startsWith('mbh_stg_token='));
    assert.match(sessionHeader, /;\s*Domain=\.?mosaicbizhub\.com(?:;|$)/i);
    assert.match(sessionHeader, /;\s*Secure(?:;|$)/i);
    assert.match(sessionHeader, /;\s*HttpOnly(?:;|$)/i);
    assert.match(sessionHeader, /;\s*SameSite=None(?:;|$)/i);

    // Supertest's loopback cookie jar cannot model HTTPS mosaic-domain delivery.
    // Explicit headers exercise server selection; no browser-delivery proof is claimed.
    const legacyCookie = 'token=synthetic-old-production-cookie; user_session=true';
    const selectedCookie = `mbh_stg_token=${selected}`;
    const auth = await createAgent(getApp()).get('/api/users/auth/check').set('Cookie', `${legacyCookie}; ${selectedCookie}`);
    assert.equal(auth.status, 200);
    assert.equal(auth.body.user.email, email);
    assert.equal(auth.body.user.role, 'business_owner');
    assert.equal('sessionVersion' in auth.body.user, false);
    assert.equal('token_use' in auth.body.user, false);

    const logout = await createAgent(getApp()).post('/api/users/logout').set('Cookie', `${legacyCookie}; ${selectedCookie}`);
    assert.equal(logout.status, 200);
    assert.deepEqual(Object.keys(parseCookies(logout.headers['set-cookie'])), [
      'mbh_stg_token', 'mbh_stg_user_session', 'mbh_stg_user_gender', 'mbh_stg_otp_pending', 'mbh_stg_tmp',
    ]);
    for (const cookie of logout.headers['set-cookie']) {
      assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
      assert.match(cookie, /;\s*Domain=\.?mosaicbizhub\.com(?:;|$)/i);
    }
    const oldOnly = await createAgent(getApp()).get('/api/users/auth/check').set('Cookie', legacyCookie);
    assert.equal(oldOnly.status, 401);
    assert.equal(oldOnly.headers['set-cookie'], undefined);
    const replay = await createAgent(getApp()).get('/api/users/auth/check').set('Cookie', selectedCookie);
    assert.equal(replay.status, 200, 'cookie removal must not be misrepresented as stateless-token revocation');
  });
});

test('STG-005 real app rejects conflicting credentials without clearing the valid cookie', async () => {
  await withStagingSessionPolicy(async () => {
    const first = await registerAndVerify(createAgent(getApp()), { role: 'customer' });
    const second = await registerAndVerify(createAgent(getApp()), { role: 'customer' });
    const firstToken = first.verifyRes.body.token;
    const secondToken = second.verifyRes.body.token;
    assert.ok(firstToken);
    assert.ok(secondToken);
    for (const bearer of [secondToken, 'malformed-synthetic-token']) {
      const response = await createAgent(getApp()).get('/api/users/auth/check')
        .set('Cookie', `mbh_stg_token=${firstToken}`)
        .set('Authorization', `Bearer ${bearer}`);
      assert.equal(response.status, 401);
      assert.equal(response.headers['set-cookie'], undefined);
    }
    const identical = await createAgent(getApp()).get('/api/users/auth/check')
      .set('Cookie', `mbh_stg_token=${firstToken}`)
      .set('Authorization', `Bearer ${firstToken}`);
    assert.equal(identical.status, 200);
    assert.equal(identical.body.user.email, first.email);
    const duplicate = await createAgent(getApp()).get('/api/users/auth/check')
      .set('Cookie', `mbh_stg_token=${firstToken}; mbh_stg_token=${firstToken}`);
    assert.equal(duplicate.status, 401);
    assert.equal(duplicate.headers['set-cookie'], undefined);
  });
});

test('STG-005 scoped vendor sessions preserve business ownership filtering and resource denial', async () => {
  await withStagingSessionPolicy(async () => {
    const first = await registerAndVerify(createAgent(getApp()), { role: 'business_owner' });
    const second = await registerAndVerify(createAgent(getApp()), { role: 'business_owner' });
    const firstUser = await User.findOne({ email: first.email });
    const secondUser = await User.findOne({ email: second.email });
    const firstBusiness = await seedApprovedBusiness(firstUser, { businessName: 'Synthetic STG-005 Owner A' });
    const secondBusiness = await seedApprovedBusiness(secondUser, { businessName: 'Synthetic STG-005 Owner B' });
    const selectedCookie = `mbh_stg_token=${first.verifyRes.body.token}`;

    const ownBusinesses = await createAgent(getApp()).get('/api/business/my').set('Cookie', selectedCookie);
    assert.equal(ownBusinesses.status, 200);
    const ids = ownBusinesses.body.businesses.map((business) => String(business._id));
    assert.equal(ids.includes(String(firstBusiness._id)), true);
    assert.equal(ids.includes(String(secondBusiness._id)), false);

    const ownSettings = await createAgent(getApp())
      .get(`/api/business/${firstBusiness._id}/shipping-settings`).set('Cookie', selectedCookie);
    assert.equal(ownSettings.status, 200);
    assert.equal(ownSettings.body.success, true);
    const otherSettings = await createAgent(getApp())
      .get(`/api/business/${secondBusiness._id}/shipping-settings`).set('Cookie', selectedCookie);
    assert.equal(otherSettings.status, 404);
    assert.equal(otherSettings.body.shippingSettings, undefined);
    assert.equal(otherSettings.headers['set-cookie'], undefined);
  });
});
