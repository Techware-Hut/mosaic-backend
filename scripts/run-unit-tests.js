const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function collectUnitTestFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'integration') {
        continue;
      }
      collectUnitTestFiles(fullPath, files);
      continue;
    }

    if (
      entry.name.endsWith('.test.js') &&
      !entry.name.endsWith('.integration.test.js')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

const testRoot = path.join(__dirname, '..', 'tests');
const files = collectUnitTestFiles(testRoot);

if (files.length === 0) {
  console.error('No unit test files found under tests/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
