#!/usr/bin/env node
'use strict';

const {
  assertFullSha,
  createAwsCliRunner,
  instanceSuffix,
  nowIso,
  optionalOption,
  parseBoolean,
  parseOptions,
  readJson,
  requireOption,
  resourceRef,
  sameMembers,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const EXPECTED_APPLICATION = 'mosaic-biz-hub-backend';
const EXPECTED_ENVIRONMENT = 'mosaic-backend-env';
const EXPECTED_REGION = 'us-east-1';

function one(values, label) {
  if (!Array.isArray(values) || values.length !== 1) {
    throw new Error(`${label} must contain exactly one item`);
  }
  return values[0];
}

function optionValue(configuration, namespace, optionName) {
  const settings = configuration && configuration.OptionSettings;
  if (!Array.isArray(settings)) throw new Error('Elastic Beanstalk configuration is unavailable');
  const matches = settings.filter(
    (entry) => entry.Namespace === namespace && entry.OptionName === optionName
  );
  if (matches.length !== 1 || typeof matches[0].Value !== 'string') {
    throw new Error(`Elastic Beanstalk option ${namespace}/${optionName} is unavailable`);
  }
  return matches[0].Value;
}

function forwardedTargetGroup(actionList, label) {
  if (!Array.isArray(actionList) || actionList.length !== 1) {
    throw new Error(`${label} must have exactly one default action`);
  }
  const action = actionList[0];
  if (action.Type !== 'forward' || typeof action.TargetGroupArn !== 'string') {
    throw new Error(`${label} must forward directly to one target group`);
  }
  return action.TargetGroupArn;
}

function validateInstanceHealth(instance, expectedVersion, verifyVersion) {
  if (!instance || typeof instance.InstanceId !== 'string') {
    throw new Error('Elastic Beanstalk instance health is missing an instance identifier');
  }
  if (instance.HealthStatus !== 'Ok' || instance.Color !== 'Green') {
    throw new Error(`Elastic Beanstalk instance ${instanceSuffix(instance.InstanceId)} is not Green/Ok`);
  }
  if (!instance.Deployment || instance.Deployment.Status !== 'Deployed') {
    throw new Error(`Elastic Beanstalk instance ${instanceSuffix(instance.InstanceId)} is not Deployed`);
  }
  if (verifyVersion && instance.Deployment.VersionLabel !== expectedVersion) {
    throw new Error(`Elastic Beanstalk instance ${instanceSuffix(instance.InstanceId)} has the wrong version`);
  }
}

function validateTopology(payload, options) {
  const {
    applicationName,
    environmentName,
    mode,
    releaseSha,
    mixedVersionSafe = false,
    clock,
  } = options;
  const expectedVersion = `mosaic-${releaseSha}`;
  const environment = one(payload.environments && payload.environments.Environments, 'Environments');

  if (environment.ApplicationName !== applicationName || environment.EnvironmentName !== environmentName) {
    throw new Error('Elastic Beanstalk returned a different application or environment');
  }
  if (environment.Status !== 'Ready' || environment.Health !== 'Green' || environment.HealthStatus !== 'Ok') {
    throw new Error('Elastic Beanstalk environment is not Ready/Green/Ok');
  }
  if (mode === 'verify' && environment.VersionLabel !== expectedVersion) {
    throw new Error('Elastic Beanstalk environment version does not match the release SHA');
  }

  const configuration = one(
    payload.configuration && payload.configuration.ConfigurationSettings,
    'ConfigurationSettings'
  );
  if (configuration.ApplicationName !== applicationName || configuration.EnvironmentName !== environmentName) {
    throw new Error('Elastic Beanstalk configuration belongs to a different target');
  }

  const deploymentPolicy = optionValue(
    configuration,
    'aws:elasticbeanstalk:command',
    'DeploymentPolicy'
  );
  const rollingUpdateValue = optionValue(
    configuration,
    'aws:autoscaling:updatepolicy:rollingupdate',
    'RollingUpdateEnabled'
  ).toLowerCase();
  if (!['true', 'false'].includes(rollingUpdateValue)) {
    throw new Error('Elastic Beanstalk RollingUpdateEnabled is not boolean');
  }
  const rollingUpdateEnabled = rollingUpdateValue === 'true';
  const healthReporting = optionValue(
    configuration,
    'aws:elasticbeanstalk:healthreporting:system',
    'SystemType'
  );
  if (healthReporting.toLowerCase() !== 'enhanced') {
    throw new Error('Elastic Beanstalk Enhanced Health must be enabled');
  }

  const resources = payload.resources && payload.resources.EnvironmentResources;
  if (!resources || resources.EnvironmentName !== environmentName) {
    throw new Error('Elastic Beanstalk environment resources are unavailable');
  }
  const asgResource = one(resources.AutoScalingGroups, 'Environment AutoScalingGroups');
  const loadBalancerResource = one(resources.LoadBalancers, 'Environment LoadBalancers');
  const resourceInstances = Array.isArray(resources.Instances)
    ? resources.Instances.map((entry) => entry.Id)
    : [];
  if (resourceInstances.length === 0 || resourceInstances.some((id) => typeof id !== 'string')) {
    throw new Error('Elastic Beanstalk environment instance inventory is unavailable');
  }

  const asg = one(payload.autoScaling && payload.autoScaling.AutoScalingGroups, 'AutoScalingGroups');
  if (asg.AutoScalingGroupName !== asgResource.Name) {
    throw new Error('Auto Scaling group does not match the Elastic Beanstalk environment');
  }
  const asgInstances = Array.isArray(asg.Instances) ? asg.Instances : [];
  if (
    !Number.isSafeInteger(asg.MinSize) ||
    !Number.isSafeInteger(asg.MaxSize) ||
    !Number.isSafeInteger(asg.DesiredCapacity) ||
    asg.MinSize < 0 ||
    asg.MinSize > asg.DesiredCapacity ||
    asg.DesiredCapacity > asg.MaxSize
  ) {
    throw new Error('Auto Scaling capacity bounds are invalid');
  }
  if (!sameMembers(resourceInstances, asgInstances.map((entry) => entry.InstanceId))) {
    throw new Error('Elastic Beanstalk and Auto Scaling instance inventories differ');
  }
  if (asgInstances.some((entry) => entry.LifecycleState !== 'InService' || entry.HealthStatus !== 'Healthy')) {
    throw new Error('Every Auto Scaling instance must be InService and Healthy');
  }
  if (asg.DesiredCapacity !== asgInstances.length) {
    throw new Error('Auto Scaling desired capacity does not match its instance inventory');
  }

  const instanceHealth = payload.instanceHealth && payload.instanceHealth.InstanceHealthList;
  if (!Array.isArray(instanceHealth) || !sameMembers(resourceInstances, instanceHealth.map((entry) => entry.InstanceId))) {
    throw new Error('Enhanced Health instance inventory differs from Elastic Beanstalk resources');
  }
  for (const instance of instanceHealth) {
    validateInstanceHealth(instance, expectedVersion, mode === 'verify');
  }

  const safeSingleInstanceCutover =
    asg.MinSize === 1 &&
    asg.MaxSize === 1 &&
    asg.DesiredCapacity === 1 &&
    resourceInstances.length === 1 &&
    deploymentPolicy === 'AllAtOnce' &&
    rollingUpdateEnabled === false;
  if (!safeSingleInstanceCutover && !mixedVersionSafe) {
    throw new Error(
      'Topology is not one-instance/Max=1/AllAtOnce and the release is not mixed-version certified'
    );
  }

  const loadBalancer = one(
    payload.loadBalancers && payload.loadBalancers.LoadBalancers,
    'LoadBalancers'
  );
  const resourceUsesArn = String(loadBalancerResource.Name || '').startsWith('arn:');
  if (
    (resourceUsesArn
      ? loadBalancer.LoadBalancerArn !== loadBalancerResource.Name
      : loadBalancer.LoadBalancerName !== loadBalancerResource.Name) ||
    loadBalancer.Type !== 'application' ||
    loadBalancer.Scheme !== 'internet-facing' ||
    !loadBalancer.State ||
    loadBalancer.State.Code !== 'active'
  ) {
    throw new Error('Production load balancer identity or state is unexpected');
  }

  const listeners = payload.listeners && payload.listeners.Listeners;
  if (!Array.isArray(listeners) || listeners.length !== 2) {
    throw new Error('Production load balancer must have exactly two listeners');
  }
  const http = listeners.find((listener) => listener.Port === 80 && listener.Protocol === 'HTTP');
  const https = listeners.find((listener) => listener.Port === 443 && listener.Protocol === 'HTTPS');
  if (!http || !https) throw new Error('Production listeners must be HTTP/80 and HTTPS/443');
  if (http.LoadBalancerArn !== loadBalancer.LoadBalancerArn || https.LoadBalancerArn !== loadBalancer.LoadBalancerArn) {
    throw new Error('Production listeners do not belong to the expected load balancer');
  }
  const httpTarget = forwardedTargetGroup(http.DefaultActions, 'HTTP/80 listener');
  const httpsTarget = forwardedTargetGroup(https.DefaultActions, 'HTTPS/443 listener');
  if (httpTarget !== httpsTarget) throw new Error('Production listeners forward to different target groups');

  const targetGroup = one(payload.targetGroups && payload.targetGroups.TargetGroups, 'TargetGroups');
  if (
    targetGroup.TargetGroupArn !== httpTarget ||
    !Array.isArray(targetGroup.LoadBalancerArns) ||
    !targetGroup.LoadBalancerArns.includes(loadBalancer.LoadBalancerArn)
  ) {
    throw new Error('Target group does not match the production listeners/load balancer');
  }
  const targetHealthPayload = payload.targetHealthByGroup && payload.targetHealthByGroup[targetGroup.TargetGroupArn];
  const targetDescriptions = targetHealthPayload && targetHealthPayload.TargetHealthDescriptions;
  if (!Array.isArray(targetDescriptions) || targetDescriptions.length !== resourceInstances.length) {
    throw new Error('ALB target count does not match the Elastic Beanstalk instance count');
  }
  if (!sameMembers(resourceInstances, targetDescriptions.map((entry) => entry.Target && entry.Target.Id))) {
    throw new Error('ALB and Elastic Beanstalk instance inventories differ');
  }
  if (targetDescriptions.some((entry) => !entry.TargetHealth || entry.TargetHealth.State !== 'healthy')) {
    throw new Error('Every ALB target must be healthy');
  }

  const attributes = payload.loadBalancerAttributes && payload.loadBalancerAttributes.Attributes;
  const idleTimeoutEntry = Array.isArray(attributes)
    ? attributes.find((entry) => entry.Key === 'idle_timeout.timeout_seconds')
    : undefined;
  const idleTimeoutSeconds = idleTimeoutEntry ? Number(idleTimeoutEntry.Value) : NaN;
  if (!Number.isSafeInteger(idleTimeoutSeconds) || idleTimeoutSeconds <= 0) {
    throw new Error('ALB idle timeout is unavailable');
  }

  return {
    schemaVersion: 1,
    status: 'passed',
    phase: mode,
    checkedAt: nowIso(clock),
    releaseSha,
    expectedVersion: mode === 'verify' ? expectedVersion : null,
    application: applicationName,
    environment: environmentName,
    currentVersion: environment.VersionLabel,
    environmentState: 'Ready/Green/Ok',
    enhancedHealth: true,
    topology: {
      safeSingleInstanceCutover,
      mixedVersionSafe,
      minSize: asg.MinSize,
      maxSize: asg.MaxSize,
      desiredCapacity: asg.DesiredCapacity,
      instanceCount: resourceInstances.length,
      deploymentPolicy,
      rollingUpdateEnabled,
    },
    instances: instanceHealth.map((entry) => ({
      instanceSuffix: instanceSuffix(entry.InstanceId),
      health: 'Green/Ok',
      deploymentStatus: entry.Deployment.Status,
      versionLabel: entry.Deployment.VersionLabel,
    })),
    loadBalancer: {
      ref: resourceRef(loadBalancer.LoadBalancerArn, 'alb'),
      listeners: ['HTTP/80', 'HTTPS/443'],
      targetGroupRef: resourceRef(targetGroup.TargetGroupArn, 'tg'),
      healthyTargetCount: targetDescriptions.length,
      idleTimeoutSeconds,
    },
  };
}

function collectAwsTopology({ runAws, region, applicationName, environmentName }) {
  const regionArgs = ['--region', region];
  const environments = runAws('elasticbeanstalk', 'describe-environments', [
    '--application-name', applicationName,
    '--environment-names', environmentName,
    '--no-include-deleted',
    ...regionArgs,
  ]);
  const configuration = runAws('elasticbeanstalk', 'describe-configuration-settings', [
    '--application-name', applicationName,
    '--environment-name', environmentName,
    // Keep secret-bearing EB environment properties out of this process's stdout.
    // IAM still cannot scope DescribeConfigurationSettings to individual options.
    '--query', "ConfigurationSettings[].{ApplicationName:ApplicationName,EnvironmentName:EnvironmentName,OptionSettings:OptionSettings[?contains(['aws:elasticbeanstalk:command/DeploymentPolicy','aws:autoscaling:updatepolicy:rollingupdate/RollingUpdateEnabled','aws:elasticbeanstalk:healthreporting:system/SystemType'], join('/', [Namespace, OptionName]))]}",
    ...regionArgs,
  ]);
  const resources = runAws('elasticbeanstalk', 'describe-environment-resources', [
    '--environment-name', environmentName,
    ...regionArgs,
  ]);
  const instanceHealth = runAws('elasticbeanstalk', 'describe-instances-health', [
    '--environment-name', environmentName,
    '--attribute-names', 'All',
    ...regionArgs,
  ]);
  const environmentResources = resources.EnvironmentResources || {};
  const asgName = one(environmentResources.AutoScalingGroups, 'Environment AutoScalingGroups').Name;
  const loadBalancerIdentity = one(
    environmentResources.LoadBalancers,
    'Environment LoadBalancers'
  ).Name;
  const autoScaling = runAws('autoscaling', 'describe-auto-scaling-groups', [
    '--auto-scaling-group-names', asgName,
    ...regionArgs,
  ]);
  const loadBalancerSelector = String(loadBalancerIdentity || '').startsWith('arn:')
    ? ['--load-balancer-arns', loadBalancerIdentity]
    : ['--names', loadBalancerIdentity];
  const loadBalancers = runAws('elbv2', 'describe-load-balancers', [
    ...loadBalancerSelector,
    ...regionArgs,
  ]);
  const loadBalancer = one(loadBalancers.LoadBalancers, 'LoadBalancers');
  const listeners = runAws('elbv2', 'describe-listeners', [
    '--load-balancer-arn', loadBalancer.LoadBalancerArn,
    ...regionArgs,
  ]);
  const targetGroups = runAws('elbv2', 'describe-target-groups', [
    '--load-balancer-arn', loadBalancer.LoadBalancerArn,
    ...regionArgs,
  ]);
  const targetHealthByGroup = {};
  for (const targetGroup of targetGroups.TargetGroups || []) {
    targetHealthByGroup[targetGroup.TargetGroupArn] = runAws('elbv2', 'describe-target-health', [
      '--target-group-arn', targetGroup.TargetGroupArn,
      ...regionArgs,
    ]);
  }
  const loadBalancerAttributes = runAws('elbv2', 'describe-load-balancer-attributes', [
    '--load-balancer-arn', loadBalancer.LoadBalancerArn,
    ...regionArgs,
  ]);
  return {
    environments,
    configuration,
    resources,
    instanceHealth,
    autoScaling,
    loadBalancers,
    listeners,
    targetGroups,
    targetHealthByGroup,
    loadBalancerAttributes,
  };
}

function cliConfiguration(argv, env = process.env) {
  const options = parseOptions(argv, { positionals: 1 });
  const mode = options._[0];
  if (!['preflight', 'verify'].includes(mode)) {
    throw new Error('Usage: aws-release-topology.js preflight|verify --output <json> [options]');
  }
  const allowed = new Set(['_', '--output', '--fixture', '--release-sha', '--mixed-version-safe']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`Unsupported option: ${key}`);
  }
  return {
    mode,
    output: requireOption(options, '--output'),
    fixture: options['--fixture'],
    releaseSha: assertFullSha(
      optionalOption(options, '--release-sha', env.RELEASE_SHA),
      'release SHA'
    ),
    mixedVersionSafe: parseBoolean(
      optionalOption(options, '--mixed-version-safe', env.MIXED_VERSION_SAFE),
      '--mixed-version-safe',
      false
    ),
    region: env.AWS_REGION || EXPECTED_REGION,
    applicationName: env.EB_APPLICATION_NAME || EXPECTED_APPLICATION,
    environmentName: env.EB_ENVIRONMENT_NAME || EXPECTED_ENVIRONMENT,
  };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  let outputPath;
  try {
    const config = cliConfiguration(argv, dependencies.env || process.env);
    outputPath = config.output;
    const payload = config.fixture
      ? readJson(config.fixture, 'Topology fixture')
      : collectAwsTopology({
        runAws: dependencies.runAws || createAwsCliRunner(dependencies),
        region: config.region,
        applicationName: config.applicationName,
        environmentName: config.environmentName,
      });
    const result = validateTopology(payload, { ...config, clock: dependencies.clock });
    (dependencies.writeJson || writeJson)(config.output, result);
    console.log(`AWS release topology ${config.mode} passed; evidence written.`);
    return result;
  } catch (error) {
    const candidate = outputPath || (() => {
      const index = argv.indexOf('--output');
      return index >= 0 ? argv[index + 1] : undefined;
    })();
    if (candidate) {
      try {
        (dependencies.writeJson || writeJson)(candidate, {
          schemaVersion: 1,
          status: 'failed',
          phase: argv[0] || 'unknown',
          checkedAt: nowIso(dependencies.clock),
          reason: sanitizeMessage(error),
        });
      } catch (_writeError) {
        // Do not mask the original fail-closed result.
      }
    }
    throw error;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`AWS release topology failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_APPLICATION,
  EXPECTED_ENVIRONMENT,
  EXPECTED_REGION,
  cliConfiguration,
  collectAwsTopology,
  main,
  optionValue,
  validateTopology,
};
