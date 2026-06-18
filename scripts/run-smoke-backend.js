const { spawnSync } = require('child_process');

const isWin = process.platform === 'win32';
const cmd = isWin ? 'powershell' : 'bash';
const args = isWin
  ? ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/smoke-backend.ps1']
  : ['scripts/smoke-backend.sh'];

const result = spawnSync(cmd, args, {
  stdio: 'inherit',
  env: process.env,
});

process.exit(typeof result.status === 'number' ? result.status : 1);
