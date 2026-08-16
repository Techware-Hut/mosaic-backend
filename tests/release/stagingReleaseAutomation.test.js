'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/staging-release-certification.yml'),
  'utf8'
);
const controllerWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/staging-release-pr-controller.yml'),
  'utf8'
);
const statusPublisherWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/staging-release-status-publisher.yml'),
  'utf8'
);
const sourcePolicyWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/enforce-staging-to-main.yml'),
  'utf8'
);
const ciVerifierSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/release/require-exact-ci-success.js'),
  'utf8'
);
const prHelperSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/release/ensure-staging-release-pr.js'),
  'utf8'
);

const {
  matchingExactRuns,
  newestExactRun,
  requireExactCiSuccess,
} = require('../../scripts/release/require-exact-ci-success');
const { buildManifest } = require('../../scripts/release/build-release-manifest');
const {
  ensureReleasePullRequest,
  mergeManagedBody,
  renderPullRequestBody,
} = require('../../scripts/release/ensure-staging-release-pr');
const {
  STATUS_CONTEXT,
  publishTrustedStatus,
} = require('../../scripts/release/publish-trusted-staging-status');

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);
const shaC = 'c'.repeat(40);
const shaD = 'd'.repeat(40);
const repository = 'Techware-Hut/mosaic-backend';

function workflowRun(overrides = {}) {
  return {
    id: 100,
    run_number: 20,
    run_attempt: 1,
    created_at: '2026-08-13T20:00:00Z',
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_sha: shaC,
    head_branch: 'staging',
    path: '.github/workflows/ci.yml',
    html_url: 'https://github.example/actions/runs/100',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    ...overrides,
  };
}

function verifierConfig(overrides = {}) {
  return {
    repository,
    branch: 'staging',
    sha: shaC,
    token: 'masked-test-token',
    workflow: 'ci.yml',
    timeoutSeconds: 1,
    pollSeconds: 1,
    ...overrides,
  };
}

function manifestFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    repository,
    sourceBranch: 'staging',
    targetBranch: 'main',
    candidateSha: shaC,
    mainSha: shaA,
    mergeBase: shaB,
    promotionBaseline: shaB,
    provenance: 'promotion-merge-wrapper',
    generatedAt: '2026-08-13T20:00:00.000Z',
    ci: {
      workflow: 'ci.yml',
      event: 'push',
      branch: 'staging',
      workflowId: 1,
      runId: 100,
      runAttempt: 1,
      runUrl: 'https://github.example/actions/runs/100',
      conclusion: 'success',
    },
    commits: [{ sha: shaC, subject: 'Fix paid email (#272)' }],
    changedFiles: ['controllers/webhookController.js', 'utils/mailer.js'],
    sourcePrs: [272],
    riskSignals: {
      sensitiveFiles: ['controllers/webhookController.js', 'utils/mailer.js'],
      migrationsOrSchema: [],
      paymentSensitive: true,
      emailSensitive: true,
      inventorySensitive: false,
      mixedVersionSafe: false,
    },
    rollback: { previousMainSha: shaA, note: 'Keep checkout gated.' },
    requiredProductionProof: ['exact-main-preflight'],
    productionUat: ['controlled-payment-success', 'transactional-email-delivery'],
    productionAccepted: false,
    contentSha256: 'f'.repeat(64),
    ...overrides,
  };
}

function canonicalPr(manifest, overrides = {}) {
  return {
    number: 273,
    html_url: 'https://github.example/pull/273',
    title: `chore(release): promote staging ${manifest.candidateSha.slice(0, 12)} to production`,
    body: renderPullRequestBody(manifest, 'https://github.example/actions/runs/500'),
    head: {
      ref: 'staging',
      sha: manifest.candidateSha,
      repo: { full_name: repository },
    },
    base: { ref: 'main', sha: manifest.mainSha, repo: { full_name: repository } },
    ...overrides,
  };
}

