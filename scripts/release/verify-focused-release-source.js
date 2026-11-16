#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { githubRequestFactory } = require('./verify-main-release-source');

const REPOSITORY = 'Techware-Hut/mosaic-backend';
const BASELINE_SHA = '9bc75c257a9f483a287f122dbd38514b7a4b55d4';
const SOURCE_SHA = 'bcb9f101c58df6d7df994e94442970b91f36e74c';
const FULL_SHA = /^[a-f0-9]{40}$/;
const FOCUSED_REF = /^refs\/heads\/release\/focused\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHANGED_FILES = Object.freeze([
  ['M', 'controllers/bookingController.js'],
  ['A', 'tests/vendor/vendor-booking-type-filter.test.js'],
]);

function requireSha(value, label) {
  if (!FULL_SHA.test(value || '')) throw new Error(`${label} must be a lowercase full SHA`);
  return value;
}

function requireRef(value) {
  if (!FOCUSED_REF.test(value || '')) {
    throw new Error('releaseRef must be a single lowercase, hyphenated refs/heads/release/focused/* branch');
  }
  return value;
}

function requirePrNumber(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('prNumber must be a positive integer');
  }
  return value;
}

function parseArgs(argv) {
  const values = {};
  const known = new Set(['--release-sha', '--baseline-sha', '--release-ref', '--pr-number', '--output']);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!known.has(key) || value === undefined || Object.hasOwn(values, key)) {
      throw new Error('Usage: verify-focused-release-source.js --release-sha <sha> --baseline-sha <sha> --release-ref <ref> --pr-number <number> --output <path>');
    }
    values[key] = value;
  }
  const releaseSha = requireSha(values['--release-sha'], 'releaseSha');
  const baselineSha = requireSha(values['--baseline-sha'], 'baselineSha');
  if (baselineSha !== BASELINE_SHA) throw new Error('Focused baseline differs from the approved production SHA');
  const releaseRef = requireRef(values['--release-ref']);
  if (!/^[1-9][0-9]*$/.test(values['--pr-number'] || '')) throw new Error('prNumber must be a positive integer');
  const prNumber = requirePrNumber(Number(values['--pr-number']));
  if (typeof values['--output'] !== 'string' || values['--output'].length === 0) {
    throw new Error('output path is required');
  }
  return { releaseSha, baselineSha, releaseRef, prNumber, output: values['--output'] };
}

function gitRunner(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseParents(value, expectedSha, label) {
  const shas = value.trim().split(/\s+/);
  if (shas[0] !== expectedSha || shas.slice(1).some((sha) => !FULL_SHA.test(sha))) {
    throw new Error(`${label} identity or parent list was invalid`);
  }
  return shas.slice(1);
}

function parseDiff(value, label) {
  const entries = value ? value.trim().split(/\r?\n/).map((line) => line.split('\t')) : [];
  if (entries.some((entry) => entry.length !== 2)) throw new Error(`${label} name-status diff was malformed`);
  const actual = entries.map(([status, file]) => `${status}\t${file}`).sort();
  const expected = CHANGED_FILES.map(([status, file]) => `${status}\t${file}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly the approved booking controller and test changes`);
  }
}

function gitTreeEntry(runGit, sha, file) {
  const output = runGit(['ls-tree', sha, '--', file]);
  if (!output) return null;
  const match = output.match(/^([0-7]{6}) blob ([a-f0-9]{40})\t(.+)$/);
  if (!match || match[3] !== file) throw new Error(`Git tree entry was malformed for ${file}`);
  return { mode: match[1], blobSha: match[2] };
}

