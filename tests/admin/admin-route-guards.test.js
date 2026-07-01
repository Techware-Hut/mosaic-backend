const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminRoutesDir = path.resolve(__dirname, '../../routes/admin');
const vendorOnboardingRoutesPath = path.resolve(
  __dirname,
  '../../routes/vendorOnboarding.routes.js'
);

const GLOBAL_GUARD_FILES = new Set([
  'userRoutes.js',
  'faqRoutes.js',
  'testimonialRoutes.js',
  'categoryRequestRoutes.js',
  'adminAuditRoutes.js',
  'Blog/blogRoutes.js',
]);

const PUBLIC_GET_EXCEPTIONS = new Set([
  'productCategoryRoutes.js',
  'foodCategoryRoutes.js',
  'categoryRoutes.js',
  'productSubcategoryRoutes.js',
  'serviceSubcategoryRoutes.js',
  'foodSubcategoryRoutes.js',
  'cmsRoutes.js',
]);

function listAdminRouteFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listAdminRouteFiles(fullPath, files);
      continue;
    }
    if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativeAdminPath(fullPath) {
  return path.relative(adminRoutesDir, fullPath).replace(/\\/g, '/');
}

test('admin route files with router.use declare authenticate and isAdmin', () => {
  const files = listAdminRouteFiles(adminRoutesDir);

  for (const filePath of files) {
    const rel = relativeAdminPath(filePath);
    const source = fs.readFileSync(filePath, 'utf8');

    if (!source.includes('router.use(')) {
      continue;
    }

    const useBlocks = source.match(/router\.use\([^)]+\)/g) || [];
    const adminUse = useBlocks.filter(
      (block) => block.includes('authenticate') && block.includes('isAdmin')
    );

    assert.ok(
      adminUse.length > 0 || GLOBAL_GUARD_FILES.has(rel),
      `${rel} has router.use but no authenticate+isAdmin guard`
    );
  }
});

function hasGlobalAdminGuard(source) {
  return /router\.use\([^)]*authenticate[^)]*isAdmin[^)]*\)/.test(source)
    || /router\.use\([^)]*isAdmin[^)]*authenticate[^)]*\)/.test(source);
}

test('admin mutation routes declare authenticate and isAdmin when not globally guarded', () => {
  const files = listAdminRouteFiles(adminRoutesDir);

  for (const filePath of files) {
    const rel = relativeAdminPath(filePath);
    const source = fs.readFileSync(filePath, 'utf8');

    if (hasGlobalAdminGuard(source)) {
      continue;
    }

    const mutations = [
      ...source.matchAll(/router\.(post|put|patch|delete)\([^)]+\)/g),
    ];

    for (const match of mutations) {
      const statement = match[0];
      assert.match(
        statement,
        /authenticate/,
        `${rel} mutation missing authenticate: ${statement}`
      );
      assert.match(
        statement,
        /isAdmin/,
        `${rel} mutation missing isAdmin: ${statement}`
      );
    }
  }
});

test('public GET exceptions are limited to known taxonomy and CMS files', () => {
  const files = listAdminRouteFiles(adminRoutesDir);

  for (const filePath of files) {
    const rel = relativeAdminPath(filePath);
    const source = fs.readFileSync(filePath, 'utf8');

    const unguardedGets = [
      ...source.matchAll(/router\.get\(([^)]*)\)/g),
    ].filter((match) => {
      const args = match[1];
      return !args.includes('authenticate') && !args.includes('isAdmin');
    });

    if (!unguardedGets.length) {
      continue;
    }

    if (hasGlobalAdminGuard(source)) {
      continue;
    }

    assert.ok(
      PUBLIC_GET_EXCEPTIONS.has(rel),
      `${rel} has unguarded GET routes but is not in PUBLIC_GET_EXCEPTIONS`
    );
  }
});

test('vendor onboarding admin routes require authenticate and isAdmin', () => {
  const source = fs.readFileSync(vendorOnboardingRoutesPath, 'utf8');
  const adminRoutes = [
    "router.get('/pending', authenticate, isAdmin",
    "router.get('/:applicationId', authenticate, isAdmin",
    "router.post('/:applicationId/verify', authenticate, isAdmin",
    "router.post('/:applicationId/verification-guidance', authenticate, isAdmin",
    "router.post('/:applicationId/finalize', authenticate, isAdmin",
  ];

  for (const route of adminRoutes) {
    assert.ok(source.includes(route), `expected guarded admin route: ${route}`);
  }
});
