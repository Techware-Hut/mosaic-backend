'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
const waveOneBase = 'da890fbd6741ef2e4c618bed84ef0072ece7932d';
const waveOneCommits = [
  'af4146d524b393903a338c617f9d1eed7d42f56d',
  'b6e3c5285d066c150d292c01258e55bf2448dd52',
  'd7ff8e041c7ffecd52043e844eb2dac76210e779',
];
const waveOneBranch = 'codex/focused-release-wave1';
const synchronizedMain = '1'.repeat(40);
const synchronizedHead = '2'.repeat(40);
const baseTreeSha = '3'.repeat(40);
const mainTreeSha = '4'.repeat(40);
const synchronizedTreeSha = '5'.repeat(40);
const reviewedTreeSha = 'e4b6ead713328fc8e67ca53e91cfb14af8008174';
const waveOneFiles = [
  '.github/workflows/deploy-eb-production.yml',
  'docs/release/AGENTIC_RELEASE_OPERATIONS.md',
  'docs/release/CHECKOUT_GATE_OPERATIONS.md',
  'docs/release/RELEASE_CONTROL_INFRASTRUCTURE_SETUP.md',
  'scripts/release/build-production-evidence.js',
  'scripts/release/deploy-eb-exact-sha.sh',
  'scripts/release/manage-checkout-gate.js',
  'scripts/release/probe-target-checkout-surface.js',
  'scripts/release/resolve-production-release.js',
  'scripts/release/verify-checkout-gate.sh',
  'scripts/release/verify-checkout-surface-contract.js',
  'scripts/release/verify-focused-release-source.js',
  'scripts/release/verify-production-public-surfaces.js',
  'tests/release/agenticProductionRelease.test.js',
  'tests/release/focusedReleaseCertificate.test.js',
  'tests/release/productionReleaseControl.test.js',
  'tests/release/productionReleaseInfrastructure.test.js',
];
const addedWaveOneFiles = new Set([
  'scripts/release/verify-focused-release-source.js',
  'tests/release/focusedReleaseCertificate.test.js',
]);
const approvedAncestorDirectories = [...new Set(waveOneFiles.flatMap((file) => {
  const components = file.split('/');
  return components.slice(1).map((_component, index) => components.slice(0, index + 1).join('/'));
}))].sort();

function treeEntry(path, sha, mode = '100644', type = 'blob') {
  return { path, sha, mode, type };
}

function waveOneTrees() {
  const base = waveOneFiles.flatMap((file, index) => addedWaveOneFiles.has(file)
    ? [] : [treeEntry(file, String(index + 1).padStart(40, '0'),
      file === 'scripts/release/verify-checkout-gate.sh' ? '100755' : '100644')]);
  const reviewed = waveOneFiles.map((file, index) => treeEntry(
    file,
    String(index + 101).padStart(40, '0'),
    file === 'scripts/release/verify-checkout-gate.sh' ? '100755' : '100644'
  ));
  const ordinary = [
    treeEntry('README.md', '6'.repeat(40)),
    treeEntry('controllers', '8'.repeat(40), '040000', 'tree'),
    treeEntry('controllers/bookingController.js', '7'.repeat(40)),
  ];
  const baseDirectories = approvedAncestorDirectories.map((directory, index) =>
    treeEntry(directory, String(index + 201).padStart(40, '0'), '040000', 'tree'));
  const reviewedDirectories = approvedAncestorDirectories.map((directory, index) =>
    treeEntry(directory, String(index + 301).padStart(40, '0'), '040000', 'tree'));
  return {
    base: [...baseDirectories, ...base, ...ordinary],
    reviewed: [...reviewedDirectories, ...reviewed, ...ordinary],
    main: [...baseDirectories, ...base, ...ordinary],
    synchronized: [...reviewedDirectories, ...reviewed, ...ordinary],
  };
}

function sourcePolicyScript() {
  const match = sourcePolicyWorkflow.match(/^ {10}node <<'NODE'\r?\n([\s\S]*?)^ {10}NODE\s*$/m);
  assert.ok(match, 'trusted promotion workflow must contain the inline policy');
  return match[1].split(/\r?\n/).map((line) => line.replace(/^ {10}/, '')).join('\n');
}

