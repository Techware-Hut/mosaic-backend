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

// Match only known validator messages. Never print the message: some include an
// instance ID suffix, and new or malformed errors must stay fatal as UNKNOWN.
const VALIDATION_PREDICATES = Object.freeze({
  'Environments must contain exactly one item': 'ENVIRONMENT_COUNT',
  'Elastic Beanstalk returned a different application or environment': 'ENVIRONMENT_IDENTITY',
  'Elastic Beanstalk environment is not Ready/Green/Ok': 'ENVIRONMENT_HEALTH',
  'Elastic Beanstalk environment version does not match the release SHA': 'ENVIRONMENT_VERSION',
  'ConfigurationSettings must contain exactly one item': 'CONFIGURATION_COUNT',
  'Elastic Beanstalk configuration belongs to a different target': 'CONFIGURATION_TARGET',
  'Elastic Beanstalk configuration is unavailable': 'CONFIGURATION_REQUIRED_OPTION',
  'Elastic Beanstalk option aws:elasticbeanstalk:command/DeploymentPolicy is unavailable': 'CONFIGURATION_REQUIRED_OPTION',
  'Elastic Beanstalk option aws:autoscaling:updatepolicy:rollingupdate/RollingUpdateEnabled is unavailable': 'CONFIGURATION_REQUIRED_OPTION',
  'Elastic Beanstalk option aws:elasticbeanstalk:healthreporting:system/SystemType is unavailable': 'CONFIGURATION_REQUIRED_OPTION',
  'Elastic Beanstalk RollingUpdateEnabled is not boolean': 'ROLLING_UPDATE_VALUE',
  'Elastic Beanstalk Enhanced Health must be enabled': 'ENHANCED_HEALTH',
  'Elastic Beanstalk environment resources are unavailable': 'ENVIRONMENT_RESOURCES',
  'Environment AutoScalingGroups must contain exactly one item': 'ENVIRONMENT_RESOURCES',
  'Environment LoadBalancers must contain exactly one item': 'ENVIRONMENT_RESOURCES',
  'Elastic Beanstalk environment instance inventory is unavailable': 'ENVIRONMENT_INSTANCE_INVENTORY',
  'AutoScalingGroups must contain exactly one item': 'ASG_COUNT',
  'Auto Scaling group does not match the Elastic Beanstalk environment': 'ASG_IDENTITY',
  'Auto Scaling capacity bounds are invalid': 'ASG_CAPACITY',
  'Elastic Beanstalk and Auto Scaling instance inventories differ': 'ASG_INSTANCE_INVENTORY',
  'Every Auto Scaling instance must be InService and Healthy': 'ASG_INSTANCE_HEALTH',
  'Auto Scaling desired capacity does not match its instance inventory': 'ASG_DESIRED_CAPACITY',
  'Proof-only instance health warning state is invalid': 'HEALTH_WARNING_STATE',
  'Enhanced Health instance inventory differs from Elastic Beanstalk resources': 'HEALTH_INSTANCE_INVENTORY',
  'Elastic Beanstalk instance health is missing an instance identifier': 'HEALTH_INSTANCE_INVENTORY',
  'Topology is not one-instance/Max=1/AllAtOnce and the release is not mixed-version certified': 'SAFE_CUTOVER_TOPOLOGY',
  'LoadBalancers must contain exactly one item': 'LOAD_BALANCER_COUNT',
  'Production load balancer identity or state is unexpected': 'LOAD_BALANCER_IDENTITY_STATE',
  'Production load balancer must have exactly two listeners': 'LISTENER_COUNT',
  'Production listeners must be HTTP/80 and HTTPS/443': 'LISTENER_PROTOCOL',
  'Production listeners do not belong to the expected load balancer': 'LISTENER_OWNERSHIP',
  'HTTP/80 listener must have exactly one default action': 'LISTENER_TARGET_MATCH',
  'HTTPS/443 listener must have exactly one default action': 'LISTENER_TARGET_MATCH',
  'HTTP/80 listener must forward directly to one target group': 'LISTENER_TARGET_MATCH',
  'HTTPS/443 listener must forward directly to one target group': 'LISTENER_TARGET_MATCH',
  'Production listeners forward to different target groups': 'LISTENER_TARGET_MATCH',
  'TargetGroups must contain exactly one item': 'TARGET_GROUP_COUNT',
  'Target group does not match the production listeners/load balancer': 'TARGET_GROUP_BINDING',
  'ALB target count does not match the Elastic Beanstalk instance count': 'TARGET_COUNT',
  'ALB and Elastic Beanstalk instance inventories differ': 'TARGET_INVENTORY',
  'Every ALB target must be healthy': 'TARGET_HEALTH',
  'ALB idle timeout is unavailable': 'LOAD_BALANCER_IDLE_TIMEOUT',
});

function classifyValidationPredicate(error) {
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (Object.hasOwn(VALIDATION_PREDICATES, message)) return VALIDATION_PREDICATES[message];
  const health = /^Elastic Beanstalk instance [A-Za-z0-9_-]{1,8} (is not Green\/Ok|is not Deployed|has the wrong version)$/.exec(message);
  if (health) {
    if (health[1] === 'is not Green/Ok') return 'HEALTH_INSTANCE_HEALTH';
    if (health[1] === 'is not Deployed') return 'HEALTH_DEPLOYMENT_STATUS';
    return 'HEALTH_DEPLOYMENT_VERSION';
  }
  return 'UNKNOWN';
}

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
      log(`VALIDATION PREDICATE: ${classifyValidationPredicate(_error)}`);
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
  classifyValidationPredicate,
  cliConfiguration,
  createFocusedRunner,
  main,
  normalizeConfiguration,
};
