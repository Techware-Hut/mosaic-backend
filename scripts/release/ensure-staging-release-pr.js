#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const { assertFullSha, parseOptions, sanitizeMessage } = require('./release-control-utils');

const MANAGED_START = '<!-- mosaic-release-automation:start -->';
const MANAGED_END = '<!-- mosaic-release-automation:end -->';

/*
 * CLI/environment contract:
 *   node scripts/release/ensure-staging-release-pr.js \
 *     --repository owner/repo --candidate-sha <full-staging-sha> \
 *     --manifest <certification.json> [--workflow-run-url <url>]
 *
 * GITHUB_REPOSITORY, RELEASE_CANDIDATE_SHA, RELEASE_MANIFEST_PATH, and
 * RELEASE_WORKFLOW_RUN_URL are equivalent inputs. The PR credential is read
 * only from RELEASE_PR_TOKEN (preferred GitHub App installation token), never
 * from a CLI argument. This script creates or updates a PR; it never merges,
 * approves, closes, labels, or writes repository contents.
 */

function parseArgs(argv, env = process.env) {
  const options = parseOptions(argv);
  const config = {
    repository: options['--repository'] || env.GITHUB_REPOSITORY,
    token: env.RELEASE_PR_TOKEN,
    candidateSha: assertFullSha(
      options['--candidate-sha'] || env.RELEASE_CANDIDATE_SHA,
      'candidate-sha'
    ),
    manifestPath: options['--manifest'] || env.RELEASE_MANIFEST_PATH || 'staging-certification.json',
    workflowRunUrl: options['--workflow-run-url'] || env.RELEASE_WORKFLOW_RUN_URL || '',
  };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository || '')) throw new Error('repository must be owner/name');
  if (!config.token) throw new Error('RELEASE_PR_TOKEN is required');
  return config;
}

function githubRequest(config, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.github.com',
      path: `/repos/${config.repository}${apiPath}`,
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'mosaic-release-control',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let payload;
        try { payload = responseBody ? JSON.parse(responseBody) : {}; } catch (_error) {
          reject(new Error(`GitHub API returned invalid JSON for ${apiPath}`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`GitHub API ${response.statusCode} for ${apiPath}: ${payload.message || 'request failed'}`);
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        resolve(payload);
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('GitHub API request timed out')));
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

function renderList(values, emptyText) {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${emptyText}`;
}

function safeMarkdownText(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/([\\`*_{}\[\]()#+|])/g, '\\$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .trim();
}

function safeInlineCode(value) {
  return `\`${String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/`/g, '&#96;')
    .trim()}\``;
}