function waveOneApiFixtures() {
  const trees = waveOneTrees();
  return {
    [`repos/${repository}/pulls/293`]: {
      number: 293,
      state: 'open',
      head: { ref: waveOneBranch, sha: synchronizedHead, repo: { full_name: repository } },
      // PR metadata can lag the live main ref; effective-base proof uses ancestry.
      base: { ref: 'main', sha: waveOneBase, repo: { full_name: repository } },
      changed_files: waveOneFiles.length,
    },
    [`repos/${repository}/git/ref/heads/${waveOneBranch}`]: { object: { sha: synchronizedHead } },
    [`repos/${repository}/git/ref/heads/main`]: { object: { sha: synchronizedMain } },
    [`repos/${repository}/git/commits/${synchronizedHead}`]: {
      sha: synchronizedHead,
      tree: { sha: synchronizedTreeSha },
      parents: [{ sha: waveOneCommits[2] }, { sha: synchronizedMain }],
    },
    [`repos/${repository}/git/commits/${synchronizedMain}`]: {
      sha: synchronizedMain,
      tree: { sha: mainTreeSha },
    },
    [`repos/${repository}/git/commits/${waveOneBase}`]: {
      sha: waveOneBase,
      tree: { sha: baseTreeSha },
    },
    [`repos/${repository}/git/commits/${waveOneCommits[2]}`]: {
      sha: waveOneCommits[2],
      tree: { sha: reviewedTreeSha },
    },
    [`repos/${repository}/compare/${synchronizedMain}...${synchronizedHead}`]: {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      base_commit: { sha: synchronizedMain },
      merge_base_commit: { sha: synchronizedMain },
      commits: [{ sha: synchronizedHead }],
    },
    [`repos/${repository}/git/trees/${baseTreeSha}?recursive=1`]: { sha: baseTreeSha, truncated: false, tree: trees.base },
    [`repos/${repository}/git/trees/${reviewedTreeSha}?recursive=1`]: { sha: reviewedTreeSha, truncated: false, tree: trees.reviewed },
    [`repos/${repository}/git/trees/${mainTreeSha}?recursive=1`]: { sha: mainTreeSha, truncated: false, tree: trees.main },
    [`repos/${repository}/git/trees/${synchronizedTreeSha}?recursive=1`]: { sha: synchronizedTreeSha, truncated: false, tree: trees.synchronized },
    [`repos/${repository}/pulls/293/files?per_page=100&page=1`]: waveOneFiles.map((filename) => ({
      filename,
      status: addedWaveOneFiles.has(filename) ? 'added' : 'modified',
      sha: trees.reviewed.find((entry) => entry.path === filename).sha,
    })),
  };
}

function runSourcePolicy({ env = {}, responses = {}, failApi, mutateApi } = {}) {
  const fixtures = { ...waveOneApiFixtures(), ...responses };
  const calls = [];
  const output = [];
  const errors = [];
  const policyProcess = {
    env: {
      EXPECTED_REPOSITORY: repository,
      HEAD_REPOSITORY: repository,
      HEAD_REF: waveOneBranch,
      HEAD_SHA: synchronizedHead,
      BASE_REF: 'main',
      PR_NUMBER: '293',
      ...env,
    },
    exitCode: 0,
  };
  const mockRequire = (name) => {
    assert.equal(name, 'node:child_process');
    return {
      execFileSync(command, args) {
        assert.equal(command, 'gh');
        assert.equal(args[0], 'api');
        const apiPath = args[1];
        calls.push(apiPath);
        if (apiPath === failApi || !Object.hasOwn(fixtures, apiPath)) {
          throw new Error('mock API failure');
        }
        const fixture = JSON.parse(JSON.stringify(fixtures[apiPath]));
        return JSON.stringify(mutateApi ? mutateApi(apiPath, fixture, calls) : fixture);
      },
    };
  };
  vm.runInNewContext(sourcePolicyScript(), {
    require: mockRequire,
    process: policyProcess,
    console: {
      log: (line) => output.push(line),
      error: (line) => errors.push(line),
    },
  }, { timeout: 2000 });
  return { passed: policyProcess.exitCode === 0, calls, output, errors };
}

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
  assert.match(sourcePolicyWorkflow, /pull-requests: read/);
  assert.match(sourcePolicyWorkflow, /HEAD_REPOSITORY[\s\S]*HEAD_REF[\s\S]*HEAD_SHA/);
  assert.match(sourcePolicyWorkflow, /git\/ref\/heads\/staging/);
  assert.doesNotMatch(sourcePolicyWorkflow, /mosaic\/trusted-staging-certification|statuses:|sleep /);
  assert.doesNotMatch(sourcePolicyWorkflow, /actions\/checkout|npm ci|node .*scripts/);
  assert.doesNotMatch(sourcePolicyWorkflow, /github\.event\.pull_request\.labels|\/merge|gh pr merge/);
});

