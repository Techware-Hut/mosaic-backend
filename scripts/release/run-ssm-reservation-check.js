#!/usr/bin/env node
'use strict';

const {
  createAwsCliRunner,
  instanceSuffix,
  nowIso,
  parseOptions,
  readJson,
  requireOption,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const DOCUMENT_NAME = 'MosaicReadOnlyReservationCheck';
const DOCUMENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const COMMAND_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const TERMINAL_FAILURES = new Set([
  'Cancelled',
  'Cancelling',
  'Delivery Timed Out',
  'Execution Timed Out',
  'TimedOut',
  'Failed',
  'Incomplete',
  'Undeliverable',
  'Terminated',
]);

function one(values, label) {
  if (!Array.isArray(values) || values.length !== 1) {
    throw new Error(`${label} must contain exactly one item`);
  }
  return values[0];
}

function documentVersion(value) {
  if (!/^\d+$/.test(String(value || '')) || Number(value) < 1) {
    throw new Error('SSM_RESERVATION_DOCUMENT_VERSION must be a positive integer');
  }
  return String(Number(value));
}

function documentHash(value) {
  const normalized = String(value || '').toLowerCase();
  if (!DOCUMENT_HASH_PATTERN.test(normalized)) {
    throw new Error('SSM_RESERVATION_DOCUMENT_SHA256 must be a 64-character SHA-256');
  }
  return normalized;
}

function parseCountOnlyOutput(stdout) {
  const value = String(stdout || '').trim();
  if (!value || value.includes('\n') || value.length > 160) {
    throw new Error('SSM reservation document output is not one count-only JSON line');
  }
  let payload;
  try {
    payload = JSON.parse(value);
  } catch (_error) {
    throw new Error('SSM reservation document output is not valid count-only JSON');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([
      'activeReservationCount',
      'incompletePaidOrderCount',
      'unresolvedPaymentIntentCount',
    ]) ||
    !Number.isSafeInteger(payload.activeReservationCount) ||
    payload.activeReservationCount < 0 ||
    !Number.isSafeInteger(payload.incompletePaidOrderCount) ||
    payload.incompletePaidOrderCount < 0 ||
    !Number.isSafeInteger(payload.unresolvedPaymentIntentCount) ||
    payload.unresolvedPaymentIntentCount < 0
  ) {
    throw new Error('SSM reservation document output violates the count-only schema');
  }
  return payload;
}

function validateDocument(payload, config) {
  const document = payload && payload.Document;
  if (
    !document ||
    document.Name !== DOCUMENT_NAME ||
    document.DocumentType !== 'Command' ||
    document.Status !== 'Active' ||
    String(document.DocumentVersion) !== config.documentVersion ||
    String(document.HashType).toLowerCase() !== 'sha256' ||
    String(document.Hash).toLowerCase() !== config.documentHash
  ) {
    throw new Error('Pinned custom SSM reservation document identity is not active or exact');
  }
}

function selectInstance(resourcesPayload, instanceInformationPayload, environmentName) {
  const resources = resourcesPayload && resourcesPayload.EnvironmentResources;
  if (!resources || resources.EnvironmentName !== environmentName) {
    throw new Error('Elastic Beanstalk environment resources are unavailable');
  }
  const instance = one(resources.Instances, 'Elastic Beanstalk environment Instances');
  if (!instance || typeof instance.Id !== 'string' || !/^i-[a-f0-9]+$/i.test(instance.Id)) {
    throw new Error('Elastic Beanstalk instance identifier is unavailable');
  }
  const information = one(
    instanceInformationPayload && instanceInformationPayload.InstanceInformationList,
    'SSM InstanceInformationList'
  );
  if (
    information.InstanceId !== instance.Id ||
    information.PingStatus !== 'Online' ||
    information.PlatformType !== 'Linux'
  ) {
    throw new Error('The exact Elastic Beanstalk instance is not an online Linux SSM target');
  }
  return instance.Id;
}

function commandId(payload) {
  const value = payload && payload.Command && payload.Command.CommandId;
  if (!COMMAND_ID_PATTERN.test(String(value || ''))) {
    throw new Error('SSM did not return a valid command identifier');
  }
  return value;
}

async function executeReservationCheck({ runAws, wait, config, clock }) {
  const regionArgs = ['--region', config.region];
  const document = runAws('ssm', 'describe-document', [
    '--name', DOCUMENT_NAME,
    '--document-version', config.documentVersion,
    ...regionArgs,
  ]);
  validateDocument(document, config);

  const resources = runAws('elasticbeanstalk', 'describe-environment-resources', [
    '--environment-name', config.environmentName,
    ...regionArgs,
  ]);
  const resourceInstances = resources.EnvironmentResources && resources.EnvironmentResources.Instances;
  const resourceInstance = one(resourceInstances, 'Elastic Beanstalk environment Instances');
  const instanceInformation = runAws('ssm', 'describe-instance-information', [
    '--filters', `Key=InstanceIds,Values=${resourceInstance.Id}`,
    ...regionArgs,
  ]);
  const instanceId = selectInstance(resources, instanceInformation, config.environmentName);

  const sent = runAws('ssm', 'send-command', [
    '--document-name', DOCUMENT_NAME,
    '--document-version', config.documentVersion,
    '--document-hash', config.documentHash,
    '--document-hash-type', 'Sha256',
    '--instance-ids', instanceId,
    '--timeout-seconds', String(config.commandTimeoutSeconds),
    '--max-concurrency', '1',
    '--max-errors', '0',
    '--comment', 'Mosaic production release reservation count',
    ...regionArgs,
  ]);
  const id = commandId(sent);

  let invocation;
  // GetCommandInvocation is eventually consistent immediately after SendCommand.
  await wait(config.pollIntervalMs);
  for (let attempt = 1; attempt <= config.pollAttempts; attempt += 1) {
    invocation = runAws('ssm', 'get-command-invocation', [
      '--command-id', id,
      '--instance-id', instanceId,
      ...regionArgs,
    ]);
    if (invocation.Status === 'Success' || TERMINAL_FAILURES.has(invocation.Status)) break;
    if (!['Pending', 'InProgress', 'Delayed'].includes(invocation.Status)) {
      throw new Error('SSM reservation command returned an unknown status');
    }
    if (attempt < config.pollAttempts) await wait(config.pollIntervalMs);
  }
  if (!invocation || invocation.Status !== 'Success') {
    // StandardErrorContent and ResponseCode are deliberately never surfaced.
    throw new Error('SSM reservation command did not complete successfully');
  }
  if (String(invocation.StandardErrorContent || '').trim() !== '') {
    throw new Error('SSM reservation command produced unexpected stderr');
  }

  const counts = parseCountOnlyOutput(invocation.StandardOutputContent);
  const blocked = counts.activeReservationCount !== 0
    || counts.incompletePaidOrderCount !== 0
    || counts.unresolvedPaymentIntentCount !== 0;
  const evidence = {
    schemaVersion: 1,
    status: blocked ? 'blocked' : 'passed',
    checkedAt: nowIso(clock),
    mode: 'require-zero',
    document: DOCUMENT_NAME,
    documentVersion: config.documentVersion,
    environment: config.environmentName,
    instanceSuffix: instanceSuffix(instanceId),
    ...counts,
    readOnly: true,
    productionMutation: false,
  };
  if (blocked) {
    const error = new Error(
      `Release blockers are nonzero (reservations=${counts.activeReservationCount}, incomplete-paid=${counts.incompletePaidOrderCount}, unresolved-intents=${counts.unresolvedPaymentIntentCount}); human reconciliation is required`
    );
    error.activeReservationCount = counts.activeReservationCount;
    error.incompletePaidOrderCount = counts.incompletePaidOrderCount;
    error.unresolvedPaymentIntentCount = counts.unresolvedPaymentIntentCount;
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}

function createFixtureRunner(fixture) {
  const invocationSequence = Array.isArray(fixture.invocations)
    ? [...fixture.invocations]
    : fixture.invocation
      ? [fixture.invocation]
      : [];
  const fixed = {
    'ssm describe-document': fixture.document,
    'elasticbeanstalk describe-environment-resources': fixture.resources,
    'ssm describe-instance-information': fixture.instanceInformation,
    'ssm send-command': fixture.sendCommand,
  };
  return (service, operation) => {
    const key = `${service} ${operation}`;
    if (key === 'ssm get-command-invocation') {
      if (invocationSequence.length === 0) throw new Error('Fixture invocation sequence is exhausted');
      return invocationSequence.length === 1 ? invocationSequence[0] : invocationSequence.shift();
    }
    if (!fixed[key]) throw new Error(`Fixture response is missing for ${key}`);
    return fixed[key];
  };
}

function cliConfiguration(argv, env = process.env, fixtureConfiguration = {}) {
  const options = parseOptions(argv, { positionals: 0, booleans: ['--require-zero'] });
  const allowed = new Set(['_', '--require-zero', '--output', '--fixture']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`Unsupported option: ${key}`);
  }
  if (options['--require-zero'] !== true) {
    throw new Error(
      'Usage: run-ssm-reservation-check.js --require-zero --output <json> [--fixture <json>]'
    );
  }
  const from = (fixtureName, envName, fallback) =>
    fixtureConfiguration[fixtureName] || env[envName] || fallback;
  if (from('documentName', 'SSM_RESERVATION_DOCUMENT_NAME', DOCUMENT_NAME) !== DOCUMENT_NAME) {
    throw new Error(`Only the pinned custom document ${DOCUMENT_NAME} is permitted`);
  }
  const commandTimeoutSeconds = Number(
    from('commandTimeoutSeconds', 'SSM_RESERVATION_COMMAND_TIMEOUT_SECONDS', '120')
  );
  const pollIntervalMs = Number(from('pollIntervalMs', 'SSM_RESERVATION_POLL_INTERVAL_MS', '3000'));
  const pollAttempts = Number(from('pollAttempts', 'SSM_RESERVATION_POLL_ATTEMPTS', '40'));
  if (!Number.isSafeInteger(commandTimeoutSeconds) || commandTimeoutSeconds < 30 || commandTimeoutSeconds > 600) {
    throw new Error('SSM reservation command timeout must be 30-600 seconds');
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 10000) {
    throw new Error('SSM reservation poll interval must be 100-10000ms');
  }
  if (!Number.isSafeInteger(pollAttempts) || pollAttempts < 1 || pollAttempts > 120) {
    throw new Error('SSM reservation poll attempts must be 1-120');
  }
  return {
    output: requireOption(options, '--output'),
    fixture: options['--fixture'],
    region: from('region', 'AWS_REGION', 'us-east-1'),
    environmentName: from('environmentName', 'EB_ENVIRONMENT_NAME', 'mosaic-backend-env'),
    documentVersion: documentVersion(
      from('documentVersion', 'SSM_RESERVATION_DOCUMENT_VERSION')
    ),
    documentHash: documentHash(from('documentHash', 'SSM_RESERVATION_DOCUMENT_SHA256')),
    commandTimeoutSeconds,
    pollIntervalMs,
    pollAttempts,
  };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  let outputPath;
  try {
    const preliminary = parseOptions(argv, { positionals: 0, booleans: ['--require-zero'] });
    const fixture = preliminary['--fixture']
      ? readJson(preliminary['--fixture'], 'SSM reservation fixture')
      : null;
    const config = cliConfiguration(
      argv,
      dependencies.env || process.env,
      fixture && fixture.configuration ? fixture.configuration : {}
    );
    outputPath = config.output;
    const result = await executeReservationCheck({
      runAws: dependencies.runAws || (fixture
        ? createFixtureRunner(fixture)
        : createAwsCliRunner(dependencies)),
      wait: dependencies.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      config,
      clock: dependencies.clock,
    });
    (dependencies.writeJson || writeJson)(config.output, result);
    console.log('Release-blocking reservation and paid-order counts are zero; count-only evidence written.');
    return result;
  } catch (error) {
    const candidate = outputPath || (() => {
      const index = argv.indexOf('--output');
      return index >= 0 ? argv[index + 1] : undefined;
    })();
    const result = error.evidence || {
      schemaVersion: 1,
      status: 'failed',
      checkedAt: nowIso(dependencies.clock),
      mode: 'require-zero',
      activeReservationCount: Number.isSafeInteger(error.activeReservationCount)
        ? error.activeReservationCount
        : null,
      incompletePaidOrderCount: Number.isSafeInteger(error.incompletePaidOrderCount)
        ? error.incompletePaidOrderCount
        : null,
      unresolvedPaymentIntentCount: Number.isSafeInteger(error.unresolvedPaymentIntentCount)
        ? error.unresolvedPaymentIntentCount
        : null,
      readOnly: true,
      productionMutation: false,
      reason: sanitizeMessage(error),
    };
    if (candidate) {
      try {
        (dependencies.writeJson || writeJson)(candidate, result);
      } catch (_writeError) {
        // Do not mask the original fail-closed result.
      }
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`SSM reservation safety check failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DOCUMENT_NAME,
  cliConfiguration,
  createFixtureRunner,
  executeReservationCheck,
  main,
  parseCountOnlyOutput,
  selectInstance,
  validateDocument,
};
