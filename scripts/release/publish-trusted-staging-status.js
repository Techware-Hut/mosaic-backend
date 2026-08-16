#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  assertFullSha,
  parseOptions,
  sanitizeMessage,
} = require('./release-control-utils');
const {
  githubRequest,
  readRefs,
  requireExpectedRefs,
} = require('./ensure-staging-release-pr');

const STATUS_CONTEXT = 'mosaic/trusted-staging-certification';

function parseArgs(argv, env = process.env) {
  const options = parseOptions(argv);
  const config = {
    repository: options['--repository'] || env.GITHUB_REPOSITORY,
    token: env.RELEASE_PR_TOKEN,
    candidateSha: assertFullSha(
      options['--candidate-sha'] || env.RELEASE_CANDIDATE_SHA,
      'candidate-sha'
    ),
    manifestPath: options['--manifest'] || env.RELEASE_MANIFEST_PATH,
    targetUrl: options['--target-url'] || env.RELEASE_WORKFLOW_RUN_URL,
  };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository || '')) {
    throw new Error('repository must be owner/name');
  }
  if (!config.token) throw new Error('RELEASE_PR_TOKEN is required');
  if (!config.manifestPath) throw new Error('manifest path is required');
  const escapedRepository = config.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^https://github\\.com/${escapedRepository}/actions/runs/\\d+/?$`).test(config.targetUrl || '')) {
    throw new Error('target-url must identify one canonical repository Actions run');
  }
  return config;
}

function validateManifest(config, manifest) {
  if (
    manifest.schemaVersion !== 1
    || manifest.repository !== config.repository
    || manifest.sourceBranch !== 'staging'
    || manifest.targetBranch !== 'main'
    || manifest.candidateSha !== config.candidateSha
    || !/^[0-9a-f]{40}$/.test(String(manifest.mainSha || ''))
    || manifest.ci?.conclusion !== 'success'
  ) {
    throw new Error('Trusted status manifest identity is invalid');
  }
}

async function publishTrustedStatus(config, manifest, dependencies = {}) {
  validateManifest(config, manifest);
  const request = dependencies.request || githubRequest;
  requireExpectedRefs(
    await readRefs(config, request),
    config,
    manifest,
    'before trusted certification status'
  );
  const description = `Certified for main ${manifest.mainSha}`;
  const status = await request(config, 'POST', `/statuses/${config.candidateSha}`, {
    state: 'success',
    context: STATUS_CONTEXT,
    description,
    target_url: config.targetUrl,
  });
  if (
    status?.state !== 'success'
    || status?.context !== STATUS_CONTEXT
    || status?.description !== description
    || status?.target_url !== config.targetUrl
  ) {
    throw new Error('GitHub did not confirm the exact trusted certification status');
  }
  requireExpectedRefs(
    await readRefs(config, request),
    config,
    manifest,
    'after trusted certification status'
  );
  return { context: STATUS_CONTEXT, candidateSha: config.candidateSha, mainSha: manifest.mainSha };
}

async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(config.manifestPath, 'utf8'));
  const result = await publishTrustedStatus(config, manifest);
  console.log(`Published ${result.context} for exact staging candidate.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Trusted staging status failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  STATUS_CONTEXT,
  parseArgs,
  publishTrustedStatus,
  validateManifest,
};