function verifyLocalProvenance({ releaseSha, baselineSha, releaseRef, candidateSha, runGit = gitRunner }) {
  requireSha(releaseSha, 'releaseSha');
  requireSha(baselineSha, 'baselineSha');
  requireSha(candidateSha, 'candidateSha');
  requireRef(releaseRef);
  if (baselineSha !== BASELINE_SHA) throw new Error('Focused baseline differs from the approved production SHA');
  // Fetch the protected remote ref, not code or an artifact supplied by the PR.
  runGit(['fetch', '--no-tags', 'origin', baselineSha, SOURCE_SHA, releaseRef]);
  for (const sha of [baselineSha, SOURCE_SHA, releaseSha, candidateSha]) {
    if (runGit(['rev-parse', '--verify', `${sha}^{commit}`]) !== sha) {
      throw new Error(`Git did not resolve exact commit ${sha}`);
    }
  }

  const releaseParents = parseParents(runGit(['rev-list', '--parents', '-n', '1', releaseSha]), releaseSha, 'Release');
  if (releaseParents.length !== 2 || releaseParents[0] !== baselineSha || releaseParents[1] !== candidateSha) {
    throw new Error('Focused release must be a two-parent merge of baseline then reviewed cherry-pick');
  }
  const candidateParents = parseParents(runGit(['rev-list', '--parents', '-n', '1', candidateSha]), candidateSha, 'Candidate');
  if (candidateParents.length !== 1 || candidateParents[0] !== baselineSha) {
    throw new Error('Reviewed candidate must be one commit directly on the production baseline');
  }
  const sourceParents = parseParents(runGit(['rev-list', '--parents', '-n', '1', SOURCE_SHA]), SOURCE_SHA, 'Approved source');
  if (sourceParents.length !== 1) throw new Error('Approved booking source must have one parent');

  const cherryPickMessage = runGit(['log', '-1', '--format=%B', candidateSha]);
  if (!new RegExp(`^\\(cherry picked from commit ${SOURCE_SHA}\\)$`, 'm').test(cherryPickMessage)) {
    throw new Error('Reviewed candidate lacks the exact approved cherry-pick provenance trailer');
  }
  parseDiff(runGit(['diff', '--no-ext-diff', '--no-renames', '--name-status', baselineSha, candidateSha]), 'Candidate');
  parseDiff(runGit(['diff', '--no-ext-diff', '--no-renames', '--name-status', baselineSha, releaseSha]), 'Release');
  parseDiff(runGit(['diff', '--no-ext-diff', '--no-renames', '--name-status', sourceParents[0], SOURCE_SHA]), 'Approved source');
  runGit(['diff', '--check', baselineSha, releaseSha]);

  const candidateTree = runGit(['rev-parse', `${candidateSha}^{tree}`]);
  const releaseTree = runGit(['rev-parse', `${releaseSha}^{tree}`]);
  if (!FULL_SHA.test(candidateTree) || candidateTree !== releaseTree) {
    throw new Error('Merge tree differs from the reviewed one-commit cherry-pick tree');
  }
  const fileBlobs = {};
  for (const [, file] of CHANGED_FILES) {
    const source = gitTreeEntry(runGit, SOURCE_SHA, file);
    const candidate = gitTreeEntry(runGit, candidateSha, file);
    const release = gitTreeEntry(runGit, releaseSha, file);
    if (!source || !candidate || !release
      || source.mode !== candidate.mode || source.mode !== release.mode
      || source.blobSha !== candidate.blobSha || source.blobSha !== release.blobSha) {
      throw new Error(`Focused ${file} blob or mode differs from the approved source`);
    }
    const original = gitTreeEntry(runGit, sourceParents[0], file);
    const baseline = gitTreeEntry(runGit, baselineSha, file);
    if (JSON.stringify(original) !== JSON.stringify(baseline)) {
      throw new Error(`Production baseline ${file} differs from the approved source parent`);
    }
    fileBlobs[file] = source;
  }

  return {
    releaseTree,
    candidateSha,
    sourceSha: SOURCE_SHA,
    sourceParentSha: sourceParents[0],
    changedFiles: CHANGED_FILES.map(([status, file]) => ({ status, file })),
    fileBlobs,
  };
}

