#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const {
  assertFullSha,
  nowIso,
  parseOptions,
  optionalOption,
  requireOption,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const SENSITIVE_PATH_PATTERN = /(stripe|payment|checkout|order|webhook|inventory|mailer|email)/i;

/*
 * CLI/environment contract:
 *   node scripts/release/build-release-manifest.js \
 *     --candidate-sha <full-staging-sha> --main-sha <full-main-sha> \
 *     --ci-result <exact-ci-result.json> --repository owner/repo \
 *     --output <new-json-path>
 *
 * RELEASE_CANDIDATE_SHA, RELEASE_MAIN_SHA, RELEASE_CI_RESULT,
 * GITHUB_REPOSITORY, and RELEASE_MANIFEST_OUTPUT are equivalent environment
 * inputs. The output path must not exist; this script never overwrites a
 * certification record.
 */

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...options });
}

function trimmed(value) {
  return String(value || '').trim();
}

function nulFields(value) {
  return String(value || '').split('\0').filter((entry) => entry !== '');
}

function parseArgs(argv, env = process.env) {
  const options = parseOptions(argv);

  return {
    candidateSha: assertFullSha(options['--candidate-sha'] || env.RELEASE_CANDIDATE_SHA, 'candidate-sha'),
    mainSha: assertFullSha(options['--main-sha'] || env.RELEASE_MAIN_SHA, 'main-sha'),
    ciResultPath: requireOption(
      { value: options['--ci-result'] || env.RELEASE_CI_RESULT },
      'value'
    ),
    repository: requireOption(
      { value: options['--repository'] || env.GITHUB_REPOSITORY },
      'value'
    ),
    output: optionalOption(
      { value: options['--output'] || env.RELEASE_MANIFEST_OUTPUT },
      'value',
      'staging-certification.json'
    ),
  };
}