test('workflow certifies only staging pushes and publishes the exact immutable artifact', () => {
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- staging/);
  assert.match(workflow, /group: mosaic-staging-release/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /name: Staging release certification/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /require-exact-ci-success\.js[\s\S]*> "\$RUNNER_TEMP\/exact-ci-result\.json"/);
  assert.match(workflow, /name: staging-certification-\$\{\{ steps\.identity\.outputs\.candidate_sha \}\}/);
  assert.match(workflow, /overwrite: false/);
  assert.doesNotMatch(workflow, /ensure-staging-release-pr\.js|permission-pull-requests|APP_PRIVATE_KEY/);
  assert.match(controllerWorkflow, /workflow_run:/);
  assert.match(controllerWorkflow, /TRIGGER_WORKFLOW_PATH/);
  assert.match(controllerWorkflow, /WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}[\s\S]*\[ "\$WORKFLOW_SHA" != "\$main_sha" \]/);
  assert.match(controllerWorkflow, /ref: main/);
  assert.match(controllerWorkflow, /Rebuild release manifest with trusted controller code/);
  assert.match(controllerWorkflow, /ensure-staging-release-pr\.js/);
  assert.match(controllerWorkflow, /permission-pull-requests: write/);
  assert.match(controllerWorkflow, /Test candidate in isolated runner[\s\S]*npm test[\s\S]*test:contract[\s\S]*test:integration/);
  assert.match(controllerWorkflow, /Reconstruct certificate in fresh trusted runner/);
  assert.doesNotMatch(controllerWorkflow.slice(controllerWorkflow.indexOf('  validate-certificate:'), controllerWorkflow.indexOf('  ensure-release-pr:')), /npm ci|npm test/);
  assert.match(statusPublisherWorkflow, /workflow_run:[\s\S]*Staging release PR controller/);
  assert.match(statusPublisherWorkflow, /UPSTREAM_CONTROLLER_SHA:[\s\S]*PUBLISHER_WORKFLOW_SHA:[\s\S]*test "\$UPSTREAM_CONTROLLER_SHA" = "\$current_main"[\s\S]*test "\$PUBLISHER_WORKFLOW_SHA" = "\$current_main"/);
  assert.match(statusPublisherWorkflow, /permission-statuses: write/);
  assert.match(statusPublisherWorkflow, /publish-trusted-staging-status\.js/);
  assert.doesNotMatch(workflow, /id-token:\s*write|aws-actions|elasticbeanstalk|MONGODB_URI/);
  assert.doesNotMatch(workflow, /npm ci|npm install/);
  assert.doesNotMatch(workflow, /git (?:fetch|ls-remote)/);
  assert.doesNotMatch(controllerWorkflow, /git (?:fetch|ls-remote)/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*gh api/);
  assert.match(controllerWorkflow, /GH_TOKEN: \$\{\{ github\.token \}\}[\s\S]*gh api/);
});

test('workflow and PR helper cannot merge or auto-merge a release PR', () => {
  assert.doesNotMatch(workflow, /\/merge|auto-merge|gh pr merge/i);
  assert.doesNotMatch(controllerWorkflow, /\/merge|auto-merge|gh pr merge/i);
  assert.doesNotMatch(prHelperSource, /\/merge|auto-merge|enablePullRequestAutoMerge/i);
  assert.doesNotMatch(ciVerifierSource, /values\.token|--token/);
  assert.match(controllerWorkflow, /ensure-staging-release-pr/);
});

test('main source policy runs from trusted base-branch code without checking out PR code', () => {
  assert.match(sourcePolicyWorkflow, /pull_request_target:[\s\S]*branches:[\s\S]*- main/);
  assert.match(sourcePolicyWorkflow, /permissions:\s*\n\s+contents: read/);
  assert.match(sourcePolicyWorkflow, /HEAD_REPOSITORY[\s\S]*HEAD_REF[\s\S]*HEAD_SHA/);
  assert.match(sourcePolicyWorkflow, /git\/ref\/heads\/staging/);
  assert.doesNotMatch(sourcePolicyWorkflow, /mosaic\/trusted-staging-certification|statuses:|sleep /);
  assert.doesNotMatch(sourcePolicyWorkflow, /actions\/checkout|npm ci|node .*scripts/);
});