function latestReviewsByUser(reviews) {
  if (!Array.isArray(reviews)) throw new Error('GitHub PR reviews response was malformed');
  const latest = new Map();
  for (const review of reviews) {
    if (!Number.isSafeInteger(review?.id) || review.id <= 0
      || typeof review?.user?.login !== 'string' || review.user.login.length === 0) {
      throw new Error('GitHub PR review identity was malformed');
    }
    const previous = latest.get(review.user.login);
    if (!previous || review.id > previous.id) latest.set(review.user.login, review);
  }
  return [...latest.values()];
}

function validateApproval(reviews, pullRequest, candidateSha) {
  const mergedAt = Date.parse(pullRequest.merged_at || '');
  if (!Number.isFinite(mergedAt)) throw new Error('Merged PR timestamp was invalid');
  const approved = latestReviewsByUser(reviews).filter((review) => (
    review.state === 'APPROVED'
    && review.commit_id === candidateSha
    && review.user.type === 'User'
    && review.user.login !== pullRequest.user?.login
    && Number.isFinite(Date.parse(review.submitted_at || ''))
    && Date.parse(review.submitted_at) <= mergedAt
  ));
  if (approved.length === 0) throw new Error('Merged focused PR lacks a current independent human approval');
  const selected = approved.sort((left, right) => right.id - left.id)[0];
  return { reviewId: selected.id, reviewer: selected.user.login, submittedAt: selected.submitted_at };
}

