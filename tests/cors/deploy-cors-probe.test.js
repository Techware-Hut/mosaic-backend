const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../../.github/workflows/deploy-eb-production.yml');

test('production deploy CORS probe matches credentialed browser origins', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.ok(workflow.includes('APEX_ORIGIN: https://mosaicbizhub.com'));
  assert.ok(workflow.includes('LEGACY_APP_ORIGIN: https://app.mosaicbizhub.com'));
  assert.ok(workflow.includes('LAUNCH_ORIGIN: https://mosaic-biz-frontend-launch.vercel.app'));
  assert.ok(workflow.includes('VERCEL_PRODUCTION_ORIGIN: https://mosaic-biz-frontend-launch-digital-builders.vercel.app'));
  assert.ok(workflow.includes('VERCEL_MAIN_ORIGIN: https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app'));
  assert.ok(workflow.includes('VERCEL_DEVELOP_ORIGIN: https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app'));

  assert.equal(workflow.includes('WWW_ORIGIN'), false);
  assert.equal(workflow.includes('https://www.mosaicbizhub.com'), false);
});
