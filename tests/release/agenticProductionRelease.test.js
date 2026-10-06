'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/deploy-eb-production.yml');
const deployScriptPath = path.join(repoRoot, 'scripts/release/deploy-eb-exact-sha.sh');
const infrastructureSetupPath = path.join(
  repoRoot,
  'docs/release/RELEASE_CONTROL_INFRASTRUCTURE_SETUP.md'
);

const {
  ROLLBACK_CONFIRMATION,
  FOCUSED_BASELINE_SHA,
  resolveProductionRelease,
} = require('../../scripts/release/resolve-production-release');
const {
  selectCanonicalReleasePullRequest,
  selectExactCertificationRun,
  selectExactCertificateArtifact,
} = require('../../scripts/release/verify-main-release-source');
const {
  validateDrainConfiguration,
} = require('../../scripts/release/validate-release-drain');
const {
  CORS_ORIGINS,
  WEBHOOK_PATHS,
  verifyProductionPublicSurfaces,
} = require('../../scripts/release/verify-production-public-surfaces');
const {
  buildProductionEvidence,
} = require('../../scripts/release/build-production-evidence');
const {
  requireProcessedVersion,
} = require('../../scripts/release/require-eb-application-version');
const {
  analyzeCheckoutSurface,
} = require('../../scripts/release/verify-checkout-surface-contract');
const {
  hasCanonicalPostRoute,
  verifyStatuses: verifyTargetCheckoutStatuses,
} = require('../../scripts/release/probe-target-checkout-surface');
const {
  cliConfiguration: checkoutGateCliConfiguration,
} = require('../../scripts/release/manage-checkout-gate');

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);
const repository = 'Techware-Hut/mosaic-backend';

const gateArnPrefix = 'arn:aws:elasticloadbalancing:us-east-1:123456789012:';
const pinnedGateConfiguration = {
  region: 'us-east-1',
  loadBalancerArn: `${gateArnPrefix}loadbalancer/app/prod/abc123`,
  httpRuleArn: `${gateArnPrefix}listener-rule/app/prod/abc123/http80/rule1`,
  httpsRuleArn: `${gateArnPrefix}listener-rule/app/prod/abc123/https443/rule2`,
  httpPriority: '1',
  httpsPriority: '1',
};
const gateVerifyArgs = ['verify', '--output', 'gate-evidence.json'];
const gateEnableArgs = [
  'enable', '--confirm', 'ENABLE_CHECKOUT_GATE', '--output', 'gate-evidence.json',
];

function gateCli(args, env = {}) {
  return checkoutGateCliConfiguration(args, env, pinnedGateConfiguration);
}

function resolver(overrides = {}) {
  return resolveProductionRelease({
    event: 'push',
    eventSha: shaA,
    workflowSha: shaA,
    requestedSha: '',
    mode: 'release',
    confirmation: '',
    currentMainSha: shaA,
    commitExists: () => true,
    isAncestor: () => true,
    ...overrides,
  });
}

test('normal release accepts only the exact current main tip', () => {
  assert.equal(resolver().releaseSha, shaA);
  assert.throws(
    () => resolver({ eventSha: shaB }),
    /must equal the exact current main tip/
  );
  assert.throws(
    () => resolver({ event: 'workflow_dispatch', requestedSha: shaB }),
    /must equal the exact current main tip/
  );
});

test('obsolete production workflow definitions cannot release or roll back', () => {
  assert.throws(
    () => resolver({ workflowSha: shaB }),
    /workflow definition is not the exact current main revision/
  );
  assert.throws(
    () => resolver({
      event: 'workflow_dispatch',
      requestedSha: shaB,
      mode: 'rollback',
      confirmation: ROLLBACK_CONFIRMATION,
      workflowSha: shaB,
      isAncestor: () => true,
    }),
    /workflow definition is not the exact current main revision/
  );
});

test('one-time repository setup requires canonical two-parent merge commits only', () => {
  const setup = fs.readFileSync(infrastructureSetupPath, 'utf8');
  assert.match(setup, /allow \*\*merge commits only\*\*/i);
  assert.match(setup, /disable squash merging and rebase merging/i);
  assert.match(setup, /canonical two-parent merge/i);
});

test('old main ancestors are available only through explicit break-glass rollback', () => {
  const rollback = resolver({
    event: 'workflow_dispatch',
    requestedSha: shaB,
    mode: 'rollback',
    confirmation: ROLLBACK_CONFIRMATION,
    isAncestor: (candidate, main) => candidate === shaB && main === shaA,
  });
  assert.equal(rollback.breakGlass, true);
  assert.throws(
    () => resolver({
      event: 'workflow_dispatch',
      requestedSha: shaB,
      mode: 'rollback',
      confirmation: 'yes',
    }),
    /exact confirmation phrase/
  );
});

test('focused baseline resolves only an exact protected branch tip and approved production baseline', () => {
  const focused = {
    event: 'workflow_dispatch',
    requestedSha: shaB,
    mode: 'focused-baseline',
    baselineSha: FOCUSED_BASELINE_SHA,
    releaseRef: 'refs/heads/release/focused/booking-filter',
    sourcePr: '290',
    focusedRefSha: shaB,
  };
  const result = resolver(focused);
  assert.equal(result.releaseSha, shaB);
  assert.equal(result.sourceRequired, true);
  assert.equal(result.breakGlass, false);
  assert.deepEqual(result.focusedSource, {
    baselineSha: FOCUSED_BASELINE_SHA,
    releaseRef: focused.releaseRef,
    sourcePr: 290,
  });
  assert.throws(() => resolver({ ...focused, baselineSha: shaA }), /approved production SHA/);
  assert.throws(() => resolver({ ...focused, focusedRefSha: shaA }), /branch tip/);
  assert.throws(() => resolver({ ...focused, releaseRef: 'refs/heads/staging' }), /protected release\/focused/);
  assert.throws(() => resolver({ ...focused, sourcePr: '' }), /merged PR number/);
  assert.throws(() => resolver({ ...focused, workflowSha: shaB }), /workflow definition is not the exact current main/);
  assert.throws(() => resolver({ ...focused, event: 'push' }), /Push-triggered releases cannot enter/);
});

function pullRequest(overrides = {}) {
  return {
    number: 273,
    html_url: 'https://github.example/pull/273',
    merged_at: '2026-08-13T20:35:47Z',
    merge_commit_sha: shaA,
    base: { ref: 'main', repo: { full_name: repository } },
    head: { ref: 'staging', sha: shaB, repo: { full_name: repository } },
    ...overrides,
  };
}

test('main source policy rejects fork lookalikes and requires one canonical staging PR', () => {
  assert.equal(selectCanonicalReleasePullRequest([pullRequest()], repository, shaA).number, 273);
  assert.throws(
    () => selectCanonicalReleasePullRequest([
      pullRequest({ head: { ref: 'staging', sha: shaB, repo: { full_name: 'attacker/fork' } } }),
    ], repository, shaA),
    /found 0/
  );
});

test('certificate lookup is exact-SHA, canonical-repository, successful, and artifact-bound', () => {
  const run = {
    id: 10,
    path: '.github/workflows/staging-release-certification.yml',
    event: 'push',
    head_branch: 'staging',
    head_sha: shaB,
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
  };
  assert.equal(selectExactCertificationRun([run], repository, shaB).id, 10);
  assert.throws(
    () => selectExactCertificationRun([{ ...run, head_sha: shaA }], repository, shaB),
    /No successful exact-SHA/
  );
  assert.equal(
    selectExactCertificateArtifact([
      { id: 12, name: `staging-certification-${shaB}`, expired: false },
    ], shaB).id,
    12
  );
});