test('canonical staging tip still passes and reads only the live staging ref', () => {
  const stagingRef = `repos/${repository}/git/ref/heads/staging`;
  const result = runSourcePolicy({
    env: { HEAD_REF: 'staging', HEAD_SHA: shaC },
    responses: { [stagingRef]: { object: { sha: shaC } } },
  });
  assert.equal(result.passed, true, result.errors.join('\n'));
  assert.deepEqual(result.calls, [stagingRef]);
  assert.match(result.output.join('\n'), /Exact canonical staging source is eligible/);
});

test('canonical stale staging tip still fails', () => {
  const result = runSourcePolicy({
    env: { HEAD_REF: 'staging', HEAD_SHA: shaB },
    responses: { [`repos/${repository}/git/ref/heads/staging`]: { object: { sha: shaC } } },
  });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /not the exact current canonical staging SHA/);
});

test('forked staging fails before any GitHub API read', () => {
  const result = runSourcePolicy({
    env: { HEAD_REF: 'staging', HEAD_REPOSITORY: 'untrusted/mosaic-backend' },
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.calls, []);
});

test('synchronized Wave 1 head passes with stale PR base metadata and reviewed payload', () => {
  const result = runSourcePolicy();
  assert.equal(result.passed, true, result.errors.join('\n'));
  assert.equal(result.calls.filter((path) => path.includes('/files?per_page=100&page=')).length, 1);
  assert.equal(result.calls.filter((path) => path.includes('/git/ref/heads/codex/')).length, 2);
  assert.equal(result.calls.filter((path) => path.endsWith('/git/ref/heads/main')).length, 2);
  assert.ok(result.calls.includes(`repos/${repository}/git/trees/${reviewedTreeSha}?recursive=1`));
  assert.match(result.output.join('\n'), /Wave 1/);
});

test('wrong PR, branch, base, or repository cannot use focused admission', () => {
  const cases = [
    { PR_NUMBER: '294' },
    { HEAD_REF: 'codex/focused-release-wave2' },
    { BASE_REF: 'staging' },
    { HEAD_REPOSITORY: 'untrusted/mosaic-backend' },
    { EXPECTED_REPOSITORY: 'untrusted/mosaic-backend', HEAD_REPOSITORY: 'untrusted/mosaic-backend' },
  ];
  for (const env of cases) {
    const result = runSourcePolicy({ env });
    assert.equal(result.passed, false, JSON.stringify(env));
    assert.deepEqual(result.calls, [], JSON.stringify(env));
  }
});

test('event and live PR identity must agree at the synchronized head', () => {
  const pullPath = `repos/${repository}/pulls/293`;
  assert.equal(runSourcePolicy({ env: { HEAD_SHA: shaB } }).passed, false);
  for (const modify of [
    (pull) => { pull.head.sha = shaB; },
    (pull) => { pull.head.repo.full_name = 'untrusted/mosaic-backend'; },
    (pull) => { pull.base.ref = 'staging'; },
    (pull) => { pull.changed_files = 16; },
  ]) {
    const result = runSourcePolicy({
      mutateApi: (path, fixture) => {
        if (path === pullPath) modify(fixture);
        return fixture;
      },
    });
    assert.equal(result.passed, false);
  }
});

test('moved Wave 1 branch fails on initial and final ref reads', () => {
  const branchRef = `repos/${repository}/git/ref/heads/${waveOneBranch}`;
  for (const moveOnRead of [1, 2]) {
    const result = runSourcePolicy({
      mutateApi: (path, fixture, calls) => {
        if (path === branchRef && calls.filter((entry) => entry === branchRef).length === moveOnRead) {
          fixture.object.sha = shaB;
        }
        return fixture;
      },
    });
    assert.equal(result.passed, false);
    assert.match(result.errors.join('\n'), /branch|ref|head/i);
  }
});

test('live main moves before final read fail closed', () => {
  const mainRef = `repos/${repository}/git/ref/heads/main`;
  const result = runSourcePolicy({ mutateApi: (path, fixture, calls) => {
    if (path === mainRef && calls.filter((entry) => entry === mainRef).length === 2) fixture.object.sha = shaB;
    return fixture;
  } });
  assert.equal(result.passed, false);
});

test('focused head must be exactly one ordered merge of reviewed payload and live main', () => {
  const commitPath = `repos/${repository}/git/commits/${synchronizedHead}`;
  for (const modify of [
    (commit) => { commit.parents[0].sha = shaB; },
    (commit) => { commit.parents[1].sha = shaB; },
    (commit) => { commit.parents.reverse(); },
    (commit) => { commit.parents = [{ sha: synchronizedMain }]; },
    (commit) => { commit.parents.push({ sha: shaB }); },
  ]) {
    const result = runSourcePolicy({
      mutateApi: (path, fixture) => {
        if (path === commitPath) modify(fixture);
        return fixture;
      },
    });
    assert.equal(result.passed, false);
  }
});

test('wrong merge base or non-zero behind count fails despite ordered merge parents', () => {
  const comparisonPath = `repos/${repository}/compare/${synchronizedMain}...${synchronizedHead}`;
  for (const modify of [
    (comparison) => { comparison.merge_base_commit.sha = shaB; },
    (comparison) => { comparison.behind_by = 1; },
    (comparison) => { comparison.status = 'diverged'; },
  ]) {
    const result = runSourcePolicy({ mutateApi: (path, fixture) => {
      if (path === comparisonPath) modify(fixture);
      return fixture;
    } });
    assert.equal(result.passed, false);
  }
});

test('reviewed source commit must identify the pinned reviewed tree SHA', () => {
  const reviewedCommit = `repos/${repository}/git/commits/${waveOneCommits[2]}`;
  const result = runSourcePolicy({ mutateApi: (path, fixture) => {
    if (path === reviewedCommit) fixture.tree.sha = shaB;
    return fixture;
  } });
  assert.equal(result.passed, false);
});

test('current unsynchronized PR head is intentionally ineligible before bootstrap rollout', () => {
  const pullPath = `repos/${repository}/pulls/293`;
  const refPath = `repos/${repository}/git/ref/heads/${waveOneBranch}`;
  const result = runSourcePolicy({
    env: { HEAD_SHA: waveOneCommits[2] },
    mutateApi: (path, fixture) => {
      if (path === pullPath) fixture.head.sha = waveOneCommits[2];
      if (path === refPath) fixture.object.sha = waveOneCommits[2];
      return fixture;
    },
  });
  assert.equal(result.passed, false);
});

test('approved synchronized payload rejects changed blob, mode, or object type', () => {
  const treePath = `repos/${repository}/git/trees/${synchronizedTreeSha}?recursive=1`;
  for (const modify of [
    (entry) => { entry.sha = shaB; },
    (entry) => { entry.mode = '100755'; },
    (entry) => { entry.type = 'tree'; },
  ]) {
    const result = runSourcePolicy({ mutateApi: (path, fixture) => {
      if (path === treePath) modify(fixture.tree.find((entry) => entry.path === waveOneFiles[0]));
      return fixture;
    } });
    assert.equal(result.passed, false);
  }
});

test('live main may not change an approved path from original base', () => {
  const mainTree = `repos/${repository}/git/trees/${mainTreeSha}?recursive=1`;
  const result = runSourcePolicy({ mutateApi: (path, fixture) => {
    if (path === mainTree) fixture.tree.find((entry) => entry.path === waveOneFiles[0]).sha = shaB;
    return fixture;
  } });
  assert.equal(result.passed, false);
});

test('non-approved synchronized tree entries must match live main exactly', () => {
  const synchronizedTree = `repos/${repository}/git/trees/${synchronizedTreeSha}?recursive=1`;
  const result = runSourcePolicy({ mutateApi: (path, fixture) => {
    if (path === synchronizedTree) {
      fixture.tree.find((entry) => entry.path === 'controllers/bookingController.js').sha = shaB;
    }
    return fixture;
  } });
  assert.equal(result.passed, false);
});

test('unapproved empty directory and unrelated subtree hash changes fail closed', () => {
  const synchronizedTree = `repos/${repository}/git/trees/${synchronizedTreeSha}?recursive=1`;
  for (const modify of [
    (tree) => { tree.tree.push(treeEntry('unexpected-empty-dir', shaB, '040000', 'tree')); },
    (tree) => { tree.tree.find((entry) => entry.path === 'controllers').sha = shaB; },
  ]) {
    const result = runSourcePolicy({ mutateApi: (path, fixture) => {
      if (path === synchronizedTree) modify(fixture);
      return fixture;
    } });
    assert.equal(result.passed, false);
  }
});

test('missing approved and extra synchronized tree entries fail', () => {
  const synchronizedTree = `repos/${repository}/git/trees/${synchronizedTreeSha}?recursive=1`;
  for (const modify of [
    (tree) => { tree.tree = tree.tree.filter((entry) => entry.path !== waveOneFiles[0]); },
    (tree) => { tree.tree = tree.tree.filter((entry) => entry.path !== 'README.md'); },
    (tree) => { tree.tree.push(treeEntry('controllers/extra.js', shaB)); },
    (tree) => { tree.tree.push({ ...tree.tree[0] }); },
  ]) {
    const result = runSourcePolicy({ mutateApi: (path, fixture) => {
      if (path === synchronizedTree) modify(fixture);
      return fixture;
    } });
    assert.equal(result.passed, false);
  }
});

test('live PR metadata and source ref are rechecked before success', () => {
  const pullPath = `repos/${repository}/pulls/293`;
  const result = runSourcePolicy({ mutateApi: (path, fixture, calls) => {
    if (path === pullPath && calls.filter((entry) => entry === pullPath).length === 2) {
      fixture.head.sha = shaB;
    }
    return fixture;
  } });
  assert.equal(result.passed, false);
});

test('any truncated tree or required tree API failure fails closed', () => {
  for (const treeSha of [baseTreeSha, reviewedTreeSha, mainTreeSha, synchronizedTreeSha]) {
    const treePath = `repos/${repository}/git/trees/${treeSha}?recursive=1`;
    const truncated = runSourcePolicy({ mutateApi: (path, fixture) => {
      if (path === treePath) fixture.truncated = true;
      return fixture;
    } });
    assert.equal(truncated.passed, false, treeSha);
    const missing = runSourcePolicy({ failApi: treePath });
    assert.equal(missing.passed, false, treeSha);
  }
});

test('missing, extra, duplicate, and unapproved application files fail exact manifest check', () => {
  const filesPath = `repos/${repository}/pulls/293/files?per_page=100&page=1`;
  for (const modify of [
    (files) => { files.pop(); },
    (files) => { files.push({ filename: 'controllers/bookingController.js', status: 'modified' }); },
    (files) => { files[0] = { ...files[1] }; },
    (files) => { files[0].filename = 'controllers/bookingController.js'; },
  ]) {
    const result = runSourcePolicy({
      mutateApi: (path, fixture) => {
        if (path === filesPath) modify(fixture);
        return fixture;
      },
    });
    assert.equal(result.passed, false);
  }
});

test('file statuses must preserve exactly fifteen modified and two added files', () => {
  const filesPath = `repos/${repository}/pulls/293/files?per_page=100&page=1`;
  for (const modify of [
    (files) => { files[0].status = 'deleted'; },
    (files) => { files[0].status = 'added'; },
    (files) => { files.find((file) => addedWaveOneFiles.has(file.filename)).status = 'modified'; },
  ]) {
    const result = runSourcePolicy({ mutateApi: (path, fixture) => {
      if (path === filesPath) modify(fixture);
      return fixture;
    } });
    assert.equal(result.passed, false);
  }
});

test('renamed or unapproved prior path fails even when its final name is allowlisted', () => {
  const filesPath = `repos/${repository}/pulls/293/files?per_page=100&page=1`;
  const result = runSourcePolicy({
    mutateApi: (path, fixture) => {
      if (path === filesPath) {
        fixture[0].status = 'renamed';
        fixture[0].previous_filename = 'controllers/bookingController.js';
      }
      return fixture;
    },
  });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /PR files differ from the approved path, status, or blob manifest/);
});

