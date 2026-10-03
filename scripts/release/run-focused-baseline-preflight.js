#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const {
  EXPECTED_APPLICATION,
  EXPECTED_ENVIRONMENT,
  EXPECTED_REGION,
  collectAwsTopology,
  validateTopology,
} = require('./aws-release-topology');
const {
  assertFullSha,
  createAwsCliRunner,
  nowIso,
  parseOptions,
  requireOption,
  writeJson,
} = require('./release-control-utils');

const APPROVED_READS = Object.freeze({
  'elasticbeanstalk:describe-environments': 'DescribeEnvironments',
  'elasticbeanstalk:describe-configuration-settings': 'DescribeConfigurationSettings',
  'elasticbeanstalk:describe-environment-resources': 'DescribeEnvironmentResources',
  'elasticbeanstalk:describe-instances-health': 'DescribeInstancesHealth',
  'autoscaling:describe-auto-scaling-groups': 'DescribeAutoScalingGroups',
  'elbv2:describe-load-balancers': 'DescribeLoadBalancers',
  'elbv2:describe-listeners': 'DescribeListeners',
  'elbv2:describe-target-groups': 'DescribeTargetGroups',
  'elbv2:describe-target-health': 'DescribeTargetHealth',
  'elbv2:describe-load-balancer-attributes': 'DescribeLoadBalancerAttributes',
});
const HEALTH_READ = 'elasticbeanstalk:describe-instances-health';

function cliConfiguration(argv, env = process.env) {
  const options = parseOptions(argv);
  const allowed = new Set(['_', '--mode', '--release-sha', '--output']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error('Unsupported focused preflight option');
  }
  if (requireOption(options, '--mode') !== 'focused-baseline' ||
      (env.RELEASE_MODE && env.RELEASE_MODE !== 'focused-baseline')) {
    throw new Error('Focused preflight requires focused-baseline mode');
  }
  return {
    releaseSha: assertFullSha(requireOption(options, '--release-sha')),
    output: requireOption(options, '--output'),
    region: env.AWS_REGION || EXPECTED_REGION,
    applicationName: env.EB_APPLICATION_NAME || EXPECTED_APPLICATION,
    environmentName: env.EB_ENVIRONMENT_NAME || EXPECTED_ENVIRONMENT,
  };
}

function normalizeConfiguration(payload) {
  const settings = payload && payload.configuration;
  if (!Array.isArray(settings) || settings.length !== 1 ||
      !settings[0] || typeof settings[0] !== 'object' || Array.isArray(settings[0]) ||
      typeof settings[0].ApplicationName !== 'string' ||
      typeof settings[0].EnvironmentName !== 'string' ||
      !Array.isArray(settings[0].OptionSettings)) {
    throw new Error('Filtered configuration response is malformed');
  }
  return { ...payload, configuration: { ConfigurationSettings: settings } };
}

function createFocusedRunner({ spawn = spawnSync, awsCli = process.env.AWS_CLI || 'aws', log = console.log }) {
  let healthAccessDenied = false;
  function runAws(service, operation, args) {
    const key = `${service}:${operation}`;
    if (!Object.hasOwn(APPROVED_READS, key)) throw new Error('Unapproved AWS read operation');

    let cliHealthAccessDenied = false;
    const runner = createAwsCliRunner({
      awsCli,
      spawn: (command, cliArgs, options) => {
        const result = spawn(command, cliArgs, options);
        if (key === HEALTH_READ && result && !result.error &&
            Number.isInteger(result.status) && result.status > 0) {
          // Capture only the AWS error code. Never retain or print the raw stderr.
          const code = /An error occurred \(([^)]+)\)/.exec(String(result.stderr || ''))?.[1];
          cliHealthAccessDenied = code === 'AccessDenied' || code === 'AccessDeniedException';
        }
        return result;
      },
    });
    try {
      const value = runner(service, operation, args);
      log(`PASS: ${APPROVED_READS[key]}`);
      return value;
    } catch (_error) {
      if (key === HEALTH_READ && cliHealthAccessDenied) {
        healthAccessDenied = true;
        log('WARN: DescribeInstancesHealth');
        log('WARN CLASS: AccessDenied');
        return null;
      }
      log(`FAIL: ${APPROVED_READS[key]}`);
      throw new Error('Approved AWS read failed');
    }
  }
  return { runAws, healthAccessDenied: () => healthAccessDenied };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const log = dependencies.log || console.log;
  let config;
  try {
    config = cliConfiguration(argv, dependencies.env || process.env);
    const runner = createFocusedRunner({
      spawn: dependencies.spawn || spawnSync,
      awsCli: dependencies.awsCli || (dependencies.env || process.env).AWS_CLI || 'aws',
      log,
    });
    const payload = collectAwsTopology({
      runAws: runner.runAws,
      region: config.region,
      applicationName: config.applicationName,
      environmentName: config.environmentName,
    });
    let normalized;
    try {
      normalized = normalizeConfiguration(payload);
    } catch (_error) {
      log('FAIL: configuration response');
      throw _error;
    }
    let evidence;
    try {
      evidence = validateTopology(normalized, {
        applicationName: config.applicationName,
        environmentName: config.environmentName,
        mode: 'preflight',
        releaseSha: config.releaseSha,
        mixedVersionSafe: false,
        allowInstanceHealthAccessDeniedInProof: runner.healthAccessDenied(),
        clock: dependencies.clock,
      });
      if (runner.healthAccessDenied() &&
          (evidence.instanceHealthVerified !== false || evidence.instances !== null)) {
        throw new Error('Unverified instance health was reported as verified');
      }
    } catch (_error) {
      log('FAIL: topology validation');
      throw _error;
    }
    (dependencies.writeJson || writeJson)(config.output, evidence);
    log(runner.healthAccessDenied()
      ? 'PASS: focused-baseline AWS preflight (EB instance health unverified)'
      : 'PASS: focused-baseline AWS preflight');
    return evidence;
  } catch (_error) {
    if (config) {
      try {
        (dependencies.writeJson || writeJson)(config.output, {
          schemaVersion: 1,
          status: 'failed',
          phase: 'preflight',
          checkedAt: nowIso(dependencies.clock),
          releaseSha: config.releaseSha,
          reason: 'Focused-baseline AWS preflight failed',
        });
      } catch (_writeError) {
        // Keep the original fail-closed result if evidence writing also fails.
      }
    }
    throw new Error('Focused-baseline AWS preflight failed');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (_error) {
    console.error('Focused-baseline AWS preflight failed');
    process.exitCode = 1;
  }
}

module.exports = {
  APPROVED_READS,
  cliConfiguration,
  createFocusedRunner,
  main,
  normalizeConfiguration,
};