function buildManifest(config, dependencies = {}) {
  const runGit = dependencies.git || git;
  const generatedAt = dependencies.generatedAt || nowIso();
  const ciResult = dependencies.ciResult || JSON.parse(fs.readFileSync(config.ciResultPath, 'utf8'));
  if (trimmed(runGit(['rev-parse', `${config.candidateSha}^{commit}`])).toLowerCase() !== config.candidateSha) {
    throw new Error('candidate-sha did not resolve exactly');
  }
  if (trimmed(runGit(['rev-parse', `${config.mainSha}^{commit}`])).toLowerCase() !== config.mainSha) {
    throw new Error('main-sha did not resolve exactly');
  }
  if (
    ciResult.sha !== config.candidateSha
    || ciResult.branch !== 'staging'
    || ciResult.repository !== config.repository
    || ciResult.workflowPath !== '.github/workflows/ci.yml'
    || !ciResult.runId
    || !ciResult.runUrl
  ) {
    throw new Error('Exact CI result does not match the staging certification candidate');
  }

  const mergeBase = assertFullSha(trimmed(runGit(['merge-base', config.mainSha, config.candidateSha])), 'merge-base');
  let promotionBaseline;
  let provenance;
  if (mergeBase === config.mainSha) {
    promotionBaseline = config.mainSha;
    provenance = 'main-ancestor';
  } else {
    const parentFields = trimmed(runGit(['rev-list', '--parents', '-n', '1', config.mainSha])).split(/\s+/);
    if (parentFields.length !== 3) {
      throw new Error('Main/staging history is ambiguous; expected current main or a canonical two-parent promotion merge');
    }
    const stagingParent = assertFullSha(parentFields[2], 'main staging parent');
    const stagingParentMergeBase = assertFullSha(
      trimmed(runGit(['merge-base', stagingParent, config.candidateSha])),
      'staging-parent merge-base'
    );
    const mainTree = trimmed(runGit(['rev-parse', `${config.mainSha}^{tree}`]));
    const stagingParentTree = trimmed(runGit(['rev-parse', `${stagingParent}^{tree}`]));
    if (stagingParentMergeBase !== stagingParent || mainTree !== stagingParentTree) {
      throw new Error('Main contains content or history not synchronized into canonical staging');
    }
    promotionBaseline = stagingParent;
    provenance = 'promotion-merge-wrapper';
  }

  const commitFields = nulFields(runGit([
    'log', '-z', '--reverse', '--format=%H%x00%s', `${promotionBaseline}..${config.candidateSha}`,
  ]));
  if (commitFields.length % 2 !== 0) throw new Error('Git returned malformed commit metadata');
  const commits = [];
  for (let index = 0; index < commitFields.length; index += 2) {
    commits.push({ sha: assertFullSha(commitFields[index], 'commit SHA'), subject: commitFields[index + 1] });
  }
  const changedFiles = nulFields(runGit([
    'diff', '--name-only', '-z', config.mainSha, config.candidateSha,
  ]));
  const sourcePrs = [...new Set(commits.flatMap(({ subject }) => (
    [...subject.matchAll(/#(\d+)/g)].map((match) => Number(match[1]))
  )))].sort((left, right) => left - right);

  const productionUat = [];
  if (changedFiles.some((file) => /(stripe|payment|checkout|webhook)/i.test(file))) {
    productionUat.push('controlled-payment-success', 'payment-failure-negative-case', 'webhook-replay');
  }
  if (changedFiles.some((file) => /(mailer|mail|email)/i.test(file))) {
    productionUat.push('transactional-email-delivery', 'duplicate-email-negative-case');
  }
  if (changedFiles.some((file) => /inventory/i.test(file))) {
    productionUat.push('inventory-reservation-and-finalization');
  }

  const manifest = {
    schemaVersion: 1,
    repository: config.repository,
    sourceBranch: 'staging',
    targetBranch: 'main',
    candidateSha: config.candidateSha,
    mainSha: config.mainSha,
    mergeBase,
    promotionBaseline,
    provenance,
    generatedAt,
    ci: {
      workflow: 'ci.yml',
      event: 'push',
      branch: 'staging',
      workflowId: ciResult.workflowId,
      runId: ciResult.runId,
      runAttempt: ciResult.runAttempt,
      runUrl: ciResult.runUrl,
      conclusion: 'success',
    },
    commits,
    changedFiles,
    sourcePrs,
    riskSignals: {
      sensitiveFiles: changedFiles.filter((file) => SENSITIVE_PATH_PATTERN.test(file)),
      migrationsOrSchema: changedFiles.filter((file) => /(^|\/)(migration|migrations|models|schema)(\/|[-_.])/i.test(file)),
      paymentSensitive: changedFiles.some((file) => /(stripe|payment|checkout|webhook)/i.test(file)),
      emailSensitive: changedFiles.some((file) => /(mailer|mail|email)/i.test(file)),
      inventorySensitive: changedFiles.some((file) => /inventory/i.test(file)),
      mixedVersionSafe: false,
    },
    rollback: {
      previousMainSha: config.mainSha,
      note: 'Keep checkout gated and redeploy the approved known-good main SHA after release-specific safety checks.',
    },
    requiredProductionProof: [
      'exact-main-preflight',
      'checkout-gate-and-drain',
      'zero-active-reservations-before-and-after-deploy',
      'exact-eb-instance-and-public-release-identity',
      'health-readiness-auth-cors-and-featured-products',
    ],
    productionUat: [...new Set(productionUat)],
    productionAccepted: false,
  };

  const canonicalPayload = `${JSON.stringify(manifest, null, 2)}\n`;
  manifest.contentSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  return manifest;
}

function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const manifest = buildManifest(config);
  if (fs.existsSync(config.output)) throw new Error(`Refusing to overwrite existing manifest: ${config.output}`);
  writeJson(config.output, manifest);
  console.log(`Wrote immutable staging certification manifest to ${config.output}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Release manifest generation failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildManifest,
  renderManifest,
  main,
};
