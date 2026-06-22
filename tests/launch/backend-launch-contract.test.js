const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '../..');
const appPath = path.join(root, 'app.js');
const featuredRoutesPath = path.join(root, 'routes/featuredProductRoutes.js');
const businessRoutesPath = path.join(root, 'routes/businessRoutes.js');
const adminUserRoutesPath = path.join(root, 'routes/admin/userRoutes.js');
const adminProductRoutesPath = path.join(root, 'routes/admin/adminProductRoutes.js');
const adminOrderRoutesPath = path.join(root, 'routes/admin/adminOrderRoutes.js');
const orderRoutesPath = path.join(root, 'routes/orderRoutes.js');
const paymentRoutesPath = path.join(root, 'routes/paymentRoutes.js');
const connectRoutesPath = path.join(root, 'routes/connectRoutes.js');
const stripeFinanceRoutesPath = path.join(root, 'routes/stripe.routes.js');
const healthRoutesPath = path.join(root, 'routes/healthRoutes.js');
const isAdminPath = path.join(root, 'middlewares/isAdmin.js');
const toAdminUserPath = path.join(root, 'utils/toAdminUser.js');

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('app.js mounts launch-critical route prefixes', () => {
  const source = readSource(appPath);

  const mounts = [
    "app.use('/api', healthRoutes)",
    "app.use('/api/business', businessRoutes)",
    "app.use('/admin/users', adminUserRoutes)",
    "app.use('/admin/api/products', adminProductRoutes)",
    "app.use('/admin/api/orders', adminOrderRoutes)",
    "app.use('/api/payments', paymentRoutes)",
    "app.use('/api/orders', orderRoutes)",
    "app.use('/api/connect', connectRoutes)",
    "app.use('/stripe', stripeNewRoutes)",
    "app.use('/api', featuredProductRoutes)",
  ];

  for (const mount of mounts) {
    assert.ok(source.includes(mount), `expected mount: ${mount}`);
  }
});

test('GET /api/featured-products is canonical and /api/products/featured is absent', () => {
  const featuredSource = readSource(featuredRoutesPath);
  const appSource = readSource(appPath);

  assert.ok(featuredSource.includes("router.get('/featured-products'"));
  assert.ok(!featuredSource.includes('/products/featured'));
  assert.ok(!appSource.includes('/api/products/featured'));
  assert.ok(!appSource.includes('/products/featured'));
});

test('stale frontend alias paths are not registered', () => {
  const appSource = readSource(appPath);
  const routesDir = path.join(root, 'routes');
  const routeFiles = fs
    .readdirSync(routesDir, { recursive: true })
    .filter((file) => typeof file === 'string' && file.endsWith('.js'))
    .map((file) => readSource(path.join(routesDir, file)));

  assert.ok(!appSource.includes("app.use('/api/admin/users'"));
  assert.ok(!appSource.includes("app.use('/api/stripe/account-session'"));

  for (const source of routeFiles) {
    assert.ok(!source.includes('/api/admin/users'), 'route file must not define /api/admin/users');
    assert.ok(
      !source.includes("router.post('/api/stripe/account-session'"),
      'route file must not define /api/stripe/account-session'
    );
  }
});

test('GET /api/business/my requires authenticate and business_owner role', () => {
  const source = readSource(businessRoutesPath);
  const myBlock = source.slice(source.indexOf("'/my'"));

  assert.ok(myBlock.includes('authenticate'));
  assert.ok(myBlock.includes('isBusinessOwner'));
  assert.ok(myBlock.indexOf('authenticate') < myBlock.indexOf('getMyBusinesses'));
});

test('admin user routes apply router-level authenticate and isAdmin', () => {
  const source = readSource(adminUserRoutesPath);

  assert.match(source, /router\.use\(authenticate,\s*isAdmin\)/);
});

test('admin product list and featured toggle require authenticate and isAdmin', () => {
  const source = readSource(adminProductRoutesPath);

  assert.match(source, /router\.get\('\/', authenticate, isAdmin, getAllProducts\)/);
  assert.match(
    source,
    /router\.patch\('\/:productId\/featured', authenticate, isAdmin, toggleProductFeatured\)/
  );
  assert.ok(!source.includes("router.get('/test'"), 'unguarded debug /test route must not exist');
});

test('isAdmin rejects non-admin users with 403', async () => {
  const isAdmin = require(isAdminPath);
  const res = mockResponse();
  let calledNext = false;

  await isAdmin({ user: { role: 'customer' } }, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 403);
});

test('toAdminUser strips sensitive fields from admin list responses', () => {
  const toAdminUser = require(toAdminUserPath);
  const sanitized = toAdminUser({
    _id: '507f1f77bcf86cd799439011',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    passwordHash: 'secret-hash',
    otp: '123456',
    sessionVersion: 3,
  });

  assert.equal(sanitized.passwordHash, undefined);
  assert.equal(sanitized.otp, undefined);
  assert.equal(sanitized.sessionVersion, undefined);
  assert.equal(sanitized.email, 'admin@example.com');
});

test('admin order list requires authenticate and isAdmin', () => {
  const source = readSource(adminOrderRoutesPath);

  assert.match(source, /router\.get\('\/', authenticate, isAdmin, getAllOrdersAdmin\)/);
});

test('GET /api/orders/admin requires authenticate and isAdmin', () => {
  const source = readSource(orderRoutesPath);
  assert.match(source, /router\.get\('\/admin', authenticate, isAdmin, getAllOrdersAdmin\)/);
});

