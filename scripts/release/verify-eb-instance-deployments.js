#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const EXPECTED_VERSION_PATTERN = /^mosaic-[a-f0-9]{40}$/;

function instanceSuffix(instanceId) {
  return instanceId.slice(-8);
}

function verifyInstanceDeployments(payload, expectedVersion) {
  if (!EXPECTED_VERSION_PATTERN.test(expectedVersion)) {
    throw new Error('Expected version must be mosaic- followed by a full 40-character SHA');
  }

  if (!payload || !Array.isArray(payload.InstanceHealthList)) {
    throw new Error('Enhanced-health InstanceHealthList is unavailable');
  }

  if (payload.InstanceHealthList.length === 0) {
    throw new Error('Elastic Beanstalk returned zero instances');
  }

  const rows = payload.InstanceHealthList.map((instance, index) => {
    if (!instance || typeof instance.InstanceId !== 'string' || instance.InstanceId.length === 0) {
      throw new Error(`Instance ${index + 1} is missing InstanceId`);
    }

    const suffix = instanceSuffix(instance.InstanceId);
    const deployment = instance.Deployment;
    if (!deployment || typeof deployment !== 'object') {
      throw new Error(`Instance ${suffix} is missing Deployment data`);
    }
    if (deployment.DeploymentId === undefined || deployment.DeploymentId === null) {
      throw new Error(`Instance ${suffix} is missing DeploymentId`);
    }
    if (deployment.VersionLabel !== expectedVersion) {
      throw new Error(
        `Instance ${suffix} version mismatch: expected ${expectedVersion}, got ${deployment.VersionLabel || 'missing'}`
      );
    }
    if (deployment.Status !== 'Deployed') {
      throw new Error(
        `Instance ${suffix} deployment is not complete: ${deployment.Status || 'missing'}`
      );
    }

    return {
      instanceSuffix: suffix,
      versionLabel: deployment.VersionLabel,
      deploymentId: deployment.DeploymentId,
      status: deployment.Status,
    };
  });

  return rows;
}

function renderRows(rows) {
  const lines = [
    'instance suffix | version label | deployment ID | status',
    '----------------|---------------|---------------|-------',
  ];

  for (const row of rows) {
    lines.push(
      `${row.instanceSuffix} | ${row.versionLabel} | ${row.deploymentId} | ${row.status}`
    );
  }

  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const [expectedVersion, responsePath] = argv;
  if (!expectedVersion || !responsePath || argv.length !== 2) {
    throw new Error('Usage: verify-eb-instance-deployments.js <expected-version> <response-json>');
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
  } catch (_error) {
    throw new Error('Elastic Beanstalk instance-health response was not valid JSON');
  }

  const rows = verifyInstanceDeployments(payload, expectedVersion.toLowerCase());
  console.log(renderRows(rows));
  console.log(`Verified ${rows.length} Elastic Beanstalk instance(s) on ${expectedVersion.toLowerCase()}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Per-instance deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  verifyInstanceDeployments,
  renderRows,
  main,
};
