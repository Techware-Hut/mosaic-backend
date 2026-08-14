#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  githubRequestFactory,
} = require('./verify-main-release-source');
const {
  renderSummary,
} = require('./build-production-evidence');

const MARKER = '<!-- mosaic-production-release-evidence -->';

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--evidence') {
    throw new Error('Usage: upsert-release-pr-comment.js --evidence <json>');
  }
  return argv[1];
}

async function githubWriteFactory({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const request = githubRequestFactory({ token, apiUrl, fetchImpl });
  return async (route, method = 'GET', body) => {
    if (method === 'GET') return request(route);
    const response = await fetchImpl(`${apiUrl.replace(/\/$/, '')}${route}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub comment request failed with HTTP ${response.status}`);
    return response.json();
  };
}

async function upsertReleaseComment({ repository, evidence, githubWrite }) {
  const pullNumber = evidence?.source?.releasePullRequest?.number;
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    return { action: 'skipped', reason: 'release PR is unavailable' };
  }
  const body = `${MARKER}\n${renderSummary(evidence)}\n\n[Workflow run](${evidence.workflowRunUrl})`;
  const comments = await githubWrite(`/repos/${repository}/issues/${pullNumber}/comments?per_page=100`);
  const existing = comments.find((comment) => (
    comment?.user?.type === 'Bot' && String(comment?.body || '').includes(MARKER)
  ));
  if (existing) {
    await githubWrite(`/repos/${repository}/issues/comments/${existing.id}`, 'PATCH', { body });
    return { action: 'updated', pullNumber };
  }
  await githubWrite(`/repos/${repository}/issues/${pullNumber}/comments`, 'POST', { body });
  return { action: 'created', pullNumber };
}

async function main(argv = process.argv.slice(2)) {
  const evidencePath = parseArgs(argv);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[^/]+\/[^/]+$/.test(repository || '')) throw new Error('GITHUB_REPOSITORY is invalid');
  const githubWrite = await githubWriteFactory({
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  const result = await upsertReleaseComment({ repository, evidence, githubWrite });
  console.log(`Release PR comment ${result.action}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Release PR evidence comment failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MARKER,
  parseArgs,
  githubWriteFactory,
  upsertReleaseComment,
};