function renderPullRequestBody(manifest, workflowRunUrl) {
  const commits = manifest.commits.map((commit) => (
    `${safeInlineCode(commit.sha.slice(0, 12))} ${safeMarkdownText(commit.subject)}`
  ));
  const files = manifest.changedFiles.map(safeInlineCode);
  const sourcePrs = manifest.sourcePrs.map((number) => `#${number}`);
  const sensitive = manifest.riskSignals.sensitiveFiles.map(safeInlineCode);
  return [
    MANAGED_START,
    '# Staging release certification',
    '',
    '> **MERGE DOES NOT EQUAL PRODUCTION ACCEPTANCE**',
    '',
    `- Exact staging SHA: \`${manifest.candidateSha}\``,
    `- Main baseline SHA: \`${manifest.mainSha}\``,
    `- Certification artifact: \`staging-certification-${manifest.candidateSha}\``,
    `- Exact CI push run: ${safeMarkdownText(manifest.ci.runUrl || `run ${manifest.ci.runId}`)}`,
    `- Certification workflow: ${safeMarkdownText(workflowRunUrl || 'current workflow run')}`,
    '',
    '## Commits entering production',
    '',
    renderList(commits, 'No commits detected.'),
    '',
    '## Changed files',
    '',
    renderList(files, 'No changed files detected.'),
    '',
    '## Source PRs where discoverable',
    '',
    renderList(sourcePrs, 'No PR numbers were discoverable from commit subjects.'),
    '',
    '## Release risk signals',
    '',
    `- Payment sensitive: **${manifest.riskSignals.paymentSensitive}**`,
    `- Email sensitive: **${manifest.riskSignals.emailSensitive}**`,
    `- Inventory sensitive: **${manifest.riskSignals.inventorySensitive}**`,
    `- Mixed-version safe: **${manifest.riskSignals.mixedVersionSafe}**`,
    `- Migration/schema files: ${manifest.riskSignals.migrationsOrSchema.length}`,
    '',
    renderList(sensitive, 'No automatically classified payment/email/order-sensitive files.'),
    '',
    '## Rollback',
    '',
    `Previous main SHA: \`${manifest.rollback.previousMainSha}\``,
    '',
    safeMarkdownText(manifest.rollback.note),
    '',
    '## Production proof still required',
    '',
    '- Exact-main production preflight and human production approval.',
    '- Checkout gate, drain, and zero active-reservation proof.',
    '- Exact EB instance/build identity and public endpoint probes.',
    '- Issue-specific business UAT; this certification is not production acceptance.',
    '',
    '## Generated production UAT signals',
    '',
    renderList(manifest.productionUat.map(safeInlineCode), 'No issue-specific UAT was inferred; human review must supply it.'),
    '',
    `Manifest payload SHA-256: \`${manifest.contentSha256}\``,
    `Manifest artifact-file SHA-256: \`${manifest.artifactFileSha256 || 'recorded by certification workflow'}\``,
    MANAGED_END,
  ].join('\n');
}

function canonicalHead(repository) {
  return `${repository.split('/')[0]}:staging`;
}

function countOccurrences(value, marker) {
  return String(value || '').split(marker).length - 1;
}

function mergeManagedBody(existingBody, managedBody) {
  const existing = String(existingBody || '').trim();
  const starts = countOccurrences(existing, MANAGED_START);
  const ends = countOccurrences(existing, MANAGED_END);
  if (starts === 0 && ends === 0) return existing ? `${existing}\n\n${managedBody}` : managedBody;
  if (starts !== 1 || ends !== 1) throw new Error('Existing release PR has malformed or duplicate automation markers');
  const startIndex = existing.indexOf(MANAGED_START);
  const endIndex = existing.indexOf(MANAGED_END);
  if (endIndex < startIndex) throw new Error('Existing release PR automation markers are out of order');
  const suffixIndex = endIndex + MANAGED_END.length;
  return `${existing.slice(0, startIndex)}${managedBody}${existing.slice(suffixIndex)}`.trim();
}

function validateCanonicalPullRequest(pullRequest, config) {
  if (
    pullRequest?.head?.ref !== 'staging'
    || pullRequest?.base?.ref !== 'main'
    || String(pullRequest?.head?.repo?.full_name || '').toLowerCase() !== config.repository.toLowerCase()
    || String(pullRequest?.base?.repo?.full_name || '').toLowerCase() !== config.repository.toLowerCase()
  ) {
    throw new Error('GitHub returned a non-canonical staging-to-main pull request');
  }
  return pullRequest;
}

async function readRefs(config, request) {
  const [staging, main] = await Promise.all([
    request(config, 'GET', '/git/ref/heads/staging'),
    request(config, 'GET', '/git/ref/heads/main'),
  ]);
  return {
    stagingSha: String(staging?.object?.sha || '').toLowerCase(),
    mainSha: String(main?.object?.sha || '').toLowerCase(),
  };
}

function requireExpectedRefs(refs, config, manifest, phase) {
  if (refs.stagingSha !== config.candidateSha) {
    throw new Error(`Stale release candidate ${phase}; canonical staging is ${refs.stagingSha || 'unknown'}`);
  }
  if (refs.mainSha !== manifest.mainSha) {
    throw new Error(`Main changed ${phase}; expected ${manifest.mainSha}, observed ${refs.mainSha || 'unknown'}`);
  }
}

