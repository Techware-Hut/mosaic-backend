#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FULL_SHA = /^[a-f0-9]{40}$/i;
const ROLLBACK_CONFIRMATION = 'BREAK GLASS ROLLBACK EXACT SHA';

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error('Invalid release resolver arguments');
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!['push', 'workflow_dispatch'].includes(values.event)
      || !['release', 'rollback'].includes(values.mode)
      || !values.output) {
    throw new Error('Release event, mode, and output are required');
  }
  return values;
}

function resolveProductionRelease({
  event,
  eventSha,
  workflowSha,
  requestedSha,
  mode,
  confirmation,
  currentMainSha,
  commitExists,
  isAncestor,
}) {
  if (!FULL_SHA.test(currentMainSha || '')) {
    throw new Error('Current origin/main did not resolve to a full SHA');
  }
  if (!FULL_SHA.test(workflowSha || '') || workflowSha.toLowerCase() !== currentMainSha.toLowerCase()) {
    throw new Error('Executing production workflow definition is not the exact current main revision');
  }

  if (event === 'push' && mode !== 'release') {
    throw new Error('Push-triggered releases cannot enter break-glass rollback mode');
  }

  const candidate = (event === 'push' ? eventSha : requestedSha || '').toLowerCase();
  if (!FULL_SHA.test(candidate)) {
    throw new Error('Release candidate must be one full 40-character SHA');
  }
  if (!commitExists(candidate)) {
    throw new Error('Release candidate is not present in this repository');
  }

  if (mode === 'release') {
    if (candidate !== currentMainSha.toLowerCase()) {
      throw new Error('Normal production release candidate must equal the exact current main tip');
    }
  } else {
    if (event !== 'workflow_dispatch' || confirmation !== ROLLBACK_CONFIRMATION) {
      throw new Error('Break-glass rollback requires the exact confirmation phrase');
    }
    if (!isAncestor(candidate, currentMainSha.toLowerCase())) {
      throw new Error('Rollback candidate must remain reachable from current main');
    }
  }

  return {
    releaseSha: candidate,
    currentMainSha: currentMainSha.toLowerCase(),
    workflowSha: workflowSha.toLowerCase(),
    mode,
    normalRelease: mode === 'release',
    breakGlass: mode === 'rollback',
  };
}

function resolveWithGit(args) {
  git(['fetch', '--no-tags', 'origin', 'main']);
  const currentMainSha = git(['rev-parse', 'refs/remotes/origin/main']);
  return resolveProductionRelease({
    event: args.event,
    eventSha: args['event-sha'],
    workflowSha: args['workflow-sha'],
    requestedSha: args['requested-sha'],
    mode: args.mode,
    confirmation: args.confirmation,
    currentMainSha,
    commitExists(candidate) {
      try {
        git(['cat-file', '-e', `${candidate}^{commit}`]);
        return true;
      } catch (_error) {
        return false;
      }
    },
    isAncestor(candidate, mainSha) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', candidate, mainSha], {
          stdio: 'ignore',
        });
        return true;
      } catch (_error) {
        return false;
      }
    },
  });
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = resolveWithGit(args);
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, [
      `release_sha=${result.releaseSha}`,
      `current_main_sha=${result.currentMainSha}`,
      `release_mode=${result.mode}`,
      `normal_release=${String(result.normalRelease)}`,
    ].join('\n') + '\n');
  }
  console.log(`Resolved ${result.mode} candidate ${result.releaseSha}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Production release resolution failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  FULL_SHA,
  ROLLBACK_CONFIRMATION,
  parseArgs,
  resolveProductionRelease,
  resolveWithGit,
};
