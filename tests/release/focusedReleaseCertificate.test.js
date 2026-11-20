'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASELINE_SHA,
  SOURCE_SHA,
  REPOSITORY,
  parseArgs,
  verifyFocusedReleaseSource,
  verifyLocalProvenance,
} = require('../../scripts/release/verify-focused-release-source');

const releaseSha = 'c'.repeat(40);
const candidateSha = 'd'.repeat(40);
const sourceParentSha = 'e'.repeat(40);
const treeSha = 'f'.repeat(40);
const releaseRef = 'refs/heads/release/focused/booking-9bc75c2';
const releaseBranch = releaseRef.slice('refs/heads/'.length);
const controllerPath = 'controllers/bookingController.js';
const testPath = 'tests/vendor/vendor-booking-type-filter.test.js';
const exactDiff = `M\t${controllerPath}\nA\t${testPath}`;

function ruleset(overrides = {}) {
  return {
    id: 42,
    enforcement: 'active',
    target: 'branch',
    conditions: { ref_name: { include: ['refs/heads/release/focused/*'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          required_review_thread_resolution: true,
          allowed_merge_methods: ['merge'],
        },
      },
    ],
    ...overrides,
  };
}

function pullRequest(overrides = {}) {
  return {
    number: 456,
    state: 'closed',
    merged: true,
    merged_at: '2026-10-01T20:00:00Z',
    merge_commit_sha: releaseSha,
    base: { ref: releaseBranch, repo: { full_name: REPOSITORY } },
    head: { sha: candidateSha, repo: { full_name: REPOSITORY } },
    user: { login: 'techware-author', type: 'User' },
    ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    id: 11,
    state: 'APPROVED',
    commit_id: candidateSha,
    submitted_at: '2026-10-01T19:00:00Z',
    user: { login: 'independent-reviewer', type: 'User' },
    ...overrides,
  };
}

function githubFixture(overrides = {}) {
  const responses = {
    [`/repos/${REPOSITORY}/rulesets?includes_parents=true`]: [{ id: 42 }],
    [`/repos/${REPOSITORY}/rulesets/42`]: ruleset(),
    [`/repos/${REPOSITORY}/git/ref/heads/${releaseBranch}`]: {
      ref: releaseRef,
      object: { type: 'commit', sha: releaseSha },
    },
    [`/repos/${REPOSITORY}/pulls/456`]: pullRequest(),
    [`/repos/${REPOSITORY}/pulls/456/reviews?per_page=100&page=1`]: [approval()],
    ...overrides,
  };
  const calls = [];
  return {
    calls,
    request: async (route) => {
      calls.push(route);
      if (!Object.hasOwn(responses, route)) throw new Error(`Unexpected GitHub route ${route}`);
      return responses[route];
    },
  };
}

function gitFixture(overrides = {}) {
  const responses = new Map();
  const key = (args) => args.join('\0');
  const set = (args, output) => responses.set(key(args), output);
  set(['fetch', '--no-tags', 'origin', BASELINE_SHA, SOURCE_SHA, releaseRef], '');
  for (const sha of [BASELINE_SHA, SOURCE_SHA, releaseSha, candidateSha]) {
    set(['rev-parse', '--verify', `${sha}^{commit}`], sha);
  }
  set(['rev-list', '--parents', '-n', '1', releaseSha], `${releaseSha} ${BASELINE_SHA} ${candidateSha}`);
  set(['rev-list', '--parents', '-n', '1', candidateSha], `${candidateSha} ${BASELINE_SHA}`);
  set(['rev-list', '--parents', '-n', '1', SOURCE_SHA], `${SOURCE_SHA} ${sourceParentSha}`);
  set(['log', '-1', '--format=%B', candidateSha], `Booking filter\n\n(cherry picked from commit ${SOURCE_SHA})`);
  for (const [before, after] of [
    [BASELINE_SHA, candidateSha],
    [BASELINE_SHA, releaseSha],
    [sourceParentSha, SOURCE_SHA],
  ]) {
    set(['diff', '--no-ext-diff', '--no-renames', '--name-status', before, after], exactDiff);
  }
  set(['diff', '--check', BASELINE_SHA, releaseSha], '');
  set(['rev-parse', `${candidateSha}^{tree}`], treeSha);
  set(['rev-parse', `${releaseSha}^{tree}`], treeSha);
  for (const sha of [SOURCE_SHA, candidateSha, releaseSha]) {
    set(['ls-tree', sha, '--', controllerPath], `100644 blob ${'1'.repeat(40)}\t${controllerPath}`);
    set(['ls-tree', sha, '--', testPath], `100644 blob ${'2'.repeat(40)}\t${testPath}`);
  }
  for (const sha of [sourceParentSha, BASELINE_SHA]) {
    set(['ls-tree', sha, '--', controllerPath], `100644 blob ${'3'.repeat(40)}\t${controllerPath}`);
    set(['ls-tree', sha, '--', testPath], '');
  }
  for (const [command, value] of Object.entries(overrides)) responses.set(command, value);
  const calls = [];
  return {
    calls,
    key,
    run: (args) => {
      calls.push(args);
      const command = key(args);
      if (!responses.has(command)) throw new Error(`Unexpected git command ${args.join(' ')}`);
      return responses.get(command);
    },
  };
}

