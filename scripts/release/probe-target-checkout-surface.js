#!/usr/bin/env node
'use strict';

const http = require('node:http');
const path = require('node:path');
const {
  nowIso,
  parseOptions,
  requireOption,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const CANONICAL_PATHS = [
  '/api/orders/initiate',
  '/api/orders/initiate/',
  '/API/ORDERS/INITIATE',
  '/Api/Orders/Initiate/',
];
const RETIRED_LEGACY_PATHS = [
  '/api/payments/create-payment-intent',
  '/api/payments/create-payment-intent/',
  '/API/PAYMENTS/CREATE-PAYMENT-INTENT',
  '/Api/Payments/Create-Payment-Intent/',
];

function routePathIsExact(routePath, expected) {
  if (Array.isArray(routePath)) {
    return routePath.length === 1 && routePath[0] === expected;
  }
  return routePath === expected;
}

function layerMountsExactPath(layer, requestPath, expectedMount) {
  if (!Array.isArray(layer?.matchers) || layer.matchers.length === 0) return false;
  return layer.matchers.some((matcher) => {
    if (typeof matcher !== 'function') return false;
    try {
      const match = matcher(requestPath);
      return Boolean(match && match.path === expectedMount);
    } catch (_error) {
      return false;
    }
  });
}

function hasCanonicalPostRoute(app) {
  const stack = app?.router?.stack || app?._router?.stack;
  if (!Array.isArray(stack)) return false;

  return stack.some((layer) => {
    if (!layerMountsExactPath(layer, '/api/orders/initiate', '/api/orders')) return false;
    const routerStack = layer?.handle?.stack;
    if (!Array.isArray(routerStack)) return false;
    return routerStack.some((routeLayer) => {
      const route = routeLayer?.route;
      return Boolean(
        route
        && routePathIsExact(route.path, '/initiate')
        && route.methods?.post === true
      );
    });
  });
}

async function verifyStatuses(requestStatus, clock) {
  const canonical = [];
  const legacy = [];
  for (const routePath of CANONICAL_PATHS) {
    const status = await requestStatus(routePath);
    canonical.push({ path: routePath, status });
    if (status !== 401) {
      throw new Error('Exact target does not expose canonical checkout behind its auth guard');
    }
  }
  for (const routePath of RETIRED_LEGACY_PATHS) {
    const status = await requestStatus(routePath);
    legacy.push({ path: routePath, status });
    if (status !== 404 && status !== 405) {
      throw new Error('Exact target still exposes the retired legacy payment-intent route');
    }
  }
  return {
    schemaVersion: 1,
    status: 'passed',
    checkedAt: nowIso(clock),
    canonical,
    retiredLegacy: legacy,
    productionMutation: false,
  };
}

function safeProbeEnvironment(env = process.env) {
  Object.assign(env, {
    NODE_ENV: 'test',
    ENABLE_SENTRY_DEBUG_ROUTE: 'false',
    SENTRY_DSN: '',
    STRIPE_SECRET_KEY: 'sk_test_release_surface_probe_not_a_real_key',
    STRIPE_SECRET: 'sk_test_release_surface_probe_not_a_real_key',
    JWT_SECRET: 'release-surface-probe-only',
    GOOGLE_CLIENT_ID: 'release-surface-probe-only',
    GOOGLE_CLIENT_SECRET: 'release-surface-probe-only',
    API_BASE_URL: 'http://127.0.0.1',
    FRONTEND_URL: 'http://127.0.0.1',
  });
  delete env.MONGODB_URI;
}

async function probeTarget(root, dependencies = {}) {
  safeProbeEnvironment(dependencies.env || process.env);
  const loadApp = dependencies.loadApp || ((appPath) => require(appPath));
  const app = loadApp(path.join(root, 'app.js'));
  if (typeof app !== 'function') throw new Error('Exact target app export is not an HTTP handler');
  if (!hasCanonicalPostRoute(app)) {
    throw new Error('Exact target route stack lacks canonical POST /api/orders/initiate');
  }

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Exact target probe could not allocate a local listener');
  }
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const result = await verifyStatuses(async (routePath) => {
      const response = await fetch(`${origin}${routePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      return response.status;
    }, dependencies.clock);
    result.canonicalRouteTableVerified = true;
    return result;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseOptions(argv);
  const root = path.resolve(requireOption(options, '--root'));
  const output = requireOption(options, '--output');
  const releaseSha = requireOption(options, '--release-sha').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('Release SHA must be one full SHA');
  const result = await (dependencies.probeTarget || probeTarget)(root, dependencies);
  result.releaseSha = releaseSha;
  (dependencies.writeJson || writeJson)(output, result);
  console.log('Exact-target checkout route table passed.');
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Exact-target checkout route proof failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CANONICAL_PATHS,
  RETIRED_LEGACY_PATHS,
  hasCanonicalPostRoute,
  layerMountsExactPath,
  main,
  probeTarget,
  routePathIsExact,
  safeProbeEnvironment,
  verifyStatuses,
};