test('POST /api/orders/initiate requires authenticate and customer role', () => {
  const source = readSource(orderRoutesPath);
  assert.match(source, /router\.post\('\/initiate', authenticate, isCustomer, initiateOrder\)/);
});

// Legacy route: canonical checkout is POST /api/orders/initiate (Connect destination charge).
test('POST /api/payments/create-payment-intent is legacy but guarded', () => {
  const source = readSource(paymentRoutesPath);
  const routeBlock = source.slice(source.indexOf("'/create-payment-intent'"));

  assert.ok(routeBlock.includes('authenticate'));
  assert.ok(routeBlock.includes('isCustomer'));
  assert.ok(routeBlock.includes('paymentLimiter'));
  assert.ok(routeBlock.indexOf('authenticate') < routeBlock.indexOf('createPaymentIntent'));
});

test('app.js keeps Stripe webhook raw-body mounts before express.json', () => {
  const source = readSource(appPath);
  const jsonIndex = source.indexOf('app.use(express.json');
  const mounts = [
    "app.use('/api/stripe'",
    "app.use('/api/webhooks'",
    "app.use('/api/vendor-onboarding/webhook/payment'",
    "app.use('/api/subscription/webhook'",
  ];

  assert.ok(jsonIndex > -1, 'express.json middleware must exist in app.js');
  for (const mount of mounts) {
    const mountIndex = source.indexOf(mount);
    assert.ok(mountIndex > -1 && mountIndex < jsonIndex, `${mount} must appear before express.json`);
  }
});

test('Connect account-link and status routes require business_owner auth', () => {
  const source = readSource(connectRoutesPath);

  assert.match(
    source,
    /router\.post\('\/:businessId\/account-link', authenticate, isBusinessOwner, createAccountLink\)/
  );
  assert.match(
    source,
    /router\.get\('\/:businessId\/status', authenticate, isBusinessOwner, getStatus\)/
  );
});

test('Stripe finance routes under /stripe require business_owner auth', () => {
  const source = readSource(stripeFinanceRoutesPath);

  assert.match(source, /router\.post\('\/account-session', authenticate, isBusinessOwner/);
  assert.match(source, /router\.post\('\/express-login-link', authenticate, isBusinessOwner/);
  assert.match(source, /router\.get\('\/account-balance', authenticate, isBusinessOwner/);
  assert.match(source, /router\.get\('\/last-payout', authenticate, isBusinessOwner/);
});

test('health routes are mounted under /api with /health and /ready handlers', () => {
  const appSource = readSource(appPath);
  const healthSource = readSource(healthRoutesPath);

  assert.ok(appSource.includes("app.use('/api', healthRoutes)"));
  assert.ok(healthSource.includes("router.get('/health'"));
  assert.ok(healthSource.includes("router.get('/ready'"));
});

test('app.js defines public GET / root handler', () => {
  const source = readSource(appPath);
  assert.match(source, /app\.get\('\/',\s*\(req,\s*res\)\s*=>\s*\{/);
});

test('documented launch paths resolve to expected registration status', () => {
  const appSource = readSource(appPath);
  const stripeFinanceSource = readSource(stripeFinanceRoutesPath);

  const expectedPresent = [
    { label: '/admin/users', needle: "app.use('/admin/users'" },
    { label: '/admin/api/products', needle: "app.use('/admin/api/products'" },
    { label: '/admin/api/orders', needle: "app.use('/admin/api/orders'" },
    { label: '/api/orders/initiate', needle: "app.use('/api/orders'" },
    { label: '/api/payments/create-payment-intent', needle: "app.use('/api/payments'" },
    { label: '/stripe/account-session', needle: "router.post('/account-session'" },
    { label: '/stripe/express-login-link', needle: "router.post('/express-login-link'" },
    { label: '/stripe/account-balance', needle: "router.get('/account-balance'" },
    { label: '/stripe/last-payout', needle: "router.get('/last-payout'" },
  ];

  for (const entry of expectedPresent) {
    const haystack = entry.label.startsWith('/stripe/') ? stripeFinanceSource : appSource;
    assert.ok(haystack.includes(entry.needle), `${entry.label} should be registered`);
  }

  const expectedAbsent = [
    "app.use('/api/admin/users'",
    "app.use('/api/stripe/account-session'",
    '/api/products/featured',
  ];

  for (const needle of expectedAbsent) {
    assert.ok(!appSource.includes(needle), `${needle} should not be registered`);
  }
});

test('admin audit read API is mounted and guarded', () => {
  const appSource = readSource(appPath);
  const auditRoutesPath = path.join(root, 'routes/admin/adminAuditRoutes.js');
  const auditSource = readSource(auditRoutesPath);

  assert.ok(appSource.includes("app.use('/admin/api/audit-events', adminAuditRoutes)"));
  assert.ok(auditSource.includes('router.use(authenticate, isAdmin)'));
  assert.ok(!auditSource.match(/router\.(post|put|patch|delete)/));
});

test('request ID middleware is applied before route handlers', () => {
  const appSource = readSource(appPath);
  const requestIdx = appSource.indexOf('app.use(requestIdMiddleware)');
  const healthIdx = appSource.indexOf("app.use('/api', healthRoutes)");

  assert.ok(requestIdx > -1, 'requestIdMiddleware should be registered');
  assert.ok(requestIdx < healthIdx, 'requestIdMiddleware should run before API routes');
});