test('checkout drain must exceed both approved app maximum and live ALB idle timeout', () => {
  const topology = { loadBalancer: { idleTimeoutSeconds: 60 } };
  assert.deepEqual(
    validateDrainConfiguration({ drainSeconds: '331', maxRequestSeconds: '300', topology }),
    {
      drainSeconds: 331,
      maxRequestSeconds: 300,
      albIdleTimeoutSeconds: 60,
      approved: true,
    }
  );
  assert.throws(
    () => validateDrainConfiguration({ drainSeconds: '300', maxRequestSeconds: '300', topology }),
    /longer than the approved maximum/
  );
});

function response(status, json, headers = {}) {
  return {
    status,
    headers: new Headers(headers),
    async json() { return json; },
  };
}

function publicFetch(observedSha, checkoutStatus = 401, legacyPaymentStatus = 404) {
  return async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    const method = options.method || 'GET';
    if (pathname === '/api/orders/initiate') return response(checkoutStatus, {});
    if (pathname === '/api/payments/create-payment-intent') return response(legacyPaymentStatus, {});
    if (WEBHOOK_PATHS.includes(pathname)) return response(400, {});
    if (pathname === '/api/users/auth/check') return response(401, {});
    if (pathname === '/api/featured-products' && method === 'OPTIONS') {
      return response(204, {}, { 'access-control-allow-origin': options.headers.Origin });
    }
    if (pathname === '/api/featured-products') return response(200, {});
    if (['/api/health', '/api/ready', '/api/build-info'].includes(pathname)) {
      return response(200, {
        release: {
          commit: observedSha.slice(0, 7),
          environment: 'production',
          deploymentVersion: `mosaic-${observedSha}`,
        },
      });
    }
    throw new Error(`Unexpected request ${method} ${pathname}`);
  };
}

test('public preflight is status-only, verifies all webhook/CORS surfaces, and detects old version', async () => {
  const result = await verifyProductionPublicSurfaces({
    mode: 'preflight',
    baseUrl: 'https://api.example.test',
    expectedSha: shaA,
    legacyRetirementSha: shaB,
    legacyReconciliationSha256: 'c'.repeat(64),
    fetchImpl: publicFetch(shaB),
  });
  assert.equal(result.alreadyDeployed, false);
  assert.equal(result.webhooks, 'success');
  assert.equal(result.legacyPaymentStatus, 404);
  assert.equal(CORS_ORIGINS.length, 6);
});

test('public preflight requires the deployed retirement SHA and blocks a reachable legacy payment route', async () => {
  await assert.rejects(
    verifyProductionPublicSurfaces({
      mode: 'preflight',
      baseUrl: 'https://api.example.test',
      expectedSha: shaA,
      legacyRetirementSha: shaB,
      legacyReconciliationSha256: 'c'.repeat(64),
      fetchImpl: publicFetch(shaB, 401, 401),
    }),
    /Legacy payment-intent route is still reachable/
  );
  const descendant = await verifyProductionPublicSurfaces({
    mode: 'preflight',
    baseUrl: 'https://api.example.test',
    expectedSha: shaA,
    legacyRetirementSha: shaA,
    legacyReconciliationSha256: 'c'.repeat(64),
    fetchImpl: publicFetch(shaB),
  });
  assert.equal(descendant.legacyPaymentCutover.retirementSha, shaA);
});