test('backend staging automation has no frontend dispatch, promotion, or deployment capability', () => {
  const combined = `${workflow}\n${controllerWorkflow}\n${statusPublisherWorkflow}`;
  assert.doesNotMatch(combined, /mosaic-biz-frontend-launch|repository_dispatch|workflow_dispatch[\s\S]*frontend/i);
  assert.doesNotMatch(combined, /vercel|frontendRequired\s*[:=]\s*true/i);
});

test('PR-write and status-write tokens stay in separate trusted main-only jobs', () => {
  const prJob = controllerWorkflow.slice(controllerWorkflow.indexOf('  ensure-release-pr:'));
  assert.match(prJob, /environment:\s*\n(?:\s*#.*\n)*\s*name: release-pr-controller/);
  assert.match(prJob, /ref: \$\{\{ needs\.validate-trigger\.outputs\.main_sha \}\}/);
  assert.match(prJob, /RELEASE_AUTOMATION_APP_PRIVATE_KEY/);
  assert.match(prJob, /node release-control\/scripts\/release\/ensure-staging-release-pr\.js/);
  assert.doesNotMatch(prJob, /permission-statuses: write|Checkout candidate|npm ci/);
  assert.match(statusPublisherWorkflow, /environment:\s*\n\s+name: release-pr-controller/);
  assert.match(statusPublisherWorkflow, /permission-statuses: write/);
  assert.doesNotMatch(statusPublisherWorkflow, /permission-pull-requests: write|ensure-staging-release-pr\.js|npm ci/);
  assert.doesNotMatch(workflow, /RELEASE_AUTOMATION_APP_PRIVATE_KEY|RELEASE_PR_TOKEN/);
});

test('exact CI matcher rejects same-SHA PR runs, forks, other branches, and other workflows', () => {
  const valid = workflowRun();
  const matches = matchingExactRuns({ workflow_runs: [
    workflowRun({ id: 1, event: 'pull_request' }),
    workflowRun({ id: 2, head_branch: 'main' }),
    workflowRun({ id: 3, repository: { full_name: 'fork/mosaic-backend' } }),
    workflowRun({ id: 6, head_repository: { full_name: 'fork/mosaic-backend' } }),
    workflowRun({ id: 4, path: '.github/workflows/other.yml' }),
    workflowRun({ id: 5, head_sha: shaB }),
    valid,
  ] }, verifierConfig());
  assert.deepEqual(matches.map((run) => run.id), [100]);
});

test('newest exact CI run takes precedence over an older success', () => {
  const selected = newestExactRun([
    workflowRun({ id: 100, conclusion: 'success', created_at: '2026-08-13T20:00:00Z' }),
    workflowRun({ id: 101, conclusion: 'failure', created_at: '2026-08-13T20:01:00Z' }),
  ]);
  assert.equal(selected.id, 101);
  assert.equal(selected.conclusion, 'failure');
});

test('exact CI verifier waits for the canonical run and rechecks staging before returning', async () => {
  let runReads = 0;
  let refReads = 0;
  const request = async (_config, apiPath) => {
    if (apiPath.startsWith('/actions/workflows/ci.yml?') || apiPath === '/actions/workflows/ci.yml') {
      return { id: 1, path: '.github/workflows/ci.yml', state: 'active' };
    }
    if (apiPath.startsWith('/git/ref/heads/')) {
      refReads += 1;
      return { object: { sha: shaC } };
    }
    runReads += 1;
    return { workflow_runs: [workflowRun({
      status: runReads === 1 ? 'in_progress' : 'completed',
      conclusion: runReads === 1 ? null : 'success',
    })] };
  };
  const result = await requireExactCiSuccess(verifierConfig(), {
    request,
    delay: async () => {},
    now: () => 0,
  });
  assert.equal(result.runId, 100);
  assert.equal(result.sha, shaC);
  assert.equal(runReads, 2);
  assert.equal(refReads, 3);
});

test('exact CI verifier fails before reading runs when canonical staging moved', async () => {
  let runRead = false;
  const request = async (_config, apiPath) => {
    if (apiPath === '/actions/workflows/ci.yml') {
      return { id: 1, path: '.github/workflows/ci.yml', state: 'active' };
    }
    if (apiPath.startsWith('/git/ref/heads/')) return { object: { sha: shaB } };
    runRead = true;
    return { workflow_runs: [] };
  };
  await assert.rejects(
    requireExactCiSuccess(verifierConfig(), { request, delay: async () => {}, now: () => 0 }),
    /Stale release candidate/
  );
  assert.equal(runRead, false);
});

test('exact CI verifier fails closed on the newest completed non-success result', async () => {
  const request = async (_config, apiPath) => {
    if (apiPath === '/actions/workflows/ci.yml') {
      return { id: 1, path: '.github/workflows/ci.yml', state: 'active' };
    }
    if (apiPath.startsWith('/git/ref/heads/')) return { object: { sha: shaC } };
    return { workflow_runs: [
      workflowRun({ id: 100, conclusion: 'success', created_at: '2026-08-13T20:00:00Z' }),
      workflowRun({ id: 101, conclusion: 'cancelled', created_at: '2026-08-13T20:01:00Z' }),
    ] };
  };
  await assert.rejects(
    requireExactCiSuccess(verifierConfig(), { request, delay: async () => {}, now: () => 0 }),
    /Newest exact CI run 101 completed with cancelled/
  );
});

test('manifest accepts canonical promotion-wrapper history and classifies release risk', () => {
  const responses = new Map([
    [`rev-parse ${shaC}^{commit}`, `${shaC}\n`],
    [`rev-parse ${shaA}^{commit}`, `${shaA}\n`],
    [`merge-base ${shaA} ${shaC}`, `${shaB}\n`],
    [`rev-list --parents -n 1 ${shaA}`, `${shaA} ${shaD} ${shaB}\n`],
    [`merge-base ${shaB} ${shaC}`, `${shaB}\n`],
    [`rev-parse ${shaA}^{tree}`, 'tree-identical\n'],
    [`rev-parse ${shaB}^{tree}`, 'tree-identical\n'],
    [`log -z --reverse --format=%H%x00%s ${shaB}..${shaC}`, `${shaC}\0Fix paid email (#272)\0`],
    [`diff --name-only -z ${shaA} ${shaC}`, 'controllers/webhookController.js\0utils/mailer.js\0'],
  ]);
  const manifest = buildManifest({
    candidateSha: shaC,
    mainSha: shaA,
    repository,
    ciResultPath: 'unused.json',
  }, {
    generatedAt: '2026-08-13T20:00:00.000Z',
    ciResult: {
      sha: shaC,
      branch: 'staging',
      repository,
      workflowPath: '.github/workflows/ci.yml',
      workflowId: 1,
      runId: 100,
      runAttempt: 1,
      runUrl: 'https://github.example/actions/runs/100',
    },
    git: (args) => {
      const key = args.join(' ');
      assert.ok(responses.has(key), `unexpected git call: ${key}`);
      return responses.get(key);
    },
  });
  assert.equal(manifest.provenance, 'promotion-merge-wrapper');
  assert.deepEqual(manifest.changedFiles, ['controllers/webhookController.js', 'utils/mailer.js']);
  assert.deepEqual(manifest.sourcePrs, [272]);
  assert.equal(manifest.riskSignals.paymentSensitive, true);
  assert.equal(manifest.riskSignals.emailSensitive, true);
  assert.equal(manifest.riskSignals.mixedVersionSafe, false);
  assert.match(manifest.contentSha256, /^[a-f0-9]{64}$/);
});

test('manifest rejects ambiguous or main-only release history', () => {
  const runGit = (args) => {
    const key = args.join(' ');
    if (key === `rev-parse ${shaC}^{commit}`) return shaC;
    if (key === `rev-parse ${shaA}^{commit}`) return shaA;
    if (key === `merge-base ${shaA} ${shaC}`) return shaB;
    if (key === `rev-list --parents -n 1 ${shaA}`) return `${shaA} ${shaD}`;
    throw new Error(`unexpected git call: ${key}`);
  };
  assert.throws(() => buildManifest({
    candidateSha: shaC,
    mainSha: shaA,
    repository,
    ciResultPath: 'unused.json',
  }, {
    ciResult: {
      sha: shaC,
      branch: 'staging',
      repository,
      workflowPath: '.github/workflows/ci.yml',
      workflowId: 1,
      runId: 100,
      runUrl: 'https://github.example/actions/runs/100',
    },
    git: runGit,
  }), /history is ambiguous/);
});

test('managed PR body preserves human text and rejects malformed markers', () => {
  const managed = renderPullRequestBody(manifestFixture(), 'https://github.example/actions/runs/500');
  const merged = mergeManagedBody('Human release-owner note.', managed);
  assert.match(merged, /^Human release-owner note\./);
  assert.match(merged, /MERGE DOES NOT EQUAL PRODUCTION ACCEPTANCE/);
  assert.throws(
    () => mergeManagedBody('<!-- mosaic-release-automation:start -->broken', managed),
    /malformed/
  );
});

test('candidate-controlled release text cannot inject markers, mentions, or code spans', () => {
  const baseline = manifestFixture();
  const manifest = manifestFixture({
    commits: [{
      sha: shaC,
      subject: '<!-- mosaic-release-automation:end --> @release-team `unsafe`\nnext',
    }],
    changedFiles: ['src/`break`.js', '<!-- mosaic-release-automation:start -->'],
    riskSignals: {
      ...baseline.riskSignals,
      sensitiveFiles: ['@owners/payment.js'],
    },
  });
  const body = renderPullRequestBody(manifest, 'https://github.example/actions/runs/500');
  assert.equal(body.split('<!-- mosaic-release-automation:start -->').length - 1, 1);
  assert.equal(body.split('<!-- mosaic-release-automation:end -->').length - 1, 1);
  assert.doesNotMatch(body, /@release-team|@owners/);
  assert.doesNotMatch(body, /`unsafe`|`break`/);
  assert.match(body, /&lt;!-- mosaic-release-automation:end --&gt;/);
  assert.match(body, /&#64;release-team/);
});

test('trusted controller publishes one App-owned status bound to candidate and main refs', async () => {
  const manifest = manifestFixture();
  const calls = [];
  const targetUrl = 'https://github.com/Techware-Hut/mosaic-backend/actions/runs/500';
  const request = async (_config, method, apiPath, body) => {
    calls.push({ method, apiPath, body });
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaC } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    if (method === 'POST' && apiPath === `/statuses/${shaC}`) return {
      ...body,
      target_url: body.target_url,
    };
    throw new Error(`unexpected request: ${method} ${apiPath}`);
  };
  const result = await publishTrustedStatus({
    repository,
    token: 'masked-app-token',
    candidateSha: shaC,
    targetUrl,
  }, manifest, { request });
  assert.equal(result.context, STATUS_CONTEXT);
  const write = calls.find((call) => call.method === 'POST');
  assert.equal(write.body.state, 'success');
  assert.equal(write.body.context, STATUS_CONTEXT);
  assert.equal(write.body.description, `Certified for main ${shaA}`);
  assert.equal(write.body.target_url, targetUrl);
});

test('PR helper creates exactly one canonical staging-to-main PR and never calls merge', async () => {
  const manifest = manifestFixture();
  const calls = [];
  const request = async (_config, method, apiPath, body) => {
    calls.push({ method, apiPath, body });
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaC } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    if (method === 'GET' && apiPath.startsWith('/pulls?')) return [];
    if (method === 'POST' && apiPath === '/pulls') return canonicalPr(manifest, { body: body.body, title: body.title });
    throw new Error(`unexpected request: ${method} ${apiPath}`);
  };
  const result = await ensureReleasePullRequest({
    repository,
    candidateSha: shaC,
    workflowRunUrl: 'https://github.example/actions/runs/500',
  }, manifest, { request });
  assert.equal(result.action, 'created');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(calls.some((call) => call.apiPath.includes('/merge')), false);
});

test('stale candidate cannot reach pull-request lookup or mutation', async () => {
  const calls = [];
  const request = async (_config, method, apiPath) => {
    calls.push({ method, apiPath });
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaB } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    throw new Error('pull request API must not be reached');
  };
  await assert.rejects(
    ensureReleasePullRequest({ repository, candidateSha: shaC }, manifestFixture(), { request }),
    /Stale release candidate/
  );
  assert.equal(calls.some((call) => call.apiPath.startsWith('/pulls')), false);
});