async function ensureReleasePullRequest(config, manifest, dependencies = {}) {
  const request = dependencies.request || githubRequest;
  const head = canonicalHead(config.repository);

  requireExpectedRefs(await readRefs(config, request), config, manifest, 'before pull-request lookup');

  const query = `?state=open&base=main&head=${encodeURIComponent(head)}&per_page=100`;
  let pullRequests = await request(config, 'GET', `/pulls${query}`);
  if (!Array.isArray(pullRequests)) throw new Error('GitHub pull request response was not an array');
  if (pullRequests.length > 1) {
    throw new Error(`Expected at most one open staging-to-main PR; found ${pullRequests.length}`);
  }
  pullRequests.forEach((pullRequest) => validateCanonicalPullRequest(pullRequest, config));

  requireExpectedRefs(await readRefs(config, request), config, manifest, 'immediately before pull-request mutation');

  const title = `chore(release): promote staging ${config.candidateSha.slice(0, 12)} to production`;
  const managedBody = renderPullRequestBody(manifest, config.workflowRunUrl);
  if (managedBody.length > 60000) throw new Error('Generated release PR body exceeds the safe size limit');
  let result;
  if (pullRequests.length === 0) {
    try {
      const created = validateCanonicalPullRequest(
        await request(config, 'POST', '/pulls', { title, head: 'staging', base: 'main', body: managedBody, draft: false }),
        config
      );
      result = { action: 'created', pullRequest: created };
    } catch (error) {
      if (error.statusCode !== 422) throw error;
      pullRequests = await request(config, 'GET', `/pulls${query}`);
      if (!Array.isArray(pullRequests) || pullRequests.length !== 1) {
        throw new Error('Concurrent PR creation did not converge on exactly one canonical release PR');
      }
      const recovered = validateCanonicalPullRequest(pullRequests[0], config);
      const recoveredBody = mergeManagedBody(recovered.body, managedBody);
      if (recoveredBody.length > 60000) {
        throw new Error('Generated release PR body exceeds the safe size limit');
      }
      if (recovered.title === title && recovered.body === recoveredBody) {
        result = { action: 'reused', pullRequest: recovered };
      } else {
        const updated = validateCanonicalPullRequest(
          await request(config, 'PATCH', `/pulls/${recovered.number}`, {
            title,
            body: recoveredBody,
          }),
          config
        );
        result = { action: 'updated', pullRequest: updated };
      }
    }
  } else {
    const existing = pullRequests[0];
    const body = mergeManagedBody(existing.body, managedBody);
    if (body.length > 60000) throw new Error('Generated release PR body exceeds the safe size limit');
    if (existing.title === title && existing.body === body) {
      result = { action: 'reused', pullRequest: existing };
    } else {
      const updated = validateCanonicalPullRequest(
        await request(config, 'PATCH', `/pulls/${existing.number}`, { title, body }),
        config
      );
      result = { action: 'updated', pullRequest: updated };
    }
  }

  const pullRequest = result.pullRequest;
  if (String(pullRequest?.head?.sha || '').toLowerCase() !== config.candidateSha) {
    throw new Error('Release PR head does not match the certified candidate after mutation');
  }
  requireExpectedRefs(await readRefs(config, request), config, manifest, 'after pull-request mutation');
  return {
    action: result.action,
    number: pullRequest.number,
    url: pullRequest.html_url,
    headSha: config.candidateSha,
    baseSha: manifest.mainSha,
  };
}

async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  const manifestBytes = fs.readFileSync(config.manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.schemaVersion !== 1
    || manifest.repository !== config.repository
    || manifest.sourceBranch !== 'staging'
    || manifest.targetBranch !== 'main'
    || manifest.candidateSha !== config.candidateSha
  ) {
    throw new Error('Manifest identity does not match the requested canonical staging release');
  }
  manifest.artifactFileSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  const result = await ensureReleasePullRequest(config, manifest);
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Staging release PR automation failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  renderPullRequestBody,
  canonicalHead,
  mergeManagedBody,
  validateCanonicalPullRequest,
  readRefs,
  requireExpectedRefs,
  ensureReleasePullRequest,
  githubRequest,
  main,
};
