#!/usr/bin/env node
/**
 * Session-end hook: return repo to staging branch.
 * Stashes uncommitted changes so checkout is never blocked.
 * Fails open (exit 0) so session end is never blocked by git errors.
 */

const { execSync } = require('child_process');

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runQuiet(command) {
  try {
    run(command);
    return true;
  } catch {
    return false;
  }
}

function isGitRepo() {
  return runQuiet('git rev-parse --is-inside-work-tree');
}

try {
  if (!isGitRepo()) {
    process.exit(0);
  }

  const branch = run('git branch --show-current');
  const dirty = run('git status --porcelain');

  if (dirty) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    runQuiet(`git stash push -u -m "auto-stash: return to staging (${branch}) ${stamp}"`);
  }

  if (branch !== 'staging') {
    runQuiet('git checkout staging');
  }

  runQuiet('git pull origin staging');
} catch {
  // Fail open — never block session end
}

process.exit(0);
