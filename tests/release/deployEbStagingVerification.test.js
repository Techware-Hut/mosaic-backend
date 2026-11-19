'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '../../.github/workflows/deploy-eb-staging.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

// js-yaml is not a dependency, so split the deploy job's steps textually.
function deploySteps() {
  const jobStart = workflow.indexOf('\n  deploy:\n');
  assert.notEqual(jobStart, -1, 'deploy job must exist');
  const jobBody = workflow.slice(jobStart);
  const stepsStart = jobBody.indexOf('\n    steps:\n');
  assert.notEqual(stepsStart, -1, 'deploy job must have steps');
  const chunks = jobBody.slice(stepsStart).split(/\n      - name: /).slice(1);
  return chunks.map((chunk) => {
    const [name, ...rest] = chunk.split('\n');
    return { name: name.trim(), body: rest.join('\n') };
  });
}

function indexOfStep(steps, name) {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, `step "${name}" must exist`);
  return index;
}

test('deploy start time is recorded immediately before the Elastic Beanstalk deploy', () => {
  const steps = deploySteps();
  const record = indexOfStep(steps, 'Record deploy start time');
  const deploy = indexOfStep(steps, 'Deploy to Elastic Beanstalk');
  assert.equal(record, deploy - 1);
  assert.match(steps[record].body, /id: deploy_start/);
  assert.match(steps[record].body, /date -u \+%Y-%m-%dT%H:%M:%SZ/);
  assert.match(steps[record].body, /started_at=.*>> "\$GITHUB_OUTPUT"/);
});

test('Elastic Beanstalk outcome is verified right after deploy and before the health probes', () => {
  const steps = deploySteps();
  const credentials = indexOfStep(steps, 'Configure AWS credentials');
  const deploy = indexOfStep(steps, 'Deploy to Elastic Beanstalk');
  const verify = indexOfStep(steps, 'Verify Elastic Beanstalk deploy outcome');
  const identity = indexOfStep(steps, 'Post-deploy release identity probe');
  assert.ok(credentials < deploy);
  assert.equal(verify, deploy + 1);
  assert.ok(verify < identity);
});

test('verification fails on ERROR events since deploy start and asserts environment state', () => {
  const { body } = deploySteps().find((step) => step.name === 'Verify Elastic Beanstalk deploy outcome');
  assert.match(body, /DEPLOY_STARTED_AT: \$\{\{ steps\.deploy_start\.outputs\.started_at \}\}/);
  assert.match(body, /EXPECTED_VERSION_LABEL: mosaic-staging-\$\{\{ github\.sha \}\}/);
  assert.match(body, /aws elasticbeanstalk describe-events/);
  assert.match(body, /--environment-name "\$EB_ENVIRONMENT_NAME"/);
  assert.match(body, /--start-time "\$DEPLOY_STARTED_AT"/);
  assert.match(body, /--severity ERROR/);
  assert.match(body, /\.slice\(0, 200\)/);
  assert.match(body, /aws elasticbeanstalk describe-environments/);
  assert.match(body, /Status !== "Ready"/);
  assert.match(body, /Health === "Red" \|\| Health === "Grey"/);
  assert.match(body, /VersionLabel !== expectedVersion/);
  assert.match(body, /set -euo pipefail/);
  assert.match(body, /for attempt in 1 2 3; do/);
  assert.match(body, /sleep 15/);
  assert.match(body, /readFileSync\(0, "utf8"\)/);
  assert.doesNotMatch(body, /process\.argv\[1\]\)\.Events|JSON\.parse\(process\.argv/);
  assert.match(body, /describe-events \\\n\s+--environment-name/);
  assert.match(body, /describe-environments \\\n\s+--environment-names/);
  assert.doesNotMatch(body, /\bprintenv\b|\benv\s*$|set -x/m);
});

test('verification step cannot be skipped or softened', () => {
  const { body } = deploySteps().find((step) => step.name === 'Verify Elastic Beanstalk deploy outcome');
  const runIndex = body.indexOf('\n        run: |');
  assert.notEqual(runIndex, -1, 'verify step must have a run block');
  const header = body.slice(0, runIndex);
  assert.doesNotMatch(header, /continue-on-error/);
  assert.doesNotMatch(header, /^\s+if:/m);
});

test('deploy keeps reusing an existing version label, which is why EB-side checks are needed', () => {
  const { body } = deploySteps().find((step) => step.name === 'Deploy to Elastic Beanstalk');
  assert.match(body, /use_existing_version_if_available: true/);
  assert.match(body, /wait_for_environment_recovery: 60\n/);
  assert.match(body, /version_label: mosaic-staging-\$\{\{ github\.sha \}\}/);
});

test('staging deploys only to the separate staging application, never the production application', () => {
  assert.match(workflow, /\n  EB_APPLICATION_NAME: mosaic-staging-backend\n/);
  assert.match(workflow, /\n  EB_ENVIRONMENT_NAME: mosaic-staging-api\n/);
  assert.doesNotMatch(workflow, /mosaic-biz-hub-backend/, 'production application name must not appear');
  assert.doesNotMatch(workflow, /mosaic-backend-env\b/, 'production environment name must not appear');
  assert.doesNotMatch(workflow, /EB_APPLICATION_NAME:\s*\$\{\{\s*vars\./, 'application name must not be overridable by a variable');
});

test('post-deploy probes connect to the deployed environment, not whatever DNS points at', () => {
  const steps = deploySteps();
  const route = indexOfStep(steps, 'Route probes to the deployed environment');
  const health = indexOfStep(steps, 'Post-deploy health probe');
  assert.ok(route !== -1 && route < health, 'routing step must run before the probes');
  assert.match(steps[route].body, /describe-environments[\s\S]*--environment-names "\$EB_ENVIRONMENT_NAME"/);
  assert.match(steps[route].body, /--connect-to \$\{STAGING_API_HOST\}:443:\$\{cname\}:443/);
  const curls = workflow.split('\n').filter((l) => /\bcurl -s/.test(l));
  assert.ok(curls.length >= 3, 'expected the health, identity and auth probes');
  for (const line of curls) assert.match(line, /\$CURL_ROUTE/, `probe must use the deployed-environment route: ${line.trim()}`);
});

test('isolation probe enforces staging DB, Stripe test mode and mail/SMS guards once the self-check ships', () => {
  const steps = deploySteps();
  const iso = indexOfStep(steps, 'Post-deploy isolation probe');
  assert.ok(iso > indexOfStep(steps, 'Route probes to the deployed environment'));
  const body = steps[iso].body;
  assert.match(body, /utils\/isolationSelfCheck\.js/);
  assert.match(body, /\/api\/ready/);
  assert.match(body, /"mosaic_staging"/);
  assert.match(body, /mode !== "test"/);
  assert.match(body, /\["mail", "sms"\]/);
  assert.match(body, /policy === "off"/);
  assert.doesNotMatch(body, /continue-on-error|\|\| true/);
});
