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
  assert.doesNotMatch(body, /\bprintenv\b|\benv\s*$|set -x/m);
});

test('deploy keeps reusing an existing version label, which is why EB-side checks are needed', () => {
  const { body } = deploySteps().find((step) => step.name === 'Deploy to Elastic Beanstalk');
  assert.match(body, /use_existing_version_if_available: true/);
  assert.match(body, /version_label: mosaic-staging-\$\{\{ github\.sha \}\}/);
});