test('production preflight blocks the legacy payment-intent checkout bypass', () => {
  const canonicalApp = "app.use('/api/orders', orderRoutes);";
  const canonicalOrders = "const router=express.Router(); router.post('/initiate', authenticate, handler);";
  const blocked = analyzeCheckoutSurface({
    appSource: `${canonicalApp} app.use('/api/payments', paymentRoutes);`,
    paymentRoutesSource: "router.post('/create-payment-intent', authenticate, handler);",
    orderRoutesSource: canonicalOrders,
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.legacyPaymentSurfaceActive, true);
  assert.equal(blocked.productionMutation, false);

  const safe = analyzeCheckoutSurface({
    appSource: `${canonicalApp} app.use('/api/payments', paymentRoutes);`,
    paymentRoutesSource: "router.get('/status', handler);",
    orderRoutesSource: canonicalOrders,
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(safe.status, 'passed');

  const alternateRouter = analyzeCheckoutSurface({
    appSource: `${canonicalApp} app.use('/api/v2', alternateRouter);`,
    paymentRoutesSource: '',
    orderRoutesSource: canonicalOrders,
    runtimeRouteSources: [
      `${canonicalApp} app.use('/api/v2', alternateRouter);`,
      "alternateRouter.post('/create-payment-intent', authenticate, handler);",
    ],
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(alternateRouter.status, 'blocked');

  const mixedCaseRoute = analyzeCheckoutSurface({
    appSource: `${canonicalApp} app.use('/api/payments', paymentRoutes);`,
    paymentRoutesSource: "router.post('/Create-Payment-Intent', authenticate, handler);",
    orderRoutesSource: canonicalOrders,
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(mixedCaseRoute.status, 'blocked');

  const importedConstant = analyzeCheckoutSurface({
    appSource: `${canonicalApp} app.use('/api', apiRoutes);`,
    paymentRoutesSource: '',
    orderRoutesSource: canonicalOrders,
    runtimeRouteSources: [
      `${canonicalApp} app.use('/api', apiRoutes);`,
      "const router = express.Router(); router.post(LEGACY_PAYMENT_PATH, authenticate, handler);",
      "module.exports = { LEGACY_PAYMENT_PATH: '/payments/create-payment-intent' };",
    ],
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(importedConstant.status, 'blocked');
  assert.equal(importedConstant.dynamicPostPathRegistrationCount, 1);

  const literalAlternate = analyzeCheckoutSurface({
    appSource: `const app = express(); ${canonicalApp} app.use('/api', apiRoutes);`,
    paymentRoutesSource: '',
    orderRoutesSource: canonicalOrders,
    runtimeRouteSources: [
      `const app = express(); ${canonicalApp} app.use('/api', apiRoutes);`,
      "const apiRoutes = express.Router(); apiRoutes.post('/safe-literal', handler);",
    ],
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(literalAlternate.status, 'passed');
  assert.equal(literalAlternate.dynamicPostPathRegistrationCount, 0);

  for (const hiddenDynamicRoute of [
    "const router=require('express').Router(); const a='/create-'; router.post(a+'payment-intent', handler);",
    "const { Router }=require('express'); const router=Router(); const a='/create-'; router.post(a+'payment-intent', handler);",
    "const router=express.Router(); const a='/create-'; router['post'](a+'payment-intent', handler);",
  ]) {
    const hidden = analyzeCheckoutSurface({
      appSource: `${canonicalApp} app.use('/api/payments', router);`,
      paymentRoutesSource: '',
      orderRoutesSource: canonicalOrders,
      runtimeRouteSources: [`${canonicalApp} app.use('/api/payments', router);`, hiddenDynamicRoute],
      clock: () => new Date('2026-08-13T00:00:00.000Z'),
    });
    assert.equal(hidden.status, 'blocked');
    assert.equal(hidden.dynamicPostPathRegistrationCount, 1);
  }

  const outboundHttp = analyzeCheckoutSurface({
    appSource: `const app = express(); ${canonicalApp} app.post('/safe', handler);`,
    paymentRoutesSource: '',
    orderRoutesSource: canonicalOrders,
    runtimeRouteSources: [
      `const app = express(); ${canonicalApp} app.post('/safe', handler);`,
      "const axios = require('axios'); axios.post(REMOTE_URL, payload);",
    ],
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(outboundHttp.status, 'passed');

  const genericAuthOnly = analyzeCheckoutSurface({
    appSource: "const app=express(); app.use('/api/orders', (_req,res)=>res.sendStatus(401));",
    paymentRoutesSource: '',
    orderRoutesSource: '',
    runtimeRouteSources: ["const app=express(); app.use('/api/orders', (_req,res)=>res.sendStatus(401));"],
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(genericAuthOnly.status, 'blocked');
  assert.equal(genericAuthOnly.canonicalRoutePresent, false);

  const commentedOutCanonical = analyzeCheckoutSurface({
    appSource: [
      "// app.use('/api/orders', orderRoutes);",
      "const app=express(); app.use('/api/orders', (_req,res)=>res.sendStatus(401));",
    ].join('\n'),
    paymentRoutesSource: '',
    orderRoutesSource: "// router.post('/initiate', authenticate, handler);",
    runtimeRouteSources: [
      "// app.use('/api/orders', orderRoutes);\nconst app=express(); app.use('/api/orders', (_req,res)=>res.sendStatus(401));",
    ],
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(commentedOutCanonical.status, 'blocked');
  assert.equal(commentedOutCanonical.canonicalMountPresent, false);
  assert.equal(commentedOutCanonical.canonicalRoutePresent, false);
});

test('exact-target route-table proof rejects a generic 401 mount without the checkout route', () => {
  const matcher = (requestPath) => requestPath.startsWith('/api/orders')
    ? { path: '/api/orders', params: {} }
    : false;
  const genericOnly = Object.assign(() => {}, {
    router: { stack: [{ matchers: [matcher], handle: () => {} }] },
  });
  assert.equal(hasCanonicalPostRoute(genericOnly), false);

  const canonical = Object.assign(() => {}, {
    router: {
      stack: [{
        matchers: [matcher],
        handle: {
          stack: [{ route: { path: '/initiate', methods: { post: true } } }],
        },
      }],
    },
  });
  assert.equal(hasCanonicalPostRoute(canonical), true);

  canonical.router.stack[0].handle.stack[0].route.methods = { get: true };
  assert.equal(hasCanonicalPostRoute(canonical), false);
});

test('fresh exact-target runtime proof requires canonical auth and retired legacy 404/405', async () => {
  const statuses = new Map([
    ['/api/orders/initiate', 401],
    ['/api/orders/initiate/', 401],
    ['/API/ORDERS/INITIATE', 401],
    ['/Api/Orders/Initiate/', 401],
    ['/api/payments/create-payment-intent', 404],
    ['/api/payments/create-payment-intent/', 405],
    ['/API/PAYMENTS/CREATE-PAYMENT-INTENT', 404],
    ['/Api/Payments/Create-Payment-Intent/', 404],
  ]);
  const passed = await verifyTargetCheckoutStatuses(async (routePath) => statuses.get(routePath));
  assert.equal(passed.status, 'passed');

  statuses.set('/api/payments/create-payment-intent', 401);
  await assert.rejects(
    verifyTargetCheckoutStatuses(async (routePath) => statuses.get(routePath)),
    /retired legacy payment-intent route/
  );
  statuses.set('/api/payments/create-payment-intent', 404);
  statuses.set('/Api/Orders/Initiate/', 404);
  await assert.rejects(
    verifyTargetCheckoutStatuses(async (routePath) => statuses.get(routePath)),
    /canonical checkout behind its auth guard/
  );
});

test('exact deployed proof and ungate proof fail closed', async () => {
  await assert.rejects(
    verifyProductionPublicSurfaces({
      mode: 'deployed',
      baseUrl: 'https://api.example.test',
      expectedSha: shaA,
      fetchImpl: publicFetch(shaB),
    }),
    /does not match expected exact SHA/
  );
  await assert.rejects(
    verifyProductionPublicSurfaces({
      mode: 'ungated',
      baseUrl: 'https://api.example.test',
      expectedSha: shaA,
      fetchImpl: publicFetch(shaA, 503),
    }),
    /not in normal application state/
  );
  await assert.rejects(
    verifyProductionPublicSurfaces({
      mode: 'deployed',
      baseUrl: 'https://api.example.test',
      expectedSha: shaA,
      fetchImpl: publicFetch(shaA, 503, 401),
    }),
    /Legacy payment-intent route is still reachable/
  );
});

test('controlled EB deploy script archives only the exact target tree with canonical runtime identity', () => {
  const source = fs.readFileSync(deployScriptPath, 'utf8');
  assert.match(source, /CONTROLLER_SHA=\$\(git rev-parse --verify HEAD\^\{commit\}\)/);
  assert.match(source, /VERSION_LABEL="mosaic-\$RELEASE_SHA"/);
  assert.match(source, /git archive[\s\S]*--add-virtual-file="release-manifest\.json:\$manifest_json"[\s\S]*"\$RELEASE_SHA"/);
  assert.match(source, /sourceTree,[\s\S]*environment: 'production',[\s\S]*deploymentVersion/);
  assert.match(source, /package_source="exact-git-tree"/);
  assert.doesNotMatch(source, /zip\s+-[^\n]*-r|shopt\s+-s\s+dotglob/);
  assert.match(source, /elasticbeanstalk create-application-version/);
  assert.match(source, /elasticbeanstalk update-environment/);
  assert.doesNotMatch(source, /aws_access_key|aws_secret_key|beanstalk-deploy@/i);
});

test('git-tree packaging primitive is deterministic and excludes mutable untracked evidence', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-archive-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: temporary, encoding: 'utf8' });
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  run('git', ['init', '--quiet']);
  fs.writeFileSync(path.join(temporary, 'app.js'), 'module.exports = "tracked";\n');
  run('git', ['add', 'app.js']);
  run('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  const sha = run('git', ['rev-parse', 'HEAD']);
  const sourceTree = run('git', ['rev-parse', `${sha}^{tree}`]);
  fs.mkdirSync(path.join(temporary, 'release-evidence'));
  fs.writeFileSync(path.join(temporary, 'release-evidence', 'secret.json'), '{"secret":true}\n');
  fs.writeFileSync(path.join(temporary, 'untracked-secret.env'), 'SECRET=not-packaged\n');
  const manifest = JSON.stringify({
    schemaVersion: 1,
    commit: sha,
    sourceTree,
    environment: 'production',
    deploymentVersion: `mosaic-${sha}`,
  });
  const archiveA = path.join(temporary, 'a.tar');
  const archiveB = path.join(temporary, 'b.tar');
  for (const output of [archiveA, archiveB]) {
    run('git', [
      'archive', '--format=tar', `--output=${output}`,
      `--add-virtual-file=release-manifest.json:${manifest}`, sha,
    ]);
  }
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(digest(archiveA), digest(archiveB));
  const listing = run('tar', ['-tf', archiveA]).split(/\r?\n/);
  assert.deepEqual(listing.sort(), ['app.js', 'release-manifest.json']);
  assert.deepEqual(JSON.parse(run('tar', ['-xOf', archiveA, 'release-manifest.json'])), {
    schemaVersion: 1,
    commit: sha,
    sourceTree,
    environment: 'production',
    deploymentVersion: `mosaic-${sha}`,
  });
});

test('pinned release bucket is mandatory and validated before bundle preparation', (t) => {
  const gitExecutable = process.platform === 'win32'
    ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0] : null;
  const bashCommand = gitExecutable
    ? path.resolve(path.dirname(gitExecutable), '../bin/bash.exe') : 'bash';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-pinned-bucket-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const runGit = (...args) => {
    const result = spawnSync('git', args, { cwd: temporary, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runGit('init', '--quiet');
  runGit('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(temporary, 'app.js'), 'module.exports = "fixture";\n');
  runGit('add', 'app.js');
  runGit('-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const sha = runGit('rev-parse', 'HEAD');
  assert.match(sha, /^[a-f0-9]{40}$/);
  runGit('update-ref', 'refs/remotes/origin/main', sha);
  fs.mkdirSync(path.join(temporary, 'scripts/release'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'scripts/release/validate-eb-source-bundle.py'),
    path.join(temporary, 'scripts/release/validate-eb-source-bundle.py'));
  const source = fs.readFileSync(deployScriptPath, 'utf8');
  // Execute the actual storage/package preparation path with mocked AWS only.
  // Stop before the gate/deployment phase; real Git and bundle validation run.
  fs.writeFileSync(path.join(temporary, 'deploy-fixture.sh'),
    source.slice(0, source.indexOf('\nwrite_deployment_evidence() {')).replaceAll('\r\n', '\n'));
  fs.writeFileSync(path.join(temporary, 'harness.sh'), `
git() { if [ "$1" = fetch ]; then return 0; fi; command git "$@"; }
python3() { command ${process.platform === 'win32' ? 'python' : 'python3'} "$@"; }
node() {
  if [ "$1" = scripts/release/require-eb-application-version.js ]; then return 0; fi
  command node "$@"
}
fake_aws() {
  printf '%s\\n' "$*" >> aws-calls.txt
  case "$1 $2" in
    's3api get-bucket-location')
      if [ "$FIXTURE_INACCESSIBLE" = true ]; then echo 'sensitive AWS failure' >&2; return 42; fi
      printf '%s\\n' "$FIXTURE_LOCATION" ;;
    'elasticbeanstalk describe-application-versions')
      if [[ "$*" == *length* ]]; then echo "$FIXTURE_EXISTING";
      else echo "$FIXTURE_SOURCE_BUCKET historical-baseline.zip"; fi ;;
    's3api put-object'|'elasticbeanstalk create-application-version') echo '{}' ;;
    's3api head-object')
      if [ "$FIXTURE_BAD_CHECKSUM" = true ]; then echo 'invalid-checksum invalid-release invalid-package';
      else printf '%s %s %s\\n' "$package_checksum_b64" "$RELEASE_SHA" "$package_sha"; fi ;;
    's3api get-object')
      for argument in "$@"; do
        if [[ "$argument" == *.zip && "$argument" != historical-baseline.zip ]]; then
          cp historical.zip "$argument"; break
        fi
      done ;;
    *) echo 'Unexpected mock AWS operation' >&2; return 43 ;;
  esac
}
source ./deploy-fixture.sh ${sha}
`);
  const invoke = (overrides = {}) => {
    fs.writeFileSync(path.join(temporary, 'aws-calls.txt'), '');
    const fixtureEnv = { AWS_REGION: 'us-east-1', EB_APPLICATION_NAME: 'fixture',
      EB_ENVIRONMENT_NAME: 'fixture', EB_RELEASE_BUCKET: 'fixture-release-bucket',
      AWS_CLI: 'fake_aws', RELEASE_MODE: 'release', FIXTURE_SHA: sha,
      FIXTURE_LOCATION: 'None', FIXTURE_EXISTING: '0', FIXTURE_INACCESSIBLE: 'false',
      FIXTURE_SOURCE_BUCKET: 'fixture-release-bucket', FIXTURE_BAD_CHECKSUM: 'false', ...overrides };
    const assignments = Object.entries(fixtureEnv)
      .map(([key, value]) => `${key}='${value.replaceAll("'", "'\\''")}'`).join(' ');
    const result = spawnSync(bashCommand, ['-c', `${assignments} bash harness.sh`], {
      cwd: temporary, encoding: 'utf8', timeout: 20000,
    });
    return { ...result, calls: fs.readFileSync(path.join(temporary, 'aws-calls.txt'), 'utf8') };
  };
  for (const bucket of ['', 'INVALID_BUCKET']) {
    const result = invoke({ EB_RELEASE_BUCKET: bucket });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.calls, '');
  }
  const inaccessible = invoke({ FIXTURE_INACCESSIBLE: 'true' });
  assert.equal(inaccessible.status, 1, inaccessible.stderr);
  assert.match(inaccessible.stderr, /Unable to read pinned release bucket location/);
  assert.doesNotMatch(inaccessible.stderr, /sensitive AWS failure/);
  assert.doesNotMatch(inaccessible.calls, /put-object|create-application-version/);
  const wrongRegion = invoke({ FIXTURE_LOCATION: 'us-west-2' });
  assert.equal(wrongRegion.status, 1);
  assert.match(wrongRegion.stderr, /bucket region does not match/);
  assert.doesNotMatch(wrongRegion.calls, /put-object|create-application-version/);
  for (const location of ['None', 'null', '']) {
    const result = invoke({ FIXTURE_LOCATION: location });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, new RegExp(`s3api put-object .*--key mosaic-releases/${sha}/[a-f0-9]{64}\\.zip`));
    assert.match(result.calls, /s3api head-object .*--checksum-mode ENABLED/);
    assert.match(result.calls, /--metadata release-sha=.*package-sha256=/);
  }
  const focused = invoke({ RELEASE_MODE: 'focused-baseline',
    FOCUSED_BASELINE_SHA: FOCUSED_BASELINE_SHA,
    FOCUSED_RELEASE_REF: 'refs/heads/release/focused/booking-filter' });
  assert.equal(focused.status, 0, focused.stderr);
  assert.match(focused.calls, new RegExp(`s3api put-object .*--key mosaic-releases/${sha}/[a-f0-9]{64}\\.zip`));
  const badChecksum = invoke({ FIXTURE_BAD_CHECKSUM: 'true' });
  assert.equal(badChecksum.status, 1);
  assert.match(badChecksum.stderr, /Stored deployment package checksum or identity metadata does not match/);
  const wrongBucket = invoke({ RELEASE_MODE: 'rollback', FIXTURE_EXISTING: '1',
    EB_RELEASE_BUCKET: 'wrong-release-bucket' });
  assert.equal(wrongBucket.status, 1);
  assert.match(wrongBucket.stderr, /outside the controlled bucket/);
  assert.doesNotMatch(wrongBucket.calls, /get-object|put-object|create-application-version/);
  const tree = runGit('rev-parse', `${sha}^{tree}`);
  const manifest = JSON.stringify({ schemaVersion: 1, commit: sha, sourceTree: tree,
    environment: 'production', deploymentVersion: `mosaic-${sha}` });
  runGit('archive', '--format=zip', '--output=historical.zip',
    `--add-virtual-file=release-manifest.json:${manifest}`, sha);
  const rollback = invoke({ RELEASE_MODE: 'rollback', FIXTURE_EXISTING: '1' });
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.match(rollback.calls, /s3api get-object .*--key historical-baseline.zip/);
  assert.doesNotMatch(rollback.calls, /put-object|create-application-version/);
});

test('release storage contract removes creation and exposes a required Environment bucket', () => {
  const source = fs.readFileSync(deployScriptPath, 'utf8');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(source, /create-storage-location|create-bucket|list-buckets|list-objects|delete-object/);
  assert.match(source, /EB_RELEASE_BUCKET_VALUE="\$\{EB_RELEASE_BUCKET:-\}"/);
  assert.match(workflow, /EB_RELEASE_BUCKET: \$\{\{ vars\.EB_RELEASE_BUCKET \}\}/);
  assert.match(workflow, /if \[ -z "\$EB_RELEASE_BUCKET" \]/);
  assert.ok(source.indexOf('s3api get-bucket-location') < source.indexOf('s3api put-object'));
  assert.match(source, /Stored deployment package checksum or identity metadata does not match/);
  assert.match(source, /Exact-tree source bundle changed during deployment/);
});

test('deploy evidence is persisted as attempted before update and verified only after readiness', () => {
  const source = fs.readFileSync(deployScriptPath, 'utf8');
  const firstFreshnessCall = source.indexOf('\nassert_current_main\n');
  const lastFreshnessCall = source.lastIndexOf('\nassert_current_main\n');
  const artifactMutation = source.indexOf('$AWS_CLI s3api put-object');
  const attempted = source.indexOf('write_deployment_evidence attempted false');
  const update = source.indexOf('$AWS_CLI elasticbeanstalk update-environment');
  const readinessFailure = source.indexOf('if [ "$ready" != "true" ]');
  const verified = source.indexOf('write_deployment_evidence passed true');
  const processed = source.indexOf('require-eb-application-version.js');
  const finalGateProof = source.indexOf('gate-before-update-environment.json');
  assert.ok(firstFreshnessCall > 0 && firstFreshnessCall < artifactMutation);
  assert.ok(processed > artifactMutation && processed < finalGateProof);
  assert.ok(finalGateProof < lastFreshnessCall);
  assert.ok(lastFreshnessCall > artifactMutation && lastFreshnessCall < attempted);
  assert.ok(attempted < update);
  assert.ok(update < readinessFailure && readinessFailure < verified);
  assert.match(source, /deploymentAttempted: true/);
  assert.match(source, /deploymentVerified: verified === 'true'/);
});

test('EB application version must transition to Processed and reused Failed versions stop', async () => {
  const config = {
    applicationName: 'mosaic-biz-hub-backend',
    versionLabel: `mosaic-${shaA}`,
    region: 'us-east-1',
    timeoutSeconds: 10,
    pollSeconds: 1,
  };
  let reads = 0;
  const runAws = () => ({
    ApplicationVersions: [{
      VersionLabel: config.versionLabel,
      Status: ++reads === 1 ? 'Processing' : 'Processed',
    }],
  });
  const result = await requireProcessedVersion(config, {
    runAws,
    wait: async () => {},
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });
  assert.equal(reads, 2);
  assert.equal(result.applicationVersionStatus, 'Processed');

  await assert.rejects(
    requireProcessedVersion(config, {
      runAws: () => ({ ApplicationVersions: [{
        VersionLabel: config.versionLabel,
        Status: 'Failed',
      }] }),
    }),
    /not deployable \(Failed\)/
  );

  await assert.rejects(
    requireProcessedVersion(config, {
      runAws: () => ({ ApplicationVersions: [{
        VersionLabel: config.versionLabel,
        Status: 'Unprocessed',
      }] }),
    }),
    /not deployable \(Unprocessed\)/
  );
  const historical = await requireProcessedVersion(
    { ...config, allowUnprocessedReused: true },
    {
      runAws: () => ({ ApplicationVersions: [{
        VersionLabel: config.versionLabel,
        Status: 'Unprocessed',
      }] }),
    }
  );
  assert.equal(historical.historicalRollbackCompatibility, true);
  const deploySource = fs.readFileSync(deployScriptPath, 'utf8');
  assert.match(deploySource, /historical-eb-source-bundle[\s\S]*--allow-unprocessed-reused/);
});

test('rollback reuses and hashes the historical EB bundle after validating every member against Git', () => {
  const source = fs.readFileSync(deployScriptPath, 'utf8');
  assert.match(source, /RELEASE_MODE_VALUE="\$\{RELEASE_MODE:-release\}"/);
  assert.match(source, /git merge-base --is-ancestor "\$RELEASE_SHA" "\$CONTROLLER_SHA"/);
  assert.match(source, /package_source="historical-eb-source-bundle"/);
  assert.match(source, /s3api get-object[\s\S]*validate_embedded_manifest "\$reused_bundle_path"/);
  assert.match(source, /validate-eb-source-bundle\.py/);
  assert.match(source, /package_sha=\$\(sha256_file "\$reused_bundle_path"\)/);
  assert.match(source, /Historical source bundle changed during deployment/);
});

test('EB source-bundle validator accepts an exact Git archive and rejects extra or root-hook code', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-eb-bundle-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { cwd: temporary, encoding: 'utf8', ...options });
    return result;
  };
  assert.equal(run('git', ['init', '--quiet']).status, 0);
  assert.equal(run('git', ['config', 'core.autocrlf', 'false']).status, 0);
  fs.writeFileSync(path.join(temporary, 'app.js'), 'module.exports = "exact";\n');
  assert.equal(run('git', ['add', 'app.js']).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid',
    'commit', '--quiet', '-m', 'fixture']).status, 0);
  const sha = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const sourceTree = run('git', ['rev-parse', `${sha}^{tree}`]).stdout.trim();
  const version = `mosaic-${sha}`;
  const manifest = JSON.stringify({
    schemaVersion: 1, commit: sha, sourceTree, environment: 'production', deploymentVersion: version,
  });
  const exactZip = path.join(temporary, 'exact.zip');
  const extraZip = path.join(temporary, 'extra.zip');
  assert.equal(run('git', ['archive', '--format=zip', `--output=${exactZip}`,
    `--add-virtual-file=release-manifest.json:${manifest}`, sha]).status, 0);
  assert.equal(run('git', ['archive', '--format=zip', `--output=${extraZip}`,
    `--add-virtual-file=release-manifest.json:${manifest}`, '--add-virtual-file=evil.js:tampered', sha]).status, 0);

  const hookDirectory = path.join(temporary, '.platform', 'hooks', 'predeploy');
  fs.mkdirSync(hookDirectory, { recursive: true });
  fs.writeFileSync(path.join(hookDirectory, '00-root.sh'), '#!/usr/bin/env bash\nexit 0\n');
  assert.equal(run('git', ['add', '.platform/hooks/predeploy/00-root.sh']).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid',
    'commit', '--quiet', '-m', 'root hook fixture']).status, 0);
  const hookSha = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const hookTree = run('git', ['rev-parse', `${hookSha}^{tree}`]).stdout.trim();
  const hookVersion = `mosaic-${hookSha}`;
  const hookManifest = JSON.stringify({
    schemaVersion: 1, commit: hookSha, sourceTree: hookTree,
    environment: 'production', deploymentVersion: hookVersion,
  });
  const hookZip = path.join(temporary, 'root-hook.zip');
  assert.equal(run('git', ['archive', '--format=zip', `--output=${hookZip}`,
    `--add-virtual-file=release-manifest.json:${hookManifest}`, hookSha]).status, 0);
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const prefix = process.platform === 'win32' ? ['-3'] : [];
  const validator = path.join(repoRoot, 'scripts/release/validate-eb-source-bundle.py');
  const args = (bundle) => [...prefix, validator, '--bundle', bundle, '--release-sha', sha,
    '--source-tree', sourceTree, '--version-label', version];
  const accepted = run(python, args(exactZip));
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).bundlePolicy, 'exact-git-tree');
  const rejected = run(python, args(extraZip));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /members differ from the Git tree/);
  const hookRejected = run(python, [...prefix, validator, '--bundle', hookZip,
    '--release-sha', hookSha, '--source-tree', hookTree, '--version-label', hookVersion]);
  assert.notEqual(hookRejected.status, 0);
  assert.match(hookRejected.stderr, /root-executed deployment configuration/);
});

function writeEvidenceFile(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value)}\n`);
}

test('missing final gate proof is unknown and must be treated active even before a recorded mutation', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidence = buildProductionEvidence({
    directory, releaseSha: shaA, jobStatus: 'failure', runUrl: 'https://github.example/run/0',
  });
  assert.equal(evidence.productionMutation, false);
  assert.equal(evidence.gate.mutationAttempted, false);
  assert.equal(evidence.gate.finalState, 'unknown');
  assert.equal(evidence.gate.finalStateVerified, false);
  assert.equal(evidence.checkoutGate, 'UNKNOWN_TREAT_ACTIVE');
});

test('gate attempt marker records mutation risk even when enable evidence was never written', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeEvidenceFile(directory, 'aws-approved-preflight.json', {
    status: 'passed', releaseSha: shaA, topology: {}, loadBalancer: {},
  });
  writeEvidenceFile(directory, 'gate-attempt.json', {
    schemaVersion: 1, status: 'attempted', operation: 'enable',
  });
  const evidence = buildProductionEvidence({
    directory, releaseSha: shaA, jobStatus: 'cancelled', runUrl: 'https://github.example/run/gate',
  });
  assert.equal(evidence.productionMutation, true);
  assert.equal(evidence.gate.mutationAttempted, true);
  assert.equal(evidence.gate.activation, 'not-verified');
  assert.equal(evidence.checkoutGate, 'UNKNOWN_TREAT_ACTIVE');
  assert.equal(evidence.failingPhase, 'checkout-gate-enable');
});

test('workflow results identify the exact earliest failed preapproval phase', (t) => {
  const phases = [
    ['resolve', 'release-resolution'],
    ['exactCi', 'exact-sha-ci'],
    ['targetCheckoutSurface', 'exact-target-checkout-surface'],
    ['sourceCertificate', 'staging-source-certificate'],
    ['publicPreflight', 'public-preflight'],
    ['awsPreflight', 'aws-preflight'],
    ['readiness', 'production-readiness'],
  ];
  for (const [failedJob, expectedPhase] of phases) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-evidence-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const jobs = Object.fromEntries(phases.map(([job]) => [job, 'success']));
    jobs[failedJob] = 'failure';
    writeEvidenceFile(directory, 'workflow-results.json', {
      schemaVersion: 1, normalRelease: true, jobs,
    });
    const evidence = buildProductionEvidence({
      directory, releaseSha: shaA, jobStatus: 'failure', runUrl: 'https://github.example/run/preflight',
    });
    assert.equal(evidence.failingPhase, expectedPhase, failedJob);
    assert.equal(evidence.preApproval.failingPhase, expectedPhase, failedJob);
    assert.equal(evidence.preApproval.workflowJobs[failedJob], 'failure', failedJob);
    if (failedJob === 'exactCi') assert.equal(evidence.tests.unit, 'failure');
  }
});

test('rollback treats skipped source certification as expected in workflow results', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeEvidenceFile(directory, 'workflow-results.json', {
    schemaVersion: 1,
    normalRelease: false,
    jobs: {
      resolve: 'success', exactCi: 'success', targetCheckoutSurface: 'success', sourceCertificate: 'skipped',
      publicPreflight: 'failure', awsPreflight: 'success', readiness: 'skipped',
    },
  });
  const evidence = buildProductionEvidence({
    directory, releaseSha: shaA, jobStatus: 'failure', runUrl: 'https://github.example/run/rollback',
  });
  assert.equal(evidence.failingPhase, 'public-preflight');
  assert.equal(evidence.preApproval.sourceCertificate, 'skipped');
});

test('focused evidence keeps certification separate from deployment and rejects missing source proof', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-focused-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const focusedSource = {
    baselineSha: FOCUSED_BASELINE_SHA,
    releaseRef: 'refs/heads/release/focused/booking-filter',
    sourcePr: 290,
  };
  writeEvidenceFile(directory, 'release-identity.json', {
    mode: 'focused-baseline', releaseSha: shaA, focusedSource,
  });
  writeEvidenceFile(directory, 'workflow-results.json', {
    schemaVersion: 1, releaseMode: 'focused-baseline',
    jobs: {
      resolve: 'success', exactCi: 'success', targetCheckoutSurface: 'success',
      sourceCertificate: 'success', publicPreflight: 'success', awsPreflight: 'success',
      readiness: 'success', production: 'skipped',
    },
  });
  let evidence = buildProductionEvidence({
    directory, releaseSha: shaA, releaseMode: 'focused-baseline', jobStatus: 'success',
  });
  assert.equal(evidence.failingPhase, 'focused-source-certificate-artifact');
  assert.equal(evidence.focusedBaseline.readOnlyPreflightPassed, false);
  assert.equal(evidence.preApproval.sourceCertificate, 'not-proven');
  writeEvidenceFile(directory, 'source-certificate.json', {
    schemaVersion: 1, mode: 'focused-baseline', status: 'passed', repository, releaseSha: shaA,
    baselineSha: focusedSource.baselineSha, releaseRef: focusedSource.releaseRef,
    sourcePr: focusedSource.sourcePr, branchTipSha: shaA,
    sourceSha: 'bcb9f101c58df6d7df994e94442970b91f36e74c',
    rulesetBypassActorsVisible: false,
    productionAccepted: false,
    changedFiles: [
      { status: 'M', file: 'controllers/bookingController.js' },
      { status: 'A', file: 'tests/vendor/vendor-booking-type-filter.test.js' },
    ],
  });
  writeEvidenceFile(directory, 'exact-target-checkout-runtime.json', {
    status: 'passed', releaseMode: 'focused-baseline', releaseSha: shaA,
    canonicalRouteTableVerified: true, legacyRouteTableVerified: true,
  });
  writeEvidenceFile(directory, 'checkout-surface.json', {
    status: 'passed', releaseMode: 'focused-baseline',
    baselineProvenance: { verified: true, targetSha: shaA, baselineSha: FOCUSED_BASELINE_SHA },
  });
  writeEvidenceFile(directory, 'public-preflight.json', {
    mode: 'preflight', releaseMode: 'focused-baseline', expectedSha: shaA,
    observedSha: FOCUSED_BASELINE_SHA, checkoutStatus: 401, legacyPaymentStatus: 401,
  });
  writeEvidenceFile(directory, 'aws-preflight.json', {
    status: 'passed', phase: 'preflight', releaseSha: shaA,
  });
  evidence = buildProductionEvidence({
    directory, releaseSha: shaA, releaseMode: 'focused-baseline', jobStatus: 'success',
  });
  assert.equal(evidence.focusedBaseline.readOnlyPreflightPassed, true);
  assert.equal(evidence.failingPhase, 'focused-external-gates-not-complete');
  assert.equal(evidence.tests.unit, 'success');
  assert.equal(evidence.tests.contract, 'success');
  assert.equal(evidence.tests.integration, 'success');
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.productionMutation, false);
  assert.equal(evidence.preApproval.productionApprovalEntered, false);
  assert.equal(evidence.deployment.attempted, false);
  assert.equal(evidence.focusedBaseline.externalGates.paymentLiability, 'not-proven');
  assert.equal(evidence.focusedBaseline.externalGates.protectedRefNoBypass, 'proven');

  writeEvidenceFile(directory, 'aws-approved-preflight.json', { status: 'passed', releaseSha: shaA });
  writeEvidenceFile(directory, 'gate-enabled.json', { status: 'passed', gateState: 'active' });
  writeEvidenceFile(directory, 'drain-approved.json', { approved: true, drainSeconds: 331 });
  for (const name of ['reservations-before.json', 'reservations-after.json']) {
    writeEvidenceFile(directory, name, {
      status: 'passed', mode: 'require-zero', readOnly: true,
      activeReservationCount: 0, incompletePaidOrderCount: 0, unresolvedPaymentIntentCount: 0,
    });
  }
  writeEvidenceFile(directory, 'eb-deployment.json', {
    status: 'passed', releaseSha: shaA, versionLabel: `mosaic-${shaA}`,
    packageSha256: '4'.repeat(64), deploymentAttempted: true, deploymentVerified: true,
    sourceTree: '5'.repeat(40), packageSource: 'exact-git-tree', applicationVersion: 'created',
  });
  writeEvidenceFile(directory, 'aws-deployed.json', {
    status: 'passed', releaseSha: shaA, expectedVersion: `mosaic-${shaA}`,
    currentVersion: `mosaic-${shaA}`,
  });
  writeEvidenceFile(directory, 'public-deployed.json', {
    status: 'passed', expectedSha: shaA, observedSha: shaA,
  });
  writeEvidenceFile(directory, 'gate-final.json', { status: 'passed', gateState: 'active' });
  evidence = buildProductionEvidence({
    directory, releaseSha: shaA, releaseMode: 'focused-baseline', jobStatus: 'success',
  });
  assert.equal(evidence.status, 'success');
  assert.equal(evidence.failingPhase, null);
  assert.equal(evidence.focusedBaseline.productionApproval, 'entered');
  assert.equal(evidence.focusedBaseline.deployment, 'verified');
  assert.equal(evidence.focusedBaseline.externalGates.liveDualRouteGate, 'proven');
  assert.equal(evidence.focusedBaseline.externalGates.paymentLiability, 'proven');
  assert.equal(evidence.gate.finalState, 'active');
  assert.equal(evidence.gate.removal, 'focused-gate-remained-active');
  assert.equal(evidence.gate.normalCheckoutRestored, false);

  writeEvidenceFile(directory, 'workflow-results.json', {
    schemaVersion: 1, releaseMode: 'focused-baseline',
    jobs: {
      resolve: 'success', exactCi: 'failure', targetCheckoutSurface: 'success',
      sourceCertificate: 'success', publicPreflight: 'success', awsPreflight: 'success',
      readiness: 'skipped', production: 'skipped',
    },
  });
  evidence = buildProductionEvidence({
    directory, releaseSha: shaA, releaseMode: 'focused-baseline', jobStatus: 'failure',
  });
  assert.equal(evidence.failingPhase, 'exact-sha-ci');
  assert.equal(evidence.focusedBaseline.readOnlyPreflightPassed, false);
  assert.equal(evidence.tests.unit, 'failure');
});

test('focused deploy validates approved baseline and protected ref before AWS access', () => {
  const script = `RELEASE_MODE=focused-baseline FOCUSED_BASELINE_SHA=${shaB} FOCUSED_RELEASE_REF=refs/heads/release/focused/booking-filter AWS_CLI=this-command-must-never-be-called bash scripts/release/deploy-eb-exact-sha.sh ${shaA}`;
  const result = spawnSync('bash', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Focused target is not bound to the approved production baseline and protected ref/);
  assert.doesNotMatch(result.stderr, /this-command-must-never-be-called/);
});

test('timeout after update remains a blocked attempted but unverified deployment', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeEvidenceFile(directory, 'aws-approved-preflight.json', {
    status: 'passed', releaseSha: shaA, topology: {}, loadBalancer: {},
  });
  writeEvidenceFile(directory, 'gate-enabled.json', { status: 'passed', gateState: 'active' });
  writeEvidenceFile(directory, 'drain-approved.json', { approved: true, drainSeconds: 331 });
  writeEvidenceFile(directory, 'reservations-before.json', {
    status: 'passed', mode: 'require-zero', readOnly: true,
    activeReservationCount: 0, incompletePaidOrderCount: 0, unresolvedPaymentIntentCount: 0,
  });
  writeEvidenceFile(directory, 'eb-deployment.json', {
    status: 'attempted',
    releaseSha: shaA,
    versionLabel: `mosaic-${shaA}`,
    packageSha256: '1'.repeat(64),
    deploymentAttempted: true,
    deploymentVerified: false,
  });
  writeEvidenceFile(directory, 'gate-failure-safe.json', {
    status: 'passed', gateState: 'active',
  });

  const evidence = buildProductionEvidence({
    directory, releaseSha: shaA, jobStatus: 'failure', runUrl: 'https://github.example/run/1',
  });
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.failingPhase, 'elastic-beanstalk-deploy');
  assert.equal(evidence.productionMutation, true);
  assert.equal(evidence.deployment.attempted, true);
  assert.equal(evidence.deployment.verified, false);
  assert.equal(evidence.rollbackNeeded, true);
  assert.equal(evidence.checkoutGate, 'ACTIVE_VERIFIED');
});

test('successful evidence requires final inactive proof and zero reservations on both sides', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-evidence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeEvidenceFile(directory, 'aws-approved-preflight.json', {
    status: 'passed', releaseSha: shaA,
    environmentState: 'Ready/Green/Ok',
    currentVersion: `mosaic-${shaB}`,
    topology: { deploymentPolicy: 'AllAtOnce', minSize: 1, maxSize: 1, instanceCount: 1 },
    loadBalancer: { healthyTargetCount: 1 },
  });
  writeEvidenceFile(directory, 'gate-enabled.json', { status: 'passed', gateState: 'active' });
  writeEvidenceFile(directory, 'drain-approved.json', { approved: true, drainSeconds: 331 });
  for (const name of ['reservations-before.json', 'reservations-after.json']) {
    writeEvidenceFile(directory, name, {
      status: 'passed', mode: 'require-zero', readOnly: true,
      activeReservationCount: 0, incompletePaidOrderCount: 0, unresolvedPaymentIntentCount: 0,
    });
  }
  writeEvidenceFile(directory, 'eb-deployment.json', {
    status: 'passed', releaseSha: shaA, versionLabel: `mosaic-${shaA}`,
    packageSha256: '2'.repeat(64), deploymentAttempted: true, deploymentVerified: true,
    sourceTree: '3'.repeat(40), packageSource: 'exact-git-tree', applicationVersion: 'created',
  });
  writeEvidenceFile(directory, 'aws-deployed.json', {
    status: 'passed', releaseSha: shaA, expectedVersion: `mosaic-${shaA}`,
    currentVersion: `mosaic-${shaA}`,
  });
  writeEvidenceFile(directory, 'public-deployed.json', {
    expectedSha: shaA, observedSha: shaA,
  });
  writeEvidenceFile(directory, 'gate-disabled.json', { status: 'passed', gateState: 'inactive' });
  writeEvidenceFile(directory, 'gate-final.json', { status: 'passed', gateState: 'inactive' });
  writeEvidenceFile(directory, 'public-ungated.json', { expectedSha: shaA, observedSha: shaA });

  const evidence = buildProductionEvidence({
    directory, releaseSha: shaA, jobStatus: 'success', runUrl: 'https://github.example/run/2',
  });
  assert.equal(evidence.status, 'success');
  assert.equal(evidence.blocked, false);
  assert.equal(evidence.checkoutGate, 'INACTIVE_VERIFIED');
  assert.equal(evidence.gate.finalStateVerified, true);
  assert.equal(evidence.deployment.verified, true);
  assert.equal(evidence.reservations.beforeVerifiedZero, true);
  assert.equal(evidence.reservations.afterVerifiedZero, true);
});

test('production workflow is automatic-preflight then one approved serialized release and never auto-merges', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.match(workflow, /group: mosaic-production-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment:\s*\n\s+name: production-preflight/);
  assert.match(workflow, /name: production-release-control/);
  assert.match(workflow, /AWS_RELEASE_CONTROL_ROLE_TO_ASSUME/);
  assert.match(workflow, /WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}[\s\S]*--workflow-sha "\$WORKFLOW_SHA"/);
  assert.match(workflow, /Reconfirm trusted controller[\s\S]*WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}[\s\S]*"\$WORKFLOW_SHA" != "\$current_main"/);
  assert.match(workflow, /production-approval-and-release:[\s\S]*if: \$\{\{ !cancelled\(\)/);
  assert.match(workflow, /AWS_PREFLIGHT_ROLE_TO_ASSUME/);
  assert.match(workflow, /Checkout fresh exact target for runtime route proof[\s\S]*npm ci --ignore-scripts[\s\S]*probe-target-checkout-surface\.js/);
  assert.match(workflow, /release-readiness:[\s\S]*target-checkout-surface[\s\S]*needs\.target-checkout-surface\.result == 'success'/);
  assert.match(workflow, /Require approved checkout surface in exact target[\s\S]*--root release-target[\s\S]*Observe public production safely/);
  assert.match(workflow, /Bind retirement attestation to deployed and target ancestry[\s\S]*merge-base --is-ancestor/);
  assert.match(workflow, /Checkout exact release commit[\s\S]*persist-credentials: false/);
  assert.match(workflow, /verify-main-release-source\.js/);
  assert.match(workflow, /manage-checkout-gate\.js enable/);
  assert.match(workflow, /run-ssm-reservation-check\.js --require-zero/);
  assert.match(workflow, /deploy-eb-exact-sha\.sh/);
  assert.match(workflow, /manage-checkout-gate\.js disable/);
  assert.doesNotMatch(workflow, /gh pr merge|enable-auto-merge|pull_request_target/);
});

test('focused workflow requires exact target CI and source proof before protected production release', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /focused-baseline[\s\S]*baseline_sha:[\s\S]*release_ref:[\s\S]*source_pr:/);
  assert.match(workflow, /exact-ci:[\s\S]*ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}[\s\S]*run: npm ci[\s\S]*run: npm test[\s\S]*run: npm run test:contract[\s\S]*run: npm run test:integration/);
  assert.match(workflow, /Verify protected focused source and exact two-file provenance[\s\S]*verify-focused-release-source\.js/);
  assert.match(workflow, /production-approval-and-release:[\s\S]*if: \$\{\{[^\n]*release_mode != 'focused-baseline'/);
  assert.match(workflow, /Reassert safe gate after any post-enable failure/);
});

test('checkout-gate CLI inherits focused mode and still requires explicit live-mutation confirmation', () => {
  assert.equal(gateCli(gateVerifyArgs, { RELEASE_MODE: 'focused-baseline' }).releaseMode, 'focused-baseline');
  assert.throws(
    () => gateCli(['enable', '--output', 'gate-evidence.json'], { RELEASE_MODE: 'focused-baseline' }),
    /enable requires --confirm ENABLE_CHECKOUT_GATE/
  );
  assert.equal(gateCli(gateEnableArgs, { RELEASE_MODE: 'focused-baseline' }).releaseMode, 'focused-baseline');
});

test('checkout-gate CLI accepts matching focused flag and environment for confirmed mutation', () => {
  const focusedVerifyArgs = [...gateVerifyArgs, '--release-mode', 'focused-baseline'];
  const focusedEnableArgs = [...gateEnableArgs, '--release-mode', 'focused-baseline'];
  assert.equal(gateCli(focusedVerifyArgs, { RELEASE_MODE: 'focused-baseline' }).releaseMode, 'focused-baseline');
  assert.equal(gateCli(focusedEnableArgs, { RELEASE_MODE: 'focused-baseline' }).releaseMode, 'focused-baseline');
});

test('checkout-gate CLI rejects explicit release against inherited focused mode', () => {
  assert.throws(
    () => gateCli([...gateVerifyArgs, '--release-mode', 'release'], { RELEASE_MODE: 'focused-baseline' }),
    /--release-mode must match inherited RELEASE_MODE/
  );
});

test('checkout-gate CLI rejects explicit focused mode against inherited release', () => {
  assert.throws(
    () => gateCli([...gateVerifyArgs, '--release-mode', 'focused-baseline'], { RELEASE_MODE: 'release' }),
    /--release-mode must match inherited RELEASE_MODE/
  );
});

test('checkout-gate CLI keeps normal release and its documented no-mode default', () => {
  assert.equal(gateCli(gateEnableArgs, { RELEASE_MODE: 'release' }).releaseMode, 'release');
  assert.equal(gateCli(gateEnableArgs).releaseMode, 'release');
  assert.throws(
    () => gateCli(gateVerifyArgs, { RELEASE_MODE: '' }),
    /Unsupported checkout gate release mode/
  );
  assert.throws(
    () => gateCli([...gateVerifyArgs, '--release-mode', '']),
    /Unsupported checkout gate release mode/
  );
});

test('checkout-gate CLI keeps inherited rollback on the canonical gate path', () => {
  assert.equal(gateCli(gateEnableArgs, { RELEASE_MODE: 'rollback' }).releaseMode, 'release');
  assert.throws(
    () => gateCli([...gateVerifyArgs, '--release-mode', 'rollback'], { RELEASE_MODE: 'rollback' }),
    /Unsupported checkout gate release mode/
  );
});

test('trusted controller supports historical rollback targets and fail-safe gate recovery', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /ref: \$\{\{ needs\.resolve-release\.outputs\.current_main_sha \}\}[\s\S]*Reconfirm trusted controller/);
  assert.match(workflow, /Revalidate topology before mutation[\s\S]*Enable exact checkout gate[\s\S]*git fetch --no-tags origin main[\s\S]*echo "attempted=true"/);
  assert.match(workflow, /RELEASE_MODE.*rollback[\s\S]*merge-base --is-ancestor/);
  assert.match(workflow, /always\(\) && steps\.gate\.outputs\.attempted == 'true' && steps\.final-open\.outputs\.safe_open != 'true'/);
  assert.match(workflow, /Re-prove gate immediately before EB mutation[\s\S]*manage-checkout-gate\.js verify[\s\S]*verify-checkout-gate\.sh[\s\S]*Deploy immutable exact SHA/);
  assert.doesNotMatch(workflow, /production-approval-and-release:[\s\S]{0,500}pull-requests:\s*write/);
});

test('all trusted release-chain actions are pinned to immutable full SHAs', () => {
  const workflowNames = [
    'ci.yml',
    'staging-release-certification.yml',
    'staging-release-pr-controller.yml',
    'staging-release-status-publisher.yml',
    'deploy-eb-production.yml',
  ];
  for (const workflowName of workflowNames) {
    const source = fs.readFileSync(path.join(repoRoot, '.github/workflows', workflowName), 'utf8');
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
      assert.match(match[1], /^[^@\s]+@[a-f0-9]{40}$/, `${workflowName} has mutable action ${match[1]}`);
    }
  }
});