async function getAllReviews(githubRequest, repository, prNumber) {
  const reviews = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubRequest(`/repos/${repository}/pulls/${prNumber}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GitHub PR reviews response was malformed');
    reviews.push(...batch);
    if (batch.length < 100) return reviews;
  }
  throw new Error('GitHub PR review history exceeded the bounded verification limit');
}

function verifyRuleset(ruleset, releaseRef) {
  const conditions = ruleset?.conditions?.ref_name;
  const include = conditions?.include || [];
  const exclude = conditions?.exclude || [];
  const allowedPatterns = [releaseRef, 'refs/heads/release/focused/*'];
  if (ruleset?.enforcement !== 'active' || ruleset?.target !== 'branch'
    || !Array.isArray(include) || !include.some((pattern) => allowedPatterns.includes(pattern))
    || !Array.isArray(exclude) || exclude.length !== 0
    // GitHub omits bypass_actors from read-only ruleset responses. Exact PR,
    // review, and merge-graph proof below still excludes bypassed direct pushes.
    // A visible nonempty bypass list is rejected; hidden bypasses remain an
    // explicit external infrastructure proof, never an implied no-bypass claim.
    || (ruleset?.bypass_actors !== undefined
      && (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0))) {
    return false;
  }
  const rules = ruleset.rules || [];
  const pullRequest = rules.find((rule) => rule.type === 'pull_request')?.parameters;
  return rules.some((rule) => rule.type === 'deletion')
    && rules.some((rule) => rule.type === 'non_fast_forward')
    && Number.isSafeInteger(pullRequest?.required_approving_review_count)
    && pullRequest.required_approving_review_count >= 1
    && pullRequest.dismiss_stale_reviews_on_push === true
    && pullRequest.required_review_thread_resolution === true
    && Array.isArray(pullRequest.allowed_merge_methods)
    && pullRequest.allowed_merge_methods.length === 1
    && pullRequest.allowed_merge_methods[0] === 'merge';
}

async function requireProtectedFocusedRef(githubRequest, repository, releaseRef) {
  const rulesets = await githubRequest(`/repos/${repository}/rulesets?includes_parents=true`);
  if (!Array.isArray(rulesets)) throw new Error('GitHub ruleset response was malformed');
  for (const summary of rulesets) {
    if (!Number.isSafeInteger(summary?.id) || summary.id <= 0) continue;
    const ruleset = await githubRequest(`/repos/${repository}/rulesets/${summary.id}`);
    if (verifyRuleset(ruleset, releaseRef)) {
      return {
        id: ruleset.id,
        bypassActorsVisible: Array.isArray(ruleset.bypass_actors),
      };
    }
  }
  throw new Error('Focused release ref lacks the required active protected PR ruleset');
}

async function verifyFocusedReleaseSource({
  repository = REPOSITORY,
  releaseSha,
  baselineSha,
  releaseRef,
  prNumber,
  githubRequest,
  runGit = gitRunner,
}) {
  if (repository !== REPOSITORY) throw new Error('Focused release repository must be canonical Techware-Hut/mosaic-backend');
  requireSha(releaseSha, 'releaseSha');
  requireSha(baselineSha, 'baselineSha');
  if (baselineSha !== BASELINE_SHA) throw new Error('Focused baseline differs from the approved production SHA');
  requireRef(releaseRef);
  requirePrNumber(prNumber);
  if (typeof githubRequest !== 'function') throw new Error('githubRequest is required');

  const releaseBranch = releaseRef.slice('refs/heads/'.length);
  const rulesetProof = await requireProtectedFocusedRef(githubRequest, repository, releaseRef);
  const remoteRef = await githubRequest(`/repos/${repository}/git/ref/heads/${releaseBranch}`);
  if (remoteRef?.ref !== releaseRef || remoteRef?.object?.type !== 'commit'
    || remoteRef.object.sha !== releaseSha) {
    throw new Error('Protected focused branch tip differs from the requested exact release SHA');
  }
  const pullRequest = await githubRequest(`/repos/${repository}/pulls/${prNumber}`);
  const candidateSha = pullRequest?.head?.sha;
  if (pullRequest?.number !== prNumber || pullRequest?.state !== 'closed' || pullRequest?.merged !== true
    || !pullRequest.merged_at || pullRequest.merge_commit_sha !== releaseSha
    || pullRequest.base?.ref !== releaseBranch || pullRequest.base?.repo?.full_name !== repository
    || pullRequest.head?.repo?.full_name !== repository || !FULL_SHA.test(candidateSha || '')
    || pullRequest.user?.type !== 'User') {
    throw new Error('PR was not the merged same-repository focused release source for this exact SHA');
  }
  const reviews = await getAllReviews(githubRequest, repository, prNumber);
  const approval = validateApproval(reviews, pullRequest, candidateSha);
  const provenance = verifyLocalProvenance({ releaseSha, baselineSha, releaseRef, candidateSha, runGit });
  const finalRef = await githubRequest(`/repos/${repository}/git/ref/heads/${releaseBranch}`);
  if (finalRef?.ref !== releaseRef || finalRef?.object?.type !== 'commit'
    || finalRef.object.sha !== releaseSha) {
    throw new Error('Protected focused branch tip changed during source certification');
  }
  return {
    schemaVersion: 1,
    status: 'passed',
    mode: 'focused-baseline',
    repository,
    releaseSha,
    branchTipSha: releaseSha,
    baselineSha,
    releaseRef,
    releaseTree: provenance.releaseTree,
    sourceSha: SOURCE_SHA,
    sourceParentSha: provenance.sourceParentSha,
    candidateSha,
    sourcePr: prNumber,
    focusedRulesetId: rulesetProof.id,
    rulesetBypassActorsVisible: rulesetProof.bypassActorsVisible,
    pullRequest: {
      number: prNumber,
      url: `https://github.com/${repository}/pull/${prNumber}`,
      mergedAt: pullRequest.merged_at,
      approval,
    },
    changedFiles: provenance.changedFiles,
    fileBlobs: provenance.fileBlobs,
    productionAccepted: false,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const githubRequest = githubRequestFactory({
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  const certificate = await verifyFocusedReleaseSource({
    ...args,
    repository: process.env.GITHUB_REPOSITORY,
    githubRequest,
  });
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(certificate, null, 2)}\n`, { mode: 0o600 });
  console.log(`Verified focused source certificate for ${args.releaseSha}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Focused release-source verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BASELINE_SHA,
  SOURCE_SHA,
  REPOSITORY,
  CHANGED_FILES,
  parseArgs,
  parseDiff,
  validateApproval,
  verifyRuleset,
  verifyLocalProvenance,
  verifyFocusedReleaseSource,
};