async function verify({ github = githubFixture(), git = gitFixture(), ...overrides } = {}) {
  return verifyFocusedReleaseSource({
    repository: REPOSITORY,
    releaseSha,
    baselineSha: BASELINE_SHA,
    releaseRef,
    prNumber: 456,
    githubRequest: github.request,
    runGit: git.run,
    ...overrides,
  });
}

test('CLI accepts only the exact approved baseline, protected ref, and complete inputs', async () => {
  const args = parseArgs([
    '--release-sha', releaseSha,
    '--baseline-sha', BASELINE_SHA,
    '--release-ref', releaseRef,
    '--pr-number', '456',
    '--output', 'certificate.json',
  ]);
  assert.equal(args.prNumber, 456);
  assert.throws(() => parseArgs([
    '--release-sha', releaseSha,
    '--baseline-sha', 'a'.repeat(40),
    '--release-ref', releaseRef,
    '--pr-number', '456',
    '--output', 'certificate.json',
  ]), /approved production SHA/);
  await assert.rejects(verify({ releaseRef: 'refs/heads/release/focused/Nested/branch' }), /releaseRef/);
  await assert.rejects(verify({ repository: 'attacker/mosaic-backend' }), /canonical/);
});

test('certificate binds protected branch, merged PR, current review, exact Git graph and source blobs', async () => {
  const github = githubFixture();
  const git = gitFixture();
  const result = await verify({ github, git });
  assert.equal(result.status, 'passed');
  assert.equal(result.mode, 'focused-baseline');
  assert.equal(result.releaseSha, releaseSha);
  assert.equal(result.branchTipSha, releaseSha);
  assert.equal(result.baselineSha, BASELINE_SHA);
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.equal(result.sourcePr, 456);
  assert.equal(result.rulesetBypassActorsVisible, true);
  assert.equal(result.pullRequest.approval.reviewer, 'independent-reviewer');
  assert.equal(result.changedFiles.length, 2);
  assert.equal(result.productionAccepted, false);
  assert(git.calls.some((args) => args[0] === 'fetch' && args.includes(releaseRef)));
  assert(github.calls.includes(`/repos/${REPOSITORY}/git/ref/heads/${releaseBranch}`));
});

test('focused branch requires active, approved merge-only rules and rejects visible bypasses', async () => {
  for (const invalid of [
    ruleset({ enforcement: 'disabled' }),
    ruleset({ bypass_actors: [{ actor_id: 1 }] }),
    ruleset({ conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } }),
    ruleset({ rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 0 } }] }),
  ]) {
    const github = githubFixture({ [`/repos/${REPOSITORY}/rulesets/42`]: invalid });
    await assert.rejects(verify({ github }), /required active protected PR ruleset/);
  }
});

