/**
 * One-off smoke: auth/check per role + page load checks.
 * Usage: node scripts/verify-auth-check-smoke.js
 */
const dns = require('dns');
if (process.platform === 'win32') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const FRONTEND_BASE = process.env.FRONTEND_URL || 'http://localhost:3000';

const FORBIDDEN = new Set([
  'passwordHash',
  'password',
  'otp',
  'otpExpiry',
  'resetPasswordOtp',
  'resetPasswordOtpExpiry',
  'resetPasswordOtpAttempts',
  'resetPasswordExpires',
  'resetPasswordToken',
  'sessionVersion',
  '__v',
  'providerId',
]);

const EXPECTED = ['id', 'name', 'email', 'role', 'gender', 'mobile', 'isOtpVerified'];

function buildToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
      sessionVersion: user.sessionVersion || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function authCheck(role) {
  const user = await User.findOne({
    role,
    isOtpVerified: true,
    isDeleted: false,
    isBlocked: false,
  }).lean();

  if (!user) {
    return { role, pass: false, skip: true, reason: 'No verified user found in database' };
  }

  const token = buildToken(user);
  const res = await fetch(`${API_BASE}/api/users/auth/check`, {
    headers: { Cookie: `token=${token}` },
  });

  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  const safeUser = body.user || {};
  const keys = Object.keys(safeUser);
  const leaked = keys.filter((k) => FORBIDDEN.has(k));
  const missing = EXPECTED.filter((k) => !(k in safeUser));

  return {
    role,
    pass: res.status === 200 && body.loggedIn === true && leaked.length === 0 && missing.length === 0,
    status: res.status,
    loggedIn: body.loggedIn,
    keys,
    leaked,
    missing,
    returnedRole: safeUser.role,
  };
}

async function unauthenticatedCheck() {
  const res = await fetch(`${API_BASE}/api/users/auth/check`);
  return { pass: res.status === 401, status: res.status };
}

async function pageLoad(path) {
  const url = `${FRONTEND_BASE}${path}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { path, pass: res.status === 200, status: res.status, url: res.url };
  } catch (err) {
    return { path, pass: false, error: err.message };
  }
}

async function main() {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET missing — ensure .env is configured');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mbh');

  console.log('=== Auth check API (', API_BASE, ') ===\n');

  const anon = await unauthenticatedCheck();
  console.log('Unauthenticated /api/users/auth/check:', anon.pass ? 'PASS' : 'FAIL', `(HTTP ${anon.status})`);

  for (const role of ['customer', 'business_owner', 'admin']) {
    const label = role === 'business_owner' ? 'Vendor' : role.charAt(0).toUpperCase() + role.slice(1);
    const result = await authCheck(role);
    if (result.skip) {
      console.log(`${label} /api/users/auth/check: SKIP — ${result.reason}`);
      continue;
    }
    console.log(
      `${label} /api/users/auth/check:`,
      result.pass ? 'PASS' : 'FAIL',
      `(HTTP ${result.status}, role=${result.returnedRole}, keys=[${result.keys.join(', ')}])`
    );
    if (result.leaked.length) console.log('  LEAKED:', result.leaked.join(', '));
    if (result.missing.length) console.log('  MISSING:', result.missing.join(', '));
  }

  console.log('\n=== Frontend page loads (', FRONTEND_BASE, ') ===\n');

  const pages = [
    { label: 'Admin pages', path: '/admin' },
    { label: 'Vendor /partners/products', path: '/partners/products' },
    { label: 'Checkout /checkout/address?type=cart', path: '/checkout/address?type=cart' },
  ];

  for (const { label, path } of pages) {
    const result = await pageLoad(path);
    if (result.error) {
      console.log(`${label}: FAIL — ${result.error}`);
    } else {
      console.log(`${label}:`, result.pass ? 'PASS' : 'FAIL', `(HTTP ${result.status})`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