test('duplicate canonical release PRs fail closed without a write', async () => {
  const manifest = manifestFixture();
  const calls = [];
  const request = async (_config, method, apiPath) => {
    calls.push({ method, apiPath });
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaC } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    if (method === 'GET' && apiPath.startsWith('/pulls?')) return [canonicalPr(manifest), canonicalPr(manifest, { number: 274 })];
    throw new Error('write must not occur');
  };
  await assert.rejects(
    ensureReleasePullRequest({ repository, candidateSha: shaC }, manifest, { request }),
    /found 2/
  );
  assert.equal(calls.some((call) => ['POST', 'PATCH'].includes(call.method)), false);
});

test('existing canonical release PR is reused without a redundant write', async () => {
  const manifest = manifestFixture();
  const existing = canonicalPr(manifest);
  const calls = [];
  const request = async (_config, method, apiPath) => {
    calls.push({ method, apiPath });
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaC } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    if (method === 'GET' && apiPath.startsWith('/pulls?')) return [existing];
    throw new Error('redundant write must not occur');
  };
  const result = await ensureReleasePullRequest({
    repository,
    candidateSha: shaC,
    workflowRunUrl: 'https://github.example/actions/runs/500',
  }, manifest, { request });
  assert.equal(result.action, 'reused');
  assert.equal(calls.some((call) => ['POST', 'PATCH'].includes(call.method)), false);
});

