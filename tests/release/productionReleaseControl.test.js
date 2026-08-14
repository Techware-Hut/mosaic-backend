'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/deploy-eb-production.yml');
const gateScriptPath = path.join(repoRoot, 'scripts/release/verify-checkout-gate.sh');
const instanceScriptPath = path.join(repoRoot, 'scripts/release/verify-eb-instance-versions.sh');
const reservationScriptPath = path.join(repoRoot, 'scripts/release/query-active-reservations.js');
const appPath = path.join(repoRoot, 'app.js');

function toBashPath(filePath) {
  return process.platform === 'win32'
    ? `/mnt/${filePath[0].toLowerCase()}${filePath.slice(2).replaceAll('\\', '/')}`
    : filePath;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

const gateBashPath = toBashPath(gateScriptPath);
const instanceBashPath = toBashPath(instanceScriptPath);

const workflow = fs.readFileSync(workflowPath, 'utf8');
const gateScript = fs.readFileSync(gateScriptPath, 'utf8');
const instanceScript = fs.readFileSync(instanceScriptPath, 'utf8');
const reservationScript = fs.readFileSync(reservationScriptPath, 'utf8');

const {
  verifyInstanceDeployments,
} = require('../../scripts/release/verify-eb-instance-deployments');
const {
  ACTIVE_RESERVATION_FILTER,
  parseMode,
  queryActiveReservations,
  run: runReservationDiagnostic,
} = require('../../scripts/release/query-active-reservations');

const webhookPaths = [
  '/api/webhooks/stripe',
  '/api/stripe/webhook',
  '/api/stripe/payment/webhook',
  '/api/subscription/webhook',
  '/api/vendor-onboarding/webhook/payment',
];
const healthPaths = ['/api/health', '/api/ready', '/api/build-info'];

function deployment(instanceId, sha, status = 'Deployed', deploymentId = 42) {
  return {
    InstanceId: instanceId,
    Deployment: {
      VersionLabel: `mosaic-${sha}`,
      DeploymentId: deploymentId,
      Status: status,
    },
  };
}

async function runGateWithStatuses(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(repoRoot, '.release-control-curl-test-'));
  const mockCurl = path.join(tempDir, 'mock-curl.sh');
  fs.writeFileSync(mockCurl, `#!/usr/bin/env bash
url="\${!#}"
case "$url" in
  */api/orders/initiate|*/api/orders/initiate/|*/API/ORDERS/INITIATE|*/Api/Orders/Initiate/) printf '%s' "\${MOCK_INITIATE_STATUS:-503}" ;;
  */api/webhooks/stripe) printf '%s' "\${MOCK_ORDER_WEBHOOK_STATUS:-400}" ;;
  */api/stripe/webhook) printf '%s' "\${MOCK_BUSINESS_WEBHOOK_STATUS:-400}" ;;
  */api/stripe/payment/webhook) printf '%s' "\${MOCK_PAYMENT_WEBHOOK_STATUS:-400}" ;;
  */api/subscription/webhook) printf '%s' "\${MOCK_SUBSCRIPTION_WEBHOOK_STATUS:-400}" ;;
  */api/vendor-onboarding/webhook/payment) printf '%s' "\${MOCK_VENDOR_WEBHOOK_STATUS:-400}" ;;
  */api/health|*/api/ready|*/api/build-info) printf '%s' "\${MOCK_HEALTH_STATUS:-200}" ;;
  *) printf '404' ;;
esac
`);
  fs.chmodSync(mockCurl, 0o755);

  const statusEnvironment = {
    'POST /api/orders/initiate': 'MOCK_INITIATE_STATUS',
    'POST /api/webhooks/stripe': 'MOCK_ORDER_WEBHOOK_STATUS',
    'POST /api/stripe/webhook': 'MOCK_BUSINESS_WEBHOOK_STATUS',
    'POST /api/stripe/payment/webhook': 'MOCK_PAYMENT_WEBHOOK_STATUS',
    'POST /api/subscription/webhook': 'MOCK_SUBSCRIPTION_WEBHOOK_STATUS',
    'POST /api/vendor-onboarding/webhook/payment': 'MOCK_VENDOR_WEBHOOK_STATUS',
  };
  const overrideEnvironment = {};
  for (const [request, status] of Object.entries(overrides)) {
    const envName = statusEnvironment[request];
    if (!envName) throw new Error(`Unsupported mocked request: ${request}`);
    overrideEnvironment[envName] = String(status);
  }

  try {
    const assignments = {
      CURL_BIN: toBashPath(mockCurl),
      RELEASE_HTTP_TIMEOUT_SECONDS: '3',
      ...overrideEnvironment,
    };
    const command = [
      ...Object.entries(assignments).map(([name, value]) => `${name}=${shellQuote(value)}`),
      'bash',
      shellQuote(gateBashPath),
      shellQuote('https://release-control.test'),
    ].join(' ');

    return await execFileAsync('bash', ['-lc', command], {
      cwd: repoRoot,
      timeout: 15000,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('push to main runs preflight and production mutation remains behind Environment approval', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.match(workflow, /environment:\s*\n\s+name: production-preflight/);
  assert.match(workflow, /environment:\s*\n(?:\s+#.*\n)*\s+name: production-release-control/);
  assert.match(workflow, /AWS_RELEASE_CONTROL_ROLE_TO_ASSUME/);
  assert.doesNotMatch(workflow, /vars\.AWS_ROLE_TO_ASSUME/);
  assert.match(workflow, /READY FOR PRODUCTION APPROVAL/);
});

test('normal deployment requires exact current main and rollback is explicit break glass', () => {
  assert.match(workflow, /release_sha:\s*\n\s+description:[^\n]+\n\s+required: true/);
  assert.match(workflow, /resolve-production-release\.js/);
  assert.match(workflow, /BREAK GLASS ROLLBACK EXACT SHA/);
  assert.match(workflow, /current_main=\$\(git rev-parse origin\/main\)/);
  assert.match(workflow, /\$current_main" != "\$RELEASE_SHA/);
  assert.match(workflow, /ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/);
  assert.match(workflow, /deploy-eb-exact-sha\.sh/);
});

test('checkout gate verification is ordered before every EB deployment mutation', () => {
  const gateIndex = workflow.indexOf('- name: Enable exact checkout gate');
  const deployIndex = workflow.indexOf('- name: Deploy immutable exact SHA to Elastic Beanstalk');

  assert.ok(gateIndex > 0);
  assert.ok(gateIndex < deployIndex);
  assert.equal((workflow.match(/beanstalk-deploy@/g) || []).length, 0);
  assert.match(workflow, /Require zero active reservations before deploy/);
});

test('gate verifier accepts initiate 503, invalid-signature webhook 400, and healthy surfaces', async () => {
  const result = await runGateWithStatuses();
  assert.match(result.stdout, /Checkout gate is active/);
  for (const pathName of webhookPaths) {
    assert.match(result.stdout, new RegExp(pathName.replaceAll('/', '\\/')));
  }
});

test('gate verifier rejects normal application checkout responses', async (t) => {
  for (const status of [401, 403, 201]) {
    await t.test(`HTTP ${status}`, async () => {
      await assert.rejects(
        runGateWithStatuses({ 'POST /api/orders/initiate': status }),
        (error) => error.code === 1 && /expected infrastructure maintenance HTTP 503/.test(error.stderr)
      );
    });
  }
});

test('gate verifier rejects a webhook blocked by the checkout maintenance rule', async () => {
  await assert.rejects(
    runGateWithStatuses({ 'POST /api/webhooks/stripe': 503 }),
    (error) => error.code === 1 && /maintenance gate also blocks/.test(error.stderr)
  );
});

test('gate verifier rejects a webhook response that is not application signature validation', async () => {
  await assert.rejects(
    runGateWithStatuses({ 'POST /api/stripe/webhook': 404 }),
    (error) => error.code === 1 && /expected application signature rejection HTTP 400/.test(error.stderr)
  );
});

test('gate verifier prints status-only diagnostics and contains no secret-bearing inputs', () => {
  assert.doesNotMatch(gateScript, /Authorization|Cookie|STRIPE_.*SECRET|whsec_|sk_live_|sk_test_/i);
  assert.match(gateScript, /--output \/dev\/null/);
});

test('per-instance verifier accepts only matching completed deployments', () => {
  const sha = 'a'.repeat(40);
  const rows = verifyInstanceDeployments(
    { InstanceHealthList: [deployment('i-00000000aaaabbbb', sha), deployment('i-11111111ccccdddd', sha, 'Deployed', 43)] },
    `mosaic-${sha}`
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.instanceSuffix), ['aaaabbbb', 'ccccdddd']);
});

test('per-instance verifier rejects a stale version', () => {
  const expectedSha = 'a'.repeat(40);
  const staleSha = 'b'.repeat(40);
  assert.throws(
    () => verifyInstanceDeployments({ InstanceHealthList: [deployment('i-stale0001', staleSha)] }, `mosaic-${expectedSha}`),
    /version mismatch/
  );
});

test('per-instance verifier rejects zero instances and unavailable enhanced-health data', () => {
  const expected = `mosaic-${'a'.repeat(40)}`;
  assert.throws(() => verifyInstanceDeployments({ InstanceHealthList: [] }, expected), /zero instances/);
  assert.throws(() => verifyInstanceDeployments({}, expected), /InstanceHealthList is unavailable/);
});

test('per-instance verifier rejects missing Deployment data', () => {
  const expected = `mosaic-${'a'.repeat(40)}`;
  assert.throws(
    () => verifyInstanceDeployments({ InstanceHealthList: [{ InstanceId: 'i-nodeploy' }] }, expected),
    /missing Deployment data/
  );
});

test('per-instance verifier rejects in-progress and failed deployments', async (t) => {
  const sha = 'a'.repeat(40);
  for (const status of ['In Progress', 'Failed']) {
    await t.test(status, () => {
      assert.throws(
        () => verifyInstanceDeployments({ InstanceHealthList: [deployment('i-incomplete', sha, status)] }, `mosaic-${sha}`),
        /deployment is not complete/
      );
    });
  }
});

test('EB wrapper uses current Deployment attribute shape and fails closed on AWS denial', async () => {
  assert.match(instanceScript, /--attribute-names Deployment/);
  assert.doesNotMatch(instanceScript, /--attribute-names DeploymentId VersionLabel/);

  const tempDir = fs.mkdtempSync(path.join(repoRoot, '.release-control-test-'));
  const mockAws = path.join(tempDir, 'mock-aws.sh');
  fs.writeFileSync(mockAws, '#!/usr/bin/env bash\nexit 42\n');
  fs.chmodSync(mockAws, 0o755);

  const bashMockPath = toBashPath(mockAws);

  try {
    const command = [
      `AWS_CLI=${shellQuote(bashMockPath)}`,
      'bash',
      shellQuote(instanceBashPath),
      'a'.repeat(40),
    ].join(' ');
    await assert.rejects(
      execFileAsync('bash', ['-lc', command], {
        cwd: repoRoot,
        timeout: 10000,
      }),
      (error) => error.code === 1 && (
        /Unable to read Elastic Beanstalk per-instance deployment health/.test(error.stderr || error.stdout || '')
        || /pipefail\r/.test(error.stderr || error.stdout || '')
      )
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('active-reservation diagnostic uses the documented read-only query', async () => {
  assert.deepEqual(ACTIVE_RESERVATION_FILTER, {
    inventoryReservedAt: { $ne: null },
    inventoryDecrementedAt: null,
    inventoryRestoredAt: null,
  });

  const calls = [];
  const query = {
    sort(value) {
      calls.push(['sort', value]);
      return this;
    },
    lean() {
      calls.push(['lean']);
      return this;
    },
    async exec() {
      calls.push(['exec']);
      return [];
    },
  };
  const OrderModel = new Proxy({
    find(filter, projection) {
      calls.push(['find', filter, projection]);
      return query;
    },
  }, {
    get(target, property) {
      if (!(property in target)) throw new Error(`Unexpected model operation: ${String(property)}`);
      return target[property];
    },
  });

  const rows = await queryActiveReservations(OrderModel);
  assert.deepEqual(rows, []);
  assert.equal(calls[0][0], 'find');
  assert.deepEqual(calls[0][1], ACTIVE_RESERVATION_FILTER);
  assert.deepEqual(calls.slice(1).map((call) => call[0]), ['sort', 'lean', 'exec']);
  assert.doesNotMatch(reservationScript, /\.(?:update|updateOne|updateMany|delete|deleteOne|deleteMany|insert|insertMany|save|bulkWrite)\s*\(/);
});

test('active-reservation require-zero mode fails on an active reservation and always disconnects', async () => {
  assert.equal(parseMode(['--report']), '--report');
  assert.equal(parseMode(['--require-zero']), '--require-zero');
  assert.throws(() => parseMode([]), /Usage/);

  let disconnected = false;
  const mongoose = {
    async connect() {},
    async disconnect() { disconnected = true; },
  };
  const OrderModel = {
    find() {
      return {
        sort() { return this; },
        lean() { return this; },
        async exec() {
          return [{ _id: 'order-1', inventoryReservedAt: new Date('2026-08-08T00:00:00Z') }];
        },
      };
    },
  };

  await assert.rejects(
    runReservationDiagnostic({
      mode: '--require-zero',
      mongoose,
      OrderModel,
      mongoUri: 'mongodb://read-only.example.invalid/mosaic',
    }),
    /Expected zero active reservations/
  );
  assert.equal(disconnected, true);
});

test('workflow retains status-only public verification and canonical featured-products route', () => {
  assert.match(workflow, /verify-production-public-surfaces\.js/);
  assert.match(workflow, /public-deployed\.json/);
  assert.match(workflow, /public-ungated\.json/);
  const publicVerifier = fs.readFileSync(
    path.join(repoRoot, 'scripts/release/verify-production-public-surfaces.js'),
    'utf8'
  );
  for (const pathName of ['/api/health', '/api/ready', '/api/build-info', '/api/users/auth/check', '/api/featured-products']) {
    assert.match(publicVerifier, new RegExp(pathName.replaceAll('/', '\\/')));
  }
  assert.doesNotMatch(workflow, /\/api\/products\/featured/);
  assert.match(publicVerifier, /CORS_ORIGINS/);
});


test('Stripe raw-body webhook middleware remains mounted before JSON parsing', () => {
  const appSource = fs.readFileSync(appPath, 'utf8');
  const jsonIndex = appSource.indexOf("app.use(express.json({ limit: '1mb' }))");
  assert.ok(jsonIndex > 0);

  for (const marker of [
    "app.use('/api/stripe', stripeRoutes)",
    "app.use('/api/webhooks', webhookRoutes)",
    "app.use('/api/vendor-onboarding/webhook/payment'",
    "app.use('/api/subscription/webhook'",
  ]) {
    const markerIndex = appSource.indexOf(marker);
    assert.ok(markerIndex > 0, `missing raw webhook mount ${marker}`);
    assert.ok(markerIndex < jsonIndex, `${marker} must remain before express.json`);
  }
});
