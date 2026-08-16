#!/usr/bin/env node
'use strict';

const {
  createAwsCliRunner,
  nowIso,
  parseOptions,
  requireOption,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const TRANSITIONAL = new Set(['Processing', 'Building']);

function parsePositiveInteger(value, name, minimum, maximum) {
  if (!/^\d+$/.test(String(value || ''))) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseConfig(argv, env = process.env) {
  const options = parseOptions(argv, { booleans: ['--allow-unprocessed-reused'] });
  const applicationName = options['--application-name'] || env.EB_APPLICATION_NAME;
  const versionLabel = options['--version-label'] || env.EB_VERSION_LABEL;
  const region = options['--region'] || env.AWS_REGION;
  const output = requireOption(options, '--output');
  requireOption({ value: applicationName }, 'value');
  requireOption({ value: region }, 'value');
  if (!/^mosaic-[0-9a-f]{40}$/.test(String(versionLabel || ''))) {
    throw new Error('version-label must be mosaic- followed by one full lowercase Git SHA');
  }
  return {
    applicationName,
    versionLabel,
    region,
    output,
    timeoutSeconds: parsePositiveInteger(
      options['--timeout-seconds'] || env.EB_VERSION_PROCESS_TIMEOUT_SECONDS || '600',
      'timeout-seconds',
      1,
      1800
    ),
    pollSeconds: parsePositiveInteger(
      options['--poll-seconds'] || env.EB_VERSION_PROCESS_POLL_SECONDS || '5',
      'poll-seconds',
      1,
      60
    ),
    allowUnprocessedReused: options['--allow-unprocessed-reused'] === true,
  };
}

function readExactVersion(runAws, config) {
  const response = runAws('elasticbeanstalk', 'describe-application-versions', [
    '--application-name', config.applicationName,
    '--version-labels', config.versionLabel,
    '--region', config.region,
  ]);
  const versions = response && response.ApplicationVersions;
  if (!Array.isArray(versions) || versions.length !== 1) {
    throw new Error('Elastic Beanstalk did not return exactly one application version');
  }
  const version = versions[0];
  if (version.VersionLabel !== config.versionLabel || typeof version.Status !== 'string') {
    throw new Error('Elastic Beanstalk application-version identity is invalid');
  }
  return version.Status;
}

async function requireProcessedVersion(config, dependencies = {}) {
  const runAws = dependencies.runAws || createAwsCliRunner(dependencies);
  const wait = dependencies.wait || ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const clock = dependencies.clock || (() => new Date());
  const deadline = clock().getTime() + (config.timeoutSeconds * 1000);

  while (true) {
    const status = readExactVersion(runAws, config);
    if (status === 'Processed') {
      return {
        schemaVersion: 1,
        status: 'passed',
        checkedAt: nowIso(clock),
        versionLabel: config.versionLabel,
        applicationVersionStatus: status,
      };
    }
    if (status === 'Unprocessed' && config.allowUnprocessedReused === true) {
      return {
        schemaVersion: 1,
        status: 'passed',
        checkedAt: nowIso(clock),
        versionLabel: config.versionLabel,
        applicationVersionStatus: status,
        historicalRollbackCompatibility: true,
      };
    }
    if (!TRANSITIONAL.has(status)) {
      throw new Error(`Elastic Beanstalk application version is not deployable (${status})`);
    }
    if (clock().getTime() >= deadline) {
      throw new Error('Elastic Beanstalk application-version processing timed out');
    }
    await wait(config.pollSeconds * 1000);
  }
}

async function main(argv = process.argv.slice(2)) {
  const config = parseConfig(argv);
  const result = await requireProcessedVersion(config);
  writeJson(config.output, result);
  console.log(`Elastic Beanstalk application version is deployable (${result.applicationVersionStatus}).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`EB application-version check failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseConfig,
  readExactVersion,
  requireProcessedVersion,
};
