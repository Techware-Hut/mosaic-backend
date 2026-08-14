#!/usr/bin/env node
'use strict';

const https = require('node:https');
const { assertFullSha, sanitizeMessage } = require('./release-control-utils');

const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_POLL_SECONDS = 15;

/*
 * CLI/environment contract:
 *   node scripts/release/require-exact-ci-success.js \
 *     --repository owner/repo --branch staging --sha <full-sha> \
 *     [--workflow ci.yml] [--timeout-seconds 900] [--poll-seconds 15]
 *
 * RELEASE_CI_BRANCH, RELEASE_CANDIDATE_SHA, RELEASE_CI_WORKFLOW,
 * RELEASE_CI_TIMEOUT_SECONDS, and RELEASE_CI_POLL_SECONDS provide equivalent
 * environment inputs. GITHUB_REPOSITORY and GITHUB_TOKEN are required in
 * Actions. The token is deliberately environment-only so it never appears in
 * process arguments or output. Successful stdout is one non-secret JSON row.
 */

function parsePositiveInteger(value, name, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function parseArgs(argv, env = process.env) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    values[name] = value;
    index += 1;
  }

  const config = {
    repository: values.repository || env.GITHUB_REPOSITORY,
    branch: values.branch || env.RELEASE_CI_BRANCH,
    sha: assertFullSha(values.sha || env.RELEASE_CANDIDATE_SHA, 'sha'),
    token: env.GITHUB_TOKEN,
    workflow: values.workflow || env.RELEASE_CI_WORKFLOW || 'ci.yml',
    timeoutSeconds: parsePositiveInteger(
      values['timeout-seconds'] || env.RELEASE_CI_TIMEOUT_SECONDS,
      'timeout-seconds',
      DEFAULT_TIMEOUT_SECONDS
    ),
    pollSeconds: parsePositiveInteger(
      values['poll-seconds'] || env.RELEASE_CI_POLL_SECONDS,
      'poll-seconds',
      DEFAULT_POLL_SECONDS
    ),
  };

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository || '')) {
    throw new Error('repository must be owner/name');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(config.branch || '')) {
    throw new Error('branch is required and contains unsupported characters');
  }
  if (!config.token) throw new Error('GITHUB_TOKEN is required');
  if (config.pollSeconds > config.timeoutSeconds) {
    throw new Error('poll-seconds cannot exceed timeout-seconds');
  }

  return config;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function githubRequest({ repository, token }, apiPath) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${repository}${apiPath}`,
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'mosaic-release-control',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          let payload;
          try {
            payload = body ? JSON.parse(body) : {};
          } catch (_error) {
            reject(new Error(`GitHub API returned invalid JSON for ${apiPath}`));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GitHub API ${response.statusCode} for ${apiPath}: ${payload.message || 'request failed'}`));
            return;
          }
          resolve(payload);
        });
      }
    );
    request.setTimeout(15000, () => request.destroy(new Error('GitHub API request timed out')));
    request.on('error', reject);
    request.end();
  });
}

function currentCanonicalSha(refPayload) {
  return String(refPayload?.object?.sha || '').toLowerCase();
}

function matchingExactRuns(payload, config) {
  const expectedRepository = config.repository.toLowerCase();
  return (payload.workflow_runs || []).filter((run) => (
    String(run.head_sha || '').toLowerCase() === config.sha
      && run.event === 'push'
      && run.head_branch === config.branch
      && String(run.repository?.full_name || '').toLowerCase() === expectedRepository
      && String(run.head_repository?.full_name || '').toLowerCase() === expectedRepository
      && run.path === '.github/workflows/ci.yml'
  ));
}

function newestExactRun(runs) {
  return [...runs].sort((left, right) => {
    const timeDifference = Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0);
    if (timeDifference !== 0) return timeDifference;
    const numberDifference = Number(right.run_number || 0) - Number(left.run_number || 0);
    if (numberDifference !== 0) return numberDifference;
    const attemptDifference = Number(right.run_attempt || 0) - Number(left.run_attempt || 0);
    if (attemptDifference !== 0) return attemptDifference;
    return Number(right.id || 0) - Number(left.id || 0);
  })[0];
}

async function requireExactCiSuccess(config, dependencies = {}) {
  const request = dependencies.request || githubRequest;
  const wait = dependencies.delay || delay;
  const now = dependencies.now || Date.now;
  const deadline = now() + (config.timeoutSeconds * 1000);
  const encodedBranch = encodeURIComponent(config.branch);

  const workflow = await request(config, `/actions/workflows/${encodeURIComponent(config.workflow)}`);
  if (workflow.path !== '.github/workflows/ci.yml' || workflow.state !== 'active') {
    throw new Error('Canonical CI workflow is missing, inactive, or has an unexpected path');
  }

  while (true) {
    const ref = await request(config, `/git/ref/heads/${encodedBranch}`);
    const observedSha = currentCanonicalSha(ref);
    if (observedSha !== config.sha) {
      throw new Error(
        `Stale release candidate: canonical ${config.repository}:${config.branch} is ${observedSha || 'unknown'}, expected ${config.sha}`
      );
    }

    const runs = await request(
      config,
      `/actions/workflows/${encodeURIComponent(config.workflow)}/runs?event=push&branch=${encodedBranch}&head_sha=${config.sha}&per_page=100`
    );
    const exactRuns = matchingExactRuns(runs, config);
    const selected = newestExactRun(exactRuns);
    if (selected?.status === 'completed' && selected.conclusion === 'success') {
      const finalRef = await request(config, `/git/ref/heads/${encodedBranch}`);
      const finalSha = currentCanonicalSha(finalRef);
      if (finalSha !== config.sha) {
        throw new Error(`Release candidate became stale after CI verification: observed ${finalSha || 'unknown'}`);
      }
      return {
        runId: selected.id,
        runAttempt: selected.run_attempt,
        runUrl: selected.html_url,
        workflowId: workflow.id,
        workflowPath: workflow.path,
        sha: config.sha,
        branch: config.branch,
        repository: config.repository,
      };
    }

    if (selected?.status === 'completed') {
      throw new Error(`Newest exact CI run ${selected.id} completed with ${selected.conclusion || 'unknown'}: ${selected.html_url || 'no URL'}`);
    }

    if (now() >= deadline) {
      throw new Error(`Timed out waiting for successful exact CI push run for ${config.sha}`);
    }
    await wait(config.pollSeconds * 1000);
  }
}

async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const result = await requireExactCiSuccess(config);
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Exact CI verification failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  matchingExactRuns,
  newestExactRun,
  currentCanonicalSha,
  requireExactCiSuccess,
  githubRequest,
  main,
};