test('GitHub API failure and malformed pagination fail closed', () => {
  const filesPath = `repos/${repository}/pulls/293/files?per_page=100&page=1`;
  const failed = runSourcePolicy({ failApi: filesPath });
  assert.equal(failed.passed, false);
  assert.match(failed.errors.join('\n'), /API evidence is unavailable/);
  const malformed = runSourcePolicy({ responses: { [filesPath]: { files: waveOneFiles } } });
  assert.equal(malformed.passed, false);
  assert.match(malformed.errors.join('\n'), /pagination is invalid/);
});

test('truncated PR-file enumeration fails against the live changed-file count', () => {
  const filesPath = `repos/${repository}/pulls/293/files?per_page=100&page=1`;
  const result = runSourcePolicy({
    responses: { [filesPath]: waveOneApiFixtures()[filesPath].slice(0, -1) },
  });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Complete Wave 1 changed-file set differs/);
});

test('arbitrary main PR, release/focused branch, and label-only claim remain ineligible', () => {
  for (const env of [
    { HEAD_REF: 'feature/new-main-change' },
    { HEAD_REF: 'release/focused/example' },
    { HEAD_REF: 'feature/new-main-change', LABELS: 'focused-release-approved' },
  ]) {
    const result = runSourcePolicy({ env });
    assert.equal(result.passed, false);
    assert.deepEqual(result.calls, []);
  }
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