test('read-only GitHub ruleset responses do not imply no-bypass proof', async () => {
  const withoutVisibleBypasses = ruleset();
  delete withoutVisibleBypasses.bypass_actors;
  const github = githubFixture({
    [`/repos/${REPOSITORY}/rulesets/42`]: withoutVisibleBypasses,
  });
  const result = await verify({ github });
  assert.equal(result.rulesetBypassActorsVisible, false);
  assert.equal(result.productionAccepted, false);
});

test('changed branch tip, fork source, or unmerged PR fails before local Git proof', async () => {
  const wrongTip = githubFixture({
    [`/repos/${REPOSITORY}/git/ref/heads/${releaseBranch}`]: {
      ref: releaseRef,
      object: { type: 'commit', sha: '9'.repeat(40) },
    },
  });
  await assert.rejects(verify({ github: wrongTip }), /branch tip differs/);
  const fork = githubFixture({
    [`/repos/${REPOSITORY}/pulls/456`]: pullRequest({
      head: { sha: candidateSha, repo: { full_name: 'attacker/fork' } },
    }),
  });
  await assert.rejects(verify({ github: fork }), /merged same-repository/);
  const unmerged = githubFixture({
    [`/repos/${REPOSITORY}/pulls/456`]: pullRequest({ merged: false }),
  });
  await assert.rejects(verify({ github: unmerged }), /merged same-repository/);
});

test('branch tip must still be exact after local provenance verification', async () => {
  const github = githubFixture();
  const original = github.request;
  let refReads = 0;
  github.request = async (route) => {
    if (route === `/repos/${REPOSITORY}/git/ref/heads/${releaseBranch}` && ++refReads === 2) {
      return { ref: releaseRef, object: { type: 'commit', sha: '9'.repeat(40) } };
    }
    return original(route);
  };
  await assert.rejects(verify({ github }), /changed during source certification/);
});

test('stale or superseded approvals do not certify a PR', async () => {
  const stale = githubFixture({
    [`/repos/${REPOSITORY}/pulls/456/reviews?per_page=100&page=1`]: [
      approval({ commit_id: '9'.repeat(40) }),
    ],
  });
  await assert.rejects(verify({ github: stale }), /current independent human approval/);
  const withdrawn = githubFixture({
    [`/repos/${REPOSITORY}/pulls/456/reviews?per_page=100&page=1`]: [
      approval(), approval({ id: 12, state: 'CHANGES_REQUESTED' }),
    ],
  });
  await assert.rejects(verify({ github: withdrawn }), /current independent human approval/);
  const selfReview = githubFixture({
    [`/repos/${REPOSITORY}/pulls/456/reviews?per_page=100&page=1`]: [
      approval({ user: { login: 'techware-author', type: 'User' } }),
    ],
  });
  await assert.rejects(verify({ github: selfReview }), /current independent human approval/);
});

test('local provenance rejects an extra path, wrong parent, altered blob, or missing cherry-pick trailer', () => {
  const base = { releaseSha, baselineSha: BASELINE_SHA, releaseRef, candidateSha };
  const cases = [
    [
      ['diff', '--no-ext-diff', '--no-renames', '--name-status', BASELINE_SHA, releaseSha],
      `${exactDiff}\nM\tmodels/Booking.js`,
      /exactly the approved/,
    ],
    [
      ['rev-list', '--parents', '-n', '1', releaseSha],
      `${releaseSha} ${candidateSha} ${BASELINE_SHA}`,
      /two-parent merge/,
    ],
    [
      ['ls-tree', releaseSha, '--', controllerPath],
      `100644 blob ${'9'.repeat(40)}\t${controllerPath}`,
      /blob or mode differs/,
    ],
    [
      ['log', '-1', '--format=%B', candidateSha],
      'Booking filter without provenance',
      /cherry-pick provenance/,
    ],
  ];
  for (const [command, output, expected] of cases) {
    const fixture = gitFixture();
    const altered = gitFixture({ [fixture.key(command)]: output });
    assert.throws(() => verifyLocalProvenance({ ...base, runGit: altered.run }), expected);
  }
});