test('PR helper recovers one concurrent create race but validates the resulting exact head', async () => {
  const manifest = manifestFixture();
  let listCount = 0;
  const request = async (_config, method, apiPath) => {
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaC } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    if (method === 'GET' && apiPath.startsWith('/pulls?')) {
      listCount += 1;
      return listCount === 1 ? [] : [canonicalPr(manifest)];
    }
    if (method === 'POST' && apiPath === '/pulls') {
      const error = new Error('already exists');
      error.statusCode = 422;
      throw error;
    }
    throw new Error(`unexpected request: ${method} ${apiPath}`);
  };
  const result = await ensureReleasePullRequest({
    repository,
    candidateSha: shaC,
    workflowRunUrl: 'https://github.example/actions/runs/500',
  }, manifest, { request });
  assert.equal(result.action, 'reused');
  assert.equal(listCount, 2);
});

test('concurrent PR creator with stale body is reconciled before success', async () => {
  const manifest = manifestFixture();
  let listCount = 0;
  let patchBody;
  const request = async (_config, method, apiPath, body) => {
    if (apiPath === '/git/ref/heads/staging') return { object: { sha: shaC } };
    if (apiPath === '/git/ref/heads/main') return { object: { sha: shaA } };
    if (method === 'GET' && apiPath.startsWith('/pulls?')) {
      listCount += 1;
      return listCount === 1 ? [] : [canonicalPr(manifest, { title: 'manual', body: 'Human note.' })];
    }
    if (method === 'POST' && apiPath === '/pulls') {
      const error = new Error('already exists');
      error.statusCode = 422;
      throw error;
    }
    if (method === 'PATCH' && apiPath === '/pulls/273') {
      patchBody = body;
      return canonicalPr(manifest, { title: body.title, body: body.body });
    }
    throw new Error(`unexpected request: ${method} ${apiPath}`);
  };
  const result = await ensureReleasePullRequest({
    repository,
    candidateSha: shaC,
    workflowRunUrl: 'https://github.example/actions/runs/500',
  }, manifest, { request });
  assert.equal(result.action, 'updated');
  assert.match(patchBody.body, /^Human note\./);
  assert.match(patchBody.body, /MERGE DOES NOT EQUAL PRODUCTION ACCEPTANCE/);
});
