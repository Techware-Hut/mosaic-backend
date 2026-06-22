const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function collectIntegrationTestFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectIntegrationTestFiles(fullPath, files);
      continue;
    }

    if (entry.name.endsWith('.integration.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

const integrationRoot = path.join(__dirname, '..', 'tests', 'integration');
const files = collectIntegrationTestFiles(integrationRoot);

if (files.length === 0) {
  console.error('No integration test files found under tests/integration/');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...files],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
