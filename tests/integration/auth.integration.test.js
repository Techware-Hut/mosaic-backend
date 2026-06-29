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
