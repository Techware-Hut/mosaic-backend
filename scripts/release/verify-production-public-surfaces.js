#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FULL_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const LEGACY_PAYMENT_PATH = '/api/payments/create-payment-intent';
const WEBHOOK_PATHS = Object.freeze([
  '/api/webhooks/stripe',
  '/api/stripe/webhook',
  '/api/stripe/payment/webhook',
  '/api/subscription/webhook',
  '/api/vendor-onboarding/webhook/payment',
]);
const CORS_ORIGINS = Object.freeze([
  'https://mosaicbizhub.com',
  'https://app.mosaicbizhub.com',
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://mosaic-biz-frontend-launch-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app',
  'https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app',
]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(
        'Usage: verify-production-public-surfaces.js --mode preflight|deployed|ungated --base-url <url> --expected-sha <sha> --output <path> [preflight attestation options]'
      );
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }

  if (!['preflight', 'deployed', 'ungated'].includes(values.mode)
      || !/^https:\/\/[^\s]+$/i.test(values['base-url'] || '')
      || !FULL_SHA.test(values['expected-sha'] || '')
      || !values.output) {
    throw new Error(
      'Usage: verify-production-public-surfaces.js --mode preflight|deployed|ungated --base-url <url> --expected-sha <sha> --output <path> [preflight attestation options]'
    );
  }

  const result = {
    mode: values.mode,
    baseUrl: values['base-url'].replace(/\/$/, ''),
    expectedSha: values['expected-sha'].toLowerCase(),
    output: values.output,
  };
  if (result.mode === 'preflight') {
    if (
      !FULL_SHA.test(values['legacy-retirement-sha'] || '')
      || !SHA256.test(values['legacy-reconciliation-sha256'] || '')
    ) {
      throw new Error(
        'Preflight requires a full legacy-retirement-sha and reviewed legacy-reconciliation-sha256'
      );
    }
    result.legacyRetirementSha = values['legacy-retirement-sha'].toLowerCase();
    result.legacyReconciliationSha256 = values['legacy-reconciliation-sha256'].toLowerCase();
  }
  return result;
}

async function request(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requireStatus(fetchImpl, baseUrl, method, pathname, expected, options = {}) {
  const response = await request(fetchImpl, `${baseUrl}${pathname}`, {
    method,
    ...options,
  });
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${pathname} returned HTTP ${response.status}; expected ${expected.join(' or ')}`);
  }
  return response;
}

function parseReleaseIdentity(payload, surface) {
  const release = payload?.release;
  if (!release || typeof release !== 'object') {
    throw new Error(`${surface} is missing release identity`);
  }
  if (!/^[a-f0-9]{7}$/i.test(release.commit || '')) {
    throw new Error(`${surface} release commit is invalid`);
  }
  const match = /^mosaic-([a-f0-9]{40})$/i.exec(release.deploymentVersion || '');
  if (!match || release.environment !== 'production') {
    throw new Error(`${surface} release identity is not a production full-SHA version`);
  }
  if (release.commit.toLowerCase() !== match[1].slice(0, 7).toLowerCase()) {
    throw new Error(`${surface} short and full release commits disagree`);
  }
  return {
    commit: release.commit.toLowerCase(),
    deploymentVersion: release.deploymentVersion.toLowerCase(),
    fullSha: match[1].toLowerCase(),
    environment: 'production',
  };
}

async function verifyProductionPublicSurfaces({
  mode,
  baseUrl,
  expectedSha,
  legacyRetirementSha,
  legacyReconciliationSha256,
  fetchImpl = fetch,
}) {
  const healthResponse = await requireStatus(fetchImpl, baseUrl, 'GET', '/api/health', [200]);
  const readyResponse = await requireStatus(fetchImpl, baseUrl, 'GET', '/api/ready', [200]);
  const buildResponse = await requireStatus(fetchImpl, baseUrl, 'GET', '/api/build-info', [200]);
  await requireStatus(fetchImpl, baseUrl, 'GET', '/api/users/auth/check', [401]);
  await requireStatus(fetchImpl, baseUrl, 'GET', '/api/featured-products', [200]);

  const health = parseReleaseIdentity(await healthResponse.json(), '/api/health');
  const ready = parseReleaseIdentity(await readyResponse.json(), '/api/ready');
  const build = parseReleaseIdentity(await buildResponse.json(), '/api/build-info');
  if (health.fullSha !== build.fullSha || ready.fullSha !== build.fullSha) {
    throw new Error('Public health, readiness, and build-info release identities disagree');
  }

  for (const webhookPath of WEBHOOK_PATHS) {
    await requireStatus(fetchImpl, baseUrl, 'POST', webhookPath, [400], {
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=0,v1=invalid-release-preflight',
      },
      body: '{}',
    });
  }

  for (const origin of CORS_ORIGINS) {
    const response = await requireStatus(fetchImpl, baseUrl, 'OPTIONS', '/api/featured-products', [200, 204], {
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    if (response.headers.get('access-control-allow-origin') !== origin) {
      throw new Error(`CORS allow-origin is missing for an approved origin`);
    }
  }

  let checkoutStatus = null;
  if (mode === 'preflight' || mode === 'ungated') {
    const checkoutResponse = await request(fetchImpl, `${baseUrl}/api/orders/initiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    checkoutStatus = checkoutResponse.status;
    const expectedCheckoutStatuses = mode === 'preflight'
      ? [400, 401, 403, 422, 503]
      : [400, 401, 403, 422];
    if (!expectedCheckoutStatuses.includes(checkoutStatus)) {
      throw new Error(`Checkout is not in normal application state (HTTP ${checkoutStatus})`);
    }
  }

  let legacyPaymentStatus = null;
  const legacyResponse = await request(fetchImpl, `${baseUrl}${LEGACY_PAYMENT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  legacyPaymentStatus = legacyResponse.status;
  if (![404, 405].includes(legacyPaymentStatus)) {
    throw new Error(`Legacy payment-intent route is still reachable (HTTP ${legacyPaymentStatus})`);
  }
  if (mode === 'preflight') {
    if (!FULL_SHA.test(legacyRetirementSha || '') || !SHA256.test(legacyReconciliationSha256 || '')) {
      throw new Error('Legacy payment cutover attestation is missing or malformed');
    }
  }

  if (mode === 'preflight' && build.fullSha === expectedSha) {
    throw new Error('Expected release SHA is already deployed; no production mutation is required');
  }

  if ((mode === 'deployed' || mode === 'ungated') && build.fullSha !== expectedSha) {
    throw new Error(`Production release identity does not match expected exact SHA`);
  }

  return {
    mode,
    expectedSha,
    observedSha: build.fullSha,
    alreadyDeployed: build.fullSha === expectedSha,
    checkoutGateObserved: checkoutStatus === 503,
    checkoutStatus,
    legacyPaymentStatus,
    legacyPaymentCutover: mode === 'preflight' ? {
      retirementSha: legacyRetirementSha,
      reconciliationSha256: legacyReconciliationSha256,
    } : null,
    health: 'success',
    readiness: 'success',
    authGuard: 'success',
    webhooks: 'success',
    cors: 'success',
    featuredProducts: 'success',
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await verifyProductionPublicSurfaces(args);
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`Production public-surface ${args.mode} verification passed.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production public-surface verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  WEBHOOK_PATHS,
  CORS_ORIGINS,
  LEGACY_PAYMENT_PATH,
  parseArgs,
  parseReleaseIdentity,
  verifyProductionPublicSurfaces,
};
