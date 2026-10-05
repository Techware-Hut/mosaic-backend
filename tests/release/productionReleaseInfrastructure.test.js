'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const topologyApi = require('../../scripts/release/aws-release-topology');
const focusedPreflightApi = require('../../scripts/release/run-focused-baseline-preflight');
const gateApi = require('../../scripts/release/manage-checkout-gate');
const ssmApi = require('../../scripts/release/run-ssm-reservation-check');
const reservationApi = require('../../scripts/release/query-active-reservations');
const trustedReservationTool = require('../../infrastructure/release-control/reservation-tool');

const SHA = 'a'.repeat(40);
const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const APPLICATION = 'mosaic-biz-hub-backend';
const ENVIRONMENT = 'mosaic-backend-env';
const INSTANCE_ID = 'i-000000001234abcd';
const LOAD_BALANCER_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/prod/abc123`;
const HTTP_LISTENER_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/prod/abc123/http80`;
const HTTPS_LISTENER_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/prod/abc123/https443`;
const TARGET_GROUP_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:targetgroup/prod/tg123`;
const HTTP_RULE_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener-rule/app/prod/abc123/http80/rule1`;
const HTTPS_RULE_ARN =
  `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener-rule/app/prod/abc123/https443/rule2`;
const DOCUMENT_HASH = 'b'.repeat(64);

function topologyFixture() {
  return {
    environments: {
      Environments: [{
        ApplicationName: APPLICATION,
        EnvironmentName: ENVIRONMENT,
        Status: 'Ready',
        Health: 'Green',
        HealthStatus: 'Ok',
        VersionLabel: `mosaic-${SHA}`,
      }],
    },
    configuration: {
      ConfigurationSettings: [{
        ApplicationName: APPLICATION,
        EnvironmentName: ENVIRONMENT,
        OptionSettings: [
          {
            Namespace: 'aws:elasticbeanstalk:command',
            OptionName: 'DeploymentPolicy',
            Value: 'AllAtOnce',
          },
          {
            Namespace: 'aws:autoscaling:updatepolicy:rollingupdate',
            OptionName: 'RollingUpdateEnabled',
            Value: 'false',
          },
          {
            Namespace: 'aws:elasticbeanstalk:healthreporting:system',
            OptionName: 'SystemType',
            Value: 'enhanced',
          },
        ],
      }],
    },
    resources: {
      EnvironmentResources: {
        EnvironmentName: ENVIRONMENT,
        AutoScalingGroups: [{ Name: 'asg-prod' }],
        // Current EB returns the ALB ARN in this Name field.
        LoadBalancers: [{ Name: LOAD_BALANCER_ARN }],
        Instances: [{ Id: INSTANCE_ID }],
      },
    },
    instanceHealth: {
      InstanceHealthList: [{
        InstanceId: INSTANCE_ID,
        HealthStatus: 'Ok',
        Color: 'Green',
        Deployment: {
          Status: 'Deployed',
          VersionLabel: `mosaic-${SHA}`,
        },
      }],
    },
    autoScaling: {
      AutoScalingGroups: [{
        AutoScalingGroupName: 'asg-prod',
        MinSize: 1,
        MaxSize: 1,
        DesiredCapacity: 1,
        Instances: [{
          InstanceId: INSTANCE_ID,
          LifecycleState: 'InService',
          HealthStatus: 'Healthy',
        }],
      }],
    },
    loadBalancers: {
      LoadBalancers: [{
        LoadBalancerArn: LOAD_BALANCER_ARN,
        LoadBalancerName: 'prod',
        Type: 'application',
        Scheme: 'internet-facing',
        State: { Code: 'active' },
      }],
    },
    listeners: {
      Listeners: [
        {
          ListenerArn: HTTP_LISTENER_ARN,
          LoadBalancerArn: LOAD_BALANCER_ARN,
          Port: 80,
          Protocol: 'HTTP',
          DefaultActions: [{ Type: 'forward', TargetGroupArn: TARGET_GROUP_ARN }],
        },
        {
          ListenerArn: HTTPS_LISTENER_ARN,
          LoadBalancerArn: LOAD_BALANCER_ARN,
          Port: 443,
          Protocol: 'HTTPS',
          DefaultActions: [{ Type: 'forward', TargetGroupArn: TARGET_GROUP_ARN }],
        },
      ],
    },
    targetGroups: {
      TargetGroups: [{
        TargetGroupArn: TARGET_GROUP_ARN,
        LoadBalancerArns: [LOAD_BALANCER_ARN],
      }],
    },
    targetHealthByGroup: {
      [TARGET_GROUP_ARN]: {
        TargetHealthDescriptions: [{
          Target: { Id: INSTANCE_ID },
          TargetHealth: { State: 'healthy' },
        }],
      },
    },
    loadBalancerAttributes: {
      Attributes: [{ Key: 'idle_timeout.timeout_seconds', Value: '60' }],
    },
  };
}

function topologyOptions(mode = 'preflight', overrides = {}) {
  return {
    applicationName: APPLICATION,
    environmentName: ENVIRONMENT,
    mode,
    releaseSha: SHA,
    mixedVersionSafe: false,
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
    ...overrides,
  };
}

function gateFixture(initialPath = gateApi.DEFAULT_DISABLED_PATH, releaseMode = 'release') {
  const rule = (ruleArn) => ({
    RuleArn: ruleArn,
    Priority: '1',
    IsDefault: false,
    Conditions: gateApi.gateConditions(initialPath, releaseMode),
    Actions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '503' } }],
  });
  return {
    loadBalancers: topologyFixture().loadBalancers,
    listeners: topologyFixture().listeners,
    rulesByListener: {
      [HTTP_LISTENER_ARN]: { Rules: [rule(HTTP_RULE_ARN)] },
      [HTTPS_LISTENER_ARN]: { Rules: [rule(HTTPS_RULE_ARN)] },
    },
    tags: {
      TagDescriptions: [
        {
          ResourceArn: HTTP_RULE_ARN,
          Tags: [{ Key: gateApi.REQUIRED_TAG_KEY, Value: gateApi.REQUIRED_TAG_VALUE }],
        },
        {
          ResourceArn: HTTPS_RULE_ARN,
          Tags: [{ Key: gateApi.REQUIRED_TAG_KEY, Value: gateApi.REQUIRED_TAG_VALUE }],
        },
      ],
    },
  };
}

function gateConfig(releaseMode = 'release') {
  return {
    releaseMode,
    region: REGION,
    loadBalancerArn: LOAD_BALANCER_ARN,
    httpRuleArn: HTTP_RULE_ARN,
    httpsRuleArn: HTTPS_RULE_ARN,
    httpPriority: '1',
    httpsPriority: '1',
    disabledPath: gateApi.DEFAULT_DISABLED_PATH,
    tagKey: gateApi.REQUIRED_TAG_KEY,
    tagValue: gateApi.REQUIRED_TAG_VALUE,
  };
}

function bashPath(filePath) {
  return process.platform === 'win32'
    ? '/mnt/' + filePath[0].toLowerCase() + filePath.slice(2).replaceAll('\\', '/')
    : filePath;
}

function bashQuote(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
}

function runGateVerifierFixture({ releaseMode, releaseModeFlags, trailingReleaseMode, inheritedReleaseMode, state, orderStatus, legacyStatus, webhookStatus } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-gate-verifier-'));
  const mockCurl = path.join(tempDir, 'mock-curl.sh');
  const mockCurlLog = path.join(tempDir, 'mock-curl.log');
  const verifier = path.resolve(__dirname, '../../scripts/release/verify-checkout-gate.sh');
  fs.writeFileSync(mockCurl, [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$*" >> "$MOCK_CURL_LOG"',
    'url="${!#}"',
    'case "$url" in',
    '  */api/orders/initiate|*/api/orders/initiate/|*/API/ORDERS/INITIATE|*/Api/Orders/Initiate/) printf "%s" "${MOCK_ORDER_STATUS:-503}" ;;',
    '  */api/payments/create-payment-intent|*/api/payments/create-payment-intent/|*/API/PAYMENTS/CREATE-PAYMENT-INTENT|*/Api/Payments/Create-Payment-Intent/) printf "%s" "${MOCK_LEGACY_STATUS:-503}" ;;',
    '  */api/webhooks/stripe|*/api/stripe/webhook|*/api/stripe/payment/webhook|*/api/subscription/webhook|*/api/vendor-onboarding/webhook/payment) printf "%s" "${MOCK_WEBHOOK_STATUS:-400}" ;;',
    '  */api/health|*/api/ready|*/api/build-info) printf "200" ;;',
    '  *) printf "404" ;;',
    'esac',
    '',
  ].join('\n'));
  fs.chmodSync(mockCurl, 0o755);
  try {
    const values = {
      CURL_BIN: bashPath(mockCurl),
      MOCK_CURL_LOG: bashPath(mockCurlLog),
      MOCK_ORDER_STATUS: orderStatus || 503,
      MOCK_LEGACY_STATUS: legacyStatus || 503,
      MOCK_WEBHOOK_STATUS: webhookStatus || 400,
    };
    if (inheritedReleaseMode !== undefined) values.RELEASE_MODE = inheritedReleaseMode;
    const assignments = Object.entries(values)
      .map(([name, value]) => name + '=' + bashQuote(value));
    const args = ['bash', bashQuote(bashPath(verifier))];
    const modes = releaseModeFlags || (releaseMode !== undefined ? [releaseMode] : []);
    for (const mode of modes) args.push('--release-mode', bashQuote(mode));
    if (state) args.push('--state', bashQuote(state));
    args.push(bashQuote('http://release-control.test'));
    if (trailingReleaseMode !== undefined) args.push('--release-mode', bashQuote(trailingReleaseMode));
    args.push(bashQuote('https://release-control.test'));
    const cleanEnv = { ...process.env };
    delete cleanEnv.RELEASE_MODE;
    const result = spawnSync('bash', ['-lc', assignments.concat(args).join(' ')], {
      encoding: 'utf8',
      timeout: 15000,
      env: cleanEnv,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const error = new Error('Fixture gate verifier failed');
      error.status = result.status;
      error.stderr = result.stderr;
      error.httpCalls = fs.existsSync(mockCurlLog)
        ? fs.readFileSync(mockCurlLog, 'utf8').trim().split('\n').length
        : 0;
      throw error;
    }
    return result.stdout;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function ssmFixture(count = 0, incompletePaid = 0, unresolvedIntents = 0) {
  return {
    document: {
      Document: {
        Name: ssmApi.DOCUMENT_NAME,
        DocumentType: 'Command',
        Status: 'Active',
        DocumentVersion: '1',
        HashType: 'Sha256',
        Hash: DOCUMENT_HASH,
      },
    },
    resources: topologyFixture().resources,
    instanceInformation: {
      InstanceInformationList: [{
        InstanceId: INSTANCE_ID,
        PingStatus: 'Online',
        PlatformType: 'Linux',
      }],
    },
    sendCommand: {
      Command: { CommandId: '11111111-2222-3333-4444-555555555555' },
    },
    invocations: [{
      Status: 'Success',
      StandardOutputContent: `${JSON.stringify({
        activeReservationCount: count,
        incompletePaidOrderCount: incompletePaid,
        unresolvedPaymentIntentCount: unresolvedIntents,
      })}\n`,
      StandardErrorContent: '',
    }],
  };
}

function ssmConfig() {
  return {
    region: REGION,
    environmentName: ENVIRONMENT,
    documentVersion: '1',
    documentHash: DOCUMENT_HASH,
    commandTimeoutSeconds: 120,
    pollIntervalMs: 100,
    pollAttempts: 2,
  };
}

test('exact current single-instance topology passes and emits no ARN', () => {
  const result = topologyApi.validateTopology(topologyFixture(), topologyOptions('verify'));

  assert.equal(result.status, 'passed');
  assert.equal(result.currentVersion, `mosaic-${SHA}`);
  assert.equal(result.topology.safeSingleInstanceCutover, true);
  assert.equal(result.loadBalancer.healthyTargetCount, 1);
  assert.equal(result.loadBalancer.idleTimeoutSeconds, 60);
  assert.doesNotMatch(JSON.stringify(result), /arn:aws/);
  assert.deepEqual(result.loadBalancer.listeners, ['HTTP/80', 'HTTPS/443']);
});

test('topology fails closed on wrong version, unhealthy target, or unsafe rolling capacity', () => {
  const wrongVersion = topologyFixture();
  wrongVersion.instanceHealth.InstanceHealthList[0].Deployment.VersionLabel =
    `mosaic-${'c'.repeat(40)}`;
  assert.throws(
    () => topologyApi.validateTopology(wrongVersion, topologyOptions('verify')),
    /wrong version/
  );

  const unhealthyTarget = topologyFixture();
  unhealthyTarget.targetHealthByGroup[TARGET_GROUP_ARN]
    .TargetHealthDescriptions[0].TargetHealth.State = 'unhealthy';
  assert.throws(
    () => topologyApi.validateTopology(unhealthyTarget, topologyOptions()),
    /Every ALB target must be healthy/
  );

  const rolling = topologyFixture();
  rolling.autoScaling.AutoScalingGroups[0].MaxSize = 2;
  assert.throws(
    () => topologyApi.validateTopology(rolling, topologyOptions()),
    /not mixed-version certified/
  );
  assert.equal(
    topologyApi.validateTopology(
      rolling,
      topologyOptions('preflight', { mixedVersionSafe: true })
    ).topology.mixedVersionSafe,
    true
  );
});

test('unavailable EB instance health requires an explicit proof-only preflight opt-in', () => {
  const missingHealth = topologyFixture();
  missingHealth.instanceHealth = null;
  const proofOptions = topologyOptions('preflight', {
    allowInstanceHealthAccessDeniedInProof: true,
  });

  assert.throws(() => topologyApi.validateTopology(missingHealth, topologyOptions('preflight')),
    /Enhanced Health instance inventory/);
  assert.throws(() => topologyApi.validateTopology(missingHealth, topologyOptions('verify')),
    /Enhanced Health instance inventory/);
  assert.throws(() => topologyApi.validateTopology(missingHealth, topologyOptions('verify', {
    allowInstanceHealthAccessDeniedInProof: true,
  })), /Proof-only instance health warning state is invalid/);

  const result = topologyApi.validateTopology(missingHealth, proofOptions);
  assert.equal(result.status, 'passed');
  assert.equal(result.phase, 'preflight');
  assert.equal(result.instanceHealthVerified, false);
  assert.equal(result.instances, null);
  assert.equal(result.enhancedHealth, true);
  assert.equal(result.loadBalancer.healthyTargetCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /arn:aws|123456789012|i-000000001234abcd/);

  const strictResult = topologyApi.validateTopology(topologyFixture(), topologyOptions('preflight'));
  assert.equal(Object.hasOwn(strictResult, 'instanceHealthVerified'), false);
  assert.equal(strictResult.instances.length, 1);

  for (const malformedHealth of [undefined, {}, { InstanceHealthList: [] }]) {
    const payload = topologyFixture();
    payload.instanceHealth = malformedHealth;
    assert.throws(() => topologyApi.validateTopology(payload, proofOptions),
      /Proof-only instance health warning state is invalid/);
  }
  const unhealthyHealth = topologyFixture();
  unhealthyHealth.instanceHealth.InstanceHealthList[0].Color = 'Red';
  assert.throws(() => topologyApi.validateTopology(unhealthyHealth, proofOptions),
    /Proof-only instance health warning state is invalid/);
});

test('production topology CLI preflight and verify remain strict on missing EB instance health', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-topology-strict-'));
  const fixturePath = path.join(temporary, 'topology.json');
  const outputPath = path.join(temporary, 'evidence.json');
  const payload = topologyFixture();
  payload.instanceHealth = null;
  fs.writeFileSync(fixturePath, JSON.stringify(payload));
  try {
    for (const mode of ['preflight', 'verify']) {
      let evidence;
      assert.throws(() => topologyApi.main([
        mode, '--output', outputPath, '--release-sha', SHA, '--fixture', fixturePath,
      ], {
        env: {
          AWS_REGION: REGION,
          EB_APPLICATION_NAME: APPLICATION,
          EB_ENVIRONMENT_NAME: ENVIRONMENT,
        },
        writeJson(_path, result) { evidence = result; },
        clock: () => new Date('2026-08-13T00:00:00.000Z'),
      }), /Enhanced Health instance inventory/);
      assert.equal(evidence.status, 'failed');
      assert.equal(evidence.phase, mode);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('AWS topology collection uses an ARN selector and projects EB configuration', () => {
  const fixture = topologyFixture();
  const responses = new Map([
    ['elasticbeanstalk describe-environments', fixture.environments],
    ['elasticbeanstalk describe-configuration-settings', fixture.configuration],
    ['elasticbeanstalk describe-environment-resources', fixture.resources],
    ['elasticbeanstalk describe-instances-health', fixture.instanceHealth],
    ['autoscaling describe-auto-scaling-groups', fixture.autoScaling],
    ['elbv2 describe-load-balancers', fixture.loadBalancers],
    ['elbv2 describe-listeners', fixture.listeners],
    ['elbv2 describe-target-groups', fixture.targetGroups],
    ['elbv2 describe-load-balancer-attributes', fixture.loadBalancerAttributes],
  ]);
  const calls = [];
  const runAws = (service, operation, args) => {
    calls.push({ service, operation, args });
    if (service === 'elbv2' && operation === 'describe-rules') return { Rules: [] };
    if (service === 'elbv2' && operation === 'describe-target-health') {
      return fixture.targetHealthByGroup[TARGET_GROUP_ARN];
    }
    return structuredClone(responses.get(`${service} ${operation}`));
  };

  topologyApi.collectAwsTopology({
    runAws,
    region: REGION,
    applicationName: APPLICATION,
    environmentName: ENVIRONMENT,
  });

  const loadBalancerCall = calls.find(
    (call) => call.service === 'elbv2' && call.operation === 'describe-load-balancers'
  );
  assert.deepEqual(
    loadBalancerCall.args.slice(0, 2),
    ['--load-balancer-arns', LOAD_BALANCER_ARN]
  );
  const configurationCall = calls.find(
    (call) => call.service === 'elasticbeanstalk' &&
      call.operation === 'describe-configuration-settings'
  );
  assert.ok(configurationCall.args.includes('--query'));
  const query = configurationCall.args[configurationCall.args.indexOf('--query') + 1];
  assert.match(query, /DeploymentPolicy/);
  assert.match(query, /RollingUpdateEnabled/);
  assert.match(query, /SystemType/);
});

test('two pinned gate rules transition idempotently and retain exact POST/path/503 shape', () => {
  const client = gateApi.createFixtureGateClient(gateFixture());
  const enabled = gateApi.transitionGate(client, 'active', gateConfig());
  const idempotent = gateApi.transitionGate(client, 'active', gateConfig());

  assert.equal(enabled.gateState, 'active');
  assert.equal(enabled.operation, 'enabled');
  assert.equal(idempotent.operation, 'idempotent');
  assert.equal(enabled.rules.length, 2);
  assert.match(gateApi.ACTIVE_PATH_REGEX, /\[aA\]\[pP\]\[iI\]/);
  assert.deepEqual(
    gateApi.gateConditions(gateApi.ACTIVE_PATH)[1].PathPatternConfig,
    { RegexValues: [gateApi.ACTIVE_PATH_REGEX] }
  );
  const matcher = new RegExp(gateApi.ACTIVE_PATH_REGEX);
  for (const pathName of [
    '/api/orders/initiate',
    '/api/orders/initiate/',
    '/API/ORDERS/INITIATE',
    '/Api/Orders/Initiate/',
  ]) assert.equal(matcher.test(pathName), true, pathName);
  for (const pathName of [
    '/api/orders/initiate-extra',
    '/api/orders/initiate//',
    '/api/orders',
    '/api/stripe/webhook',
  ]) assert.equal(matcher.test(pathName), false, pathName);
  assert.doesNotMatch(JSON.stringify(enabled), /arn:aws/);

  const disabled = gateApi.transitionGate(client, 'inactive', gateConfig());
  assert.equal(disabled.gateState, 'inactive');
  assert.equal(disabled.operation, 'disabled');
  assert.equal(gateApi.verifyGate(client, 'inactive', gateConfig()).gateState, 'inactive');
});

test('focused-baseline gate models both checkout routes without broadening unrelated paths', () => {
  const config = gateConfig('focused-baseline');
  const regexValues = gateApi.activePathRegexValues(config.releaseMode);
  assert.equal(regexValues.length, 3);
  assert.ok(regexValues.every((value) => value.length <= 128));
  assert.deepEqual(gateApi.activePathRegexValues('release'), [gateApi.ACTIVE_PATH_REGEX]);
  assert.deepEqual(gateApi.gateConditions(gateApi.ACTIVE_PATH, config.releaseMode)[1]
    .PathPatternConfig, { RegexValues: regexValues });

  const matches = (pathName) => regexValues.some((value) => new RegExp(value).test(pathName));
  for (const pathName of [
    '/api/orders/initiate',
    '/api/orders/initiate/',
    '/API/ORDERS/INITIATE',
    '/Api/Orders/Initiate/',
    '/api/payments/create-payment-intent',
    '/api/payments/create-payment-intent/',
    '/API/PAYMENTS/CREATE-PAYMENT-INTENT',
    '/Api/Payments/Create-Payment-Intent/',
  ]) assert.equal(matches(pathName), true, pathName);
  for (const pathName of [
    '/api/orders/initiate-extra',
    '/api/orders/initiate//',
    '/api/payments/create-payment-intent-extra',
    '/api/payments/create-payment-intent//',
    '/api/health',
    '/api/stripe/webhook',
  ]) assert.equal(matches(pathName), false, pathName);

  const client = gateApi.createFixtureGateClient(gateFixture());
  const enabled = gateApi.transitionGate(client, 'active', config);
  assert.equal(enabled.gateState, 'active');
  assert.equal(enabled.releaseMode, 'focused-baseline');
  assert.deepEqual(enabled.targets.map((target) => target.path), [
    gateApi.ACTIVE_PATH,
    gateApi.LEGACY_PAYMENT_PATH,
  ]);
  assert.equal(gateApi.verifyGate(client, 'active', config).gateState, 'active');
  for (const listenerArn of [HTTP_LISTENER_ARN, HTTPS_LISTENER_ARN]) {
    const rule = client.read().rulesByListener[listenerArn].Rules[0];
    assert.deepEqual(rule.Conditions[1].PathPatternConfig, { RegexValues: regexValues });
    assert.equal(rule.Actions[0].FixedResponseConfig.StatusCode, '503');
  }
  assert.doesNotMatch(JSON.stringify(enabled), /arn:aws/);
  assert.equal(gateApi.transitionGate(client, 'inactive', config).gateState, 'inactive');

  const awsCalls = [];
  const awsClient = gateApi.createAwsGateClient({
    runAws(service, operation, args) { awsCalls.push({ service, operation, args }); },
    region: REGION,
    config,
  });
  awsClient.modifyRule(HTTP_RULE_ARN, gateApi.ACTIVE_PATH);
  assert.equal(awsCalls.length, 1);
  assert.equal(awsCalls[0].operation, 'modify-rule');
  const conditionArgument = awsCalls[0].args[awsCalls[0].args.indexOf('--conditions') + 1];
  assert.deepEqual(JSON.parse(conditionArgument)[1].PathPatternConfig.RegexValues, regexValues);
});

test('focused-baseline gate rejects a canonical-only active rule and an unpinned legacy rule', () => {
  const config = gateConfig('focused-baseline');
  assert.throws(
    () => gateApi.inspectGate(gateFixture(gateApi.ACTIVE_PATH), config),
    /path condition/
  );

  const fixture = gateFixture();
  fixture.rulesByListener[HTTP_LISTENER_ARN].Rules.push({
    RuleArn: HTTP_RULE_ARN + '-duplicate',
    Priority: '2',
    IsDefault: false,
    Conditions: gateApi.gateConditions(gateApi.LEGACY_PAYMENT_PATH),
    Actions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '503' } }],
  });
  assert.throws(
    () => gateApi.inspectGate(fixture, config),
    /unpinned listener rule/
  );
});

test('focused-baseline partial transition failure regates both listeners', () => {
  const config = gateConfig('focused-baseline');
  const fixture = gateFixture(gateApi.ACTIVE_PATH, config.releaseMode);
  fixture.failOnModifyCall = 2;
  const client = gateApi.createFixtureGateClient(fixture);
  assert.throws(
    () => gateApi.transitionGate(client, 'inactive', config),
    (error) => error.gateState === 'active' && /fail-safe recovery/.test(error.message)
  );
  const observed = gateApi.inspectGate(client.read(), config);
  assert.equal(observed.state, 'active');
  assert.deepEqual(observed.records.map((record) => record.state), ['active', 'active']);
});

test('focused-baseline gate CLI allows explicit confirmed live transitions', () => {
  const verifyArgs = ['verify', '--release-mode', 'focused-baseline', '--output', 'unused.json'];
  assert.equal(gateApi.cliConfiguration(verifyArgs, {}, gateConfig()).releaseMode, 'focused-baseline');

  assert.throws(
    () => gateApi.cliConfiguration([
      'enable', '--release-mode', 'focused-baseline', '--output', 'unused.json',
    ], {}, gateConfig()),
    /enable requires --confirm ENABLE_CHECKOUT_GATE/,
  );
  const enable = gateApi.cliConfiguration([
    'enable', '--release-mode', 'focused-baseline', '--confirm', 'ENABLE_CHECKOUT_GATE',
    '--output', 'unused.json',
  ], {}, gateConfig());
  assert.equal(enable.action, 'enable');
  assert.equal(enable.releaseMode, 'focused-baseline');

  assert.throws(
    () => gateApi.cliConfiguration([
      'disable', '--release-mode', 'focused-baseline', '--output', 'unused.json',
    ], {}, gateConfig()),
    /disable requires --confirm DISABLE_CHECKOUT_GATE/,
  );
  const disable = gateApi.cliConfiguration([
    'disable', '--release-mode', 'focused-baseline', '--confirm', 'DISABLE_CHECKOUT_GATE',
    '--output', 'unused.json',
  ], {}, gateConfig());
  assert.equal(disable.action, 'disable');
  assert.equal(disable.releaseMode, 'focused-baseline');

  assert.equal(gateApi.cliConfiguration(
    ['verify', '--output', 'unused.json'], {}, gateConfig()
  ).releaseMode, 'release');
  assert.throws(
    () => gateApi.cliConfiguration(
      ['verify', '--release-mode', 'other', '--output', 'unused.json'],
      {},
      gateConfig()
    ),
    /Unsupported checkout gate release mode/
  );
});

test('focused-baseline public verifier checks both routes on HTTP and HTTPS', () => {
  const active = runGateVerifierFixture({ releaseMode: 'focused-baseline' });
  assert.match(active, /Release surface 1/);
  assert.match(active, /Release surface 2/);
  for (const pathName of [
    '/api/orders/initiate',
    '/api/orders/initiate/',
    '/API/ORDERS/INITIATE',
    '/Api/Orders/Initiate/',
    '/api/payments/create-payment-intent',
    '/api/payments/create-payment-intent/',
    '/API/PAYMENTS/CREATE-PAYMENT-INTENT',
    '/Api/Payments/Create-Payment-Intent/',
  ]) {
    assert.equal(active.split('POST ' + pathName + ': HTTP 503').length - 1, 2, pathName);
  }
  assert.equal(active.split('GET /api/health: HTTP 200').length - 1, 2);
  assert.equal(active.split('POST /api/webhooks/stripe (invalid signature): HTTP 400').length - 1, 2);

  assert.throws(
    () => runGateVerifierFixture({ releaseMode: 'focused-baseline', legacyStatus: 401 }),
    (error) => error.status === 1 && /expected infrastructure maintenance HTTP 503/
      .test(String(error.stderr))
  );
  assert.throws(
    () => runGateVerifierFixture({ releaseMode: 'focused-baseline', webhookStatus: 503 }),
    (error) => error.status === 1 && /maintenance gate also blocks/
      .test(String(error.stderr))
  );

  const inactive = runGateVerifierFixture({
    releaseMode: 'focused-baseline',
    state: 'inactive',
    orderStatus: 401,
    legacyStatus: 401,
  });
  assert.equal(inactive.split('POST /api/payments/create-payment-intent: HTTP 401').length - 1, 2);

  const normal = runGateVerifierFixture({ legacyStatus: 404 });
  assert.doesNotMatch(normal, /create-payment-intent/);
  assert.throws(
    () => runGateVerifierFixture({ releaseMode: 'unsupported' }),
    (error) => error.status === 2 && /--release-mode must be release or focused-baseline/
      .test(String(error.stderr))
  );
});

test('gate verifier binds inherited release mode and rejects flag/environment disagreement', () => {
  const focusedFromEnvironment = runGateVerifierFixture({ inheritedReleaseMode: 'focused-baseline' });
  assert.equal(focusedFromEnvironment.split('POST /api/payments/create-payment-intent: HTTP 503').length - 1, 2);

  const matchingFocused = runGateVerifierFixture({
    releaseMode: 'focused-baseline',
    inheritedReleaseMode: 'focused-baseline',
  });
  assert.equal(matchingFocused.split('POST /api/payments/create-payment-intent: HTTP 503').length - 1, 2);

  for (const [releaseMode, inheritedReleaseMode] of [
    ['release', 'focused-baseline'],
    ['focused-baseline', 'release'],
  ]) {
    assert.throws(
      () => runGateVerifierFixture({ releaseMode, inheritedReleaseMode }),
      (error) => error.status === 2
        && /--release-mode disagrees with inherited RELEASE_MODE/.test(String(error.stderr)),
    );
  }

  for (const options of [
    { inheritedReleaseMode: 'release' },
    {},
    { inheritedReleaseMode: 'rollback' },
  ]) {
    const canonicalOnly = runGateVerifierFixture(options);
    assert.equal(canonicalOnly.split('POST /api/orders/initiate: HTTP 503').length - 1, 2);
    assert.doesNotMatch(canonicalOnly, /create-payment-intent/);
  }
  assert.throws(
    () => runGateVerifierFixture({ releaseMode: 'rollback', inheritedReleaseMode: 'rollback' }),
    (error) => error.status === 2
      && /--release-mode must be release or focused-baseline/.test(String(error.stderr)),
  );
  assert.throws(
    () => runGateVerifierFixture({ inheritedReleaseMode: '' }),
    (error) => error.status === 2
      && /--release-mode must be release or focused-baseline/.test(String(error.stderr)),
  );
  assert.throws(
    () => runGateVerifierFixture({ releaseMode: '', inheritedReleaseMode: 'focused-baseline' }),
    (error) => error.status === 2
      && /--release-mode disagrees with inherited RELEASE_MODE/.test(String(error.stderr)),
  );
});

test('gate verifier rejects duplicate release mode flags before any HTTP verification', () => {
  for (const releaseModeFlags of [
    ['focused-baseline', 'release'],
    ['release', 'focused-baseline'],
    ['focused-baseline', 'focused-baseline'],
    ['release', 'release'],
  ]) {
    for (const inheritedReleaseMode of [undefined, 'focused-baseline', 'release']) {
      assert.throws(
        () => runGateVerifierFixture({ releaseModeFlags, inheritedReleaseMode }),
        (error) => {
          assert.equal(error.status, 2);
          assert.match(String(error.stderr), /Duplicate option: --release-mode/);
          assert.equal(error.httpCalls, 0);
          return true;
        },
        `flags ${releaseModeFlags.join(' then ')}, inherited ${inheritedReleaseMode}`,
      );
    }
  }
  assert.throws(
    () => runGateVerifierFixture({
      releaseMode: 'focused-baseline',
      trailingReleaseMode: 'release',
    }),
    (error) => {
      assert.equal(error.status, 2);
      assert.match(String(error.stderr), /Duplicate option: --release-mode/);
      assert.equal(error.httpCalls, 0);
      return true;
    },
    'duplicate mode flag after first valid BASE_URL',
  );
});

test('gate verifier preserves single mode flag and no-flag route coverage', () => {
  for (const options of [
    { releaseMode: 'focused-baseline', inheritedReleaseMode: 'focused-baseline' },
    { releaseMode: 'focused-baseline' },
    { inheritedReleaseMode: 'focused-baseline' },
  ]) {
    const focused = runGateVerifierFixture(options);
    assert.equal(focused.split('POST /api/orders/initiate: HTTP 503').length - 1, 2);
    assert.equal(focused.split('POST /api/payments/create-payment-intent: HTTP 503').length - 1, 2);
  }
  for (const options of [
    { releaseMode: 'release', inheritedReleaseMode: 'release' },
    { inheritedReleaseMode: 'release' },
    {},
    { inheritedReleaseMode: 'rollback' },
  ]) {
    const canonical = runGateVerifierFixture(options);
    assert.equal(canonical.split('POST /api/orders/initiate: HTTP 503').length - 1, 2);
    assert.doesNotMatch(canonical, /create-payment-intent/);
  }
  assert.throws(
    () => runGateVerifierFixture({ releaseMode: 'release', inheritedReleaseMode: 'focused-baseline' }),
    (error) => error.status === 2
      && /--release-mode disagrees with inherited RELEASE_MODE/.test(String(error.stderr)),
  );
});

test('gate transition failure best-effort restores both rules active', () => {
  const fixture = gateFixture(gateApi.ACTIVE_PATH);
  fixture.failOnModifyCall = 2;
  const client = gateApi.createFixtureGateClient(fixture);

  assert.throws(
    () => gateApi.transitionGate(client, 'inactive', gateConfig()),
    (error) => error.gateState === 'active' && /fail-safe recovery/.test(error.message)
  );
  assert.equal(gateApi.inspectGate(client.read(), gateConfig()).state, 'active');
});

test('mixed listener state is recoverable only toward active', () => {
  const mixedFixture = () => {
    const fixture = gateFixture();
    fixture.rulesByListener[HTTPS_LISTENER_ARN].Rules[0].Conditions =
      gateApi.gateConditions(gateApi.ACTIVE_PATH);
    return fixture;
  };

  const enablingClient = gateApi.createFixtureGateClient(mixedFixture());
  const enabled = gateApi.transitionGate(enablingClient, 'active', gateConfig());
  assert.equal(enabled.gateState, 'active');
  assert.equal(gateApi.inspectGate(enablingClient.read(), gateConfig()).state, 'active');

  const verifyingClient = gateApi.createFixtureGateClient(mixedFixture());
  assert.throws(() => gateApi.verifyGate(verifyingClient, 'active', gateConfig()), /mixed state/);

  const disablingClient = gateApi.createFixtureGateClient(mixedFixture());
  assert.throws(
    () => gateApi.transitionGate(disablingClient, 'inactive', gateConfig()),
    (error) => error.gateState === 'active' && /Refused to disable a mixed/.test(error.message)
  );
  assert.equal(gateApi.inspectGate(disablingClient.read(), gateConfig()).state, 'active');
});

test('gate rejects wildcard scope, altered action, missing tag, and cross-ALB ARN pins', () => {
  const wildcard = gateFixture();
  wildcard.rulesByListener[HTTP_LISTENER_ARN].Rules[0].Conditions = [
    gateApi.gateConditions(gateApi.DEFAULT_DISABLED_PATH)[0],
    { Field: 'path-pattern', PathPatternConfig: { Values: ['/api/orders/*'] } },
  ];
  assert.throws(() => gateApi.inspectGate(wildcard, gateConfig()), /path condition/);

  const alteredAction = gateFixture();
  alteredAction.rulesByListener[HTTP_LISTENER_ARN].Rules[0].Actions = [
    { Type: 'fixed-response', FixedResponseConfig: { StatusCode: '200' } },
  ];
  assert.throws(() => gateApi.inspectGate(alteredAction, gateConfig()), /fixed HTTP 503/);

  const missingTag = gateFixture();
  missingTag.tags.TagDescriptions[0].Tags = [];
  assert.throws(() => gateApi.inspectGate(missingTag, gateConfig()), /ownership tag/);

  const crossAlb = gateConfig();
  crossAlb.httpsRuleArn =
    `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener-rule/app/other/def456/https/rule`;
  assert.throws(() => gateApi.validatePinnedArnSet(crossAlb), /share one AWS identity/);

  const laterPriority = gateFixture();
  laterPriority.rulesByListener[HTTP_LISTENER_ARN].Rules[0].Priority = '2';
  laterPriority.rulesByListener[HTTPS_LISTENER_ARN].Rules[0].Priority = '2';
  assert.throws(
    () => gateApi.inspectGate(laterPriority, { ...gateConfig(), httpPriority: '2', httpsPriority: '2' }),
    /priority 1/
  );
});

test('SSM check pins one custom document and exact online EB instance, then returns count only', async () => {
  const fixture = ssmFixture(0);
  const calls = [];
  const fixtureRunner = ssmApi.createFixtureRunner(fixture);
  const runAws = (service, operation, args) => {
    calls.push({ service, operation, args });
    return fixtureRunner(service, operation, args);
  };
  const result = await ssmApi.executeReservationCheck({
    runAws,
    wait: async () => {},
    config: ssmConfig(),
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.activeReservationCount, 0);
  assert.equal(result.incompletePaidOrderCount, 0);
  assert.equal(result.unresolvedPaymentIntentCount, 0);
  assert.equal(result.readOnly, true);
  assert.equal(result.productionMutation, false);
  assert.doesNotMatch(JSON.stringify(result), /arn:aws|CommandId|StandardOutput|StandardError/);

  const send = calls.find((call) => call.service === 'ssm' && call.operation === 'send-command');
  assert.ok(send.args.includes(ssmApi.DOCUMENT_NAME));
  assert.ok(send.args.includes(DOCUMENT_HASH));
  assert.ok(send.args.includes(INSTANCE_ID));
  assert.equal(send.args.includes('--parameters'), false);
});

test('SSM nonzero, extra output fields, wrong document hash, and target mismatch fail closed', async () => {
  await assert.rejects(
    ssmApi.executeReservationCheck({
      runAws: ssmApi.createFixtureRunner(ssmFixture(2)),
      wait: async () => {},
      config: ssmConfig(),
    }),
    (error) => error.activeReservationCount === 2 && error.evidence.status === 'blocked'
  );
  await assert.rejects(
    ssmApi.executeReservationCheck({
      runAws: ssmApi.createFixtureRunner(ssmFixture(0, 0, 1)),
      wait: async () => {},
      config: ssmConfig(),
    }),
    (error) => error.unresolvedPaymentIntentCount === 1 && error.evidence.status === 'blocked'
  );
  assert.throws(
    () => ssmApi.parseCountOnlyOutput('{"activeReservationCount":0,"orders":[]}'),
    /count-only schema/
  );

  const wrongHash = ssmFixture();
  wrongHash.document.Document.Hash = 'c'.repeat(64);
  await assert.rejects(
    ssmApi.executeReservationCheck({
      runAws: ssmApi.createFixtureRunner(wrongHash),
      wait: async () => {},
      config: ssmConfig(),
    }),
    /document identity/
  );

  const wrongTarget = ssmFixture();
  wrongTarget.instanceInformation.InstanceInformationList[0].InstanceId =
    'i-00000000deadbeef';
  await assert.rejects(
    ssmApi.executeReservationCheck({
      runAws: ssmApi.createFixtureRunner(wrongTarget),
      wait: async () => {},
      config: ssmConfig(),
    }),
    /exact Elastic Beanstalk instance/
  );
});

test('count-json uses only countDocuments and emits exactly one count field', async () => {
  const calls = [];
  const OrderModel = new Proxy({
    countDocuments(filter) {
      calls.push(['countDocuments', filter]);
      return {
        async exec() {
          calls.push(['exec']);
          return 0;
        },
      };
    },
  }, {
    get(target, property) {
      if (!(property in target)) throw new Error(`Unexpected model operation: ${String(property)}`);
      return target[property];
    },
  });
  const lines = [];
  let disconnected = false;
  const count = await reservationApi.run({
    mode: '--count-json',
    mongoose: {
      async connect() {},
      async disconnect() { disconnected = true; },
    },
    OrderModel,
    mongoUri: 'mongodb://read-only.example.invalid/mosaic',
    logger: { log(value) { lines.push(value); } },
  });

  assert.equal(reservationApi.parseMode(['--count-json']), '--count-json');
  assert.equal(count, 0);
  assert.equal(disconnected, true);
  assert.deepEqual(calls, [
    ['countDocuments', reservationApi.ACTIVE_RESERVATION_FILTER],
    ['exec'],
  ]);
  assert.deepEqual(JSON.parse(lines[0]), { activeReservationCount: 0 });
  assert.equal(lines.length, 1);
});

test('pinned reservation tool emits only the three release-blocking counts', async () => {
  const calls = [];
  class FakeMongoClient {
    constructor(uri, options) {
      calls.push(['constructor', uri, options]);
    }
    async connect() { calls.push(['connect']); }
    db() {
      return {
        collection(name) {
          assert.equal(name, 'orders');
          return new Proxy({
            aggregate(pipeline, options) {
              calls.push(['aggregate', pipeline, options]);
              return {
                async toArray() {
                  calls.push(['toArray']);
                  return [{
                    activeReservationCount: 0,
                    incompletePaidOrderCount: 0,
                    unresolvedPaymentIntentCount: 0,
                  }];
                },
              };
            },
          }, {
            get(target, property) {
              if (!(property in target)) throw new Error(`Unexpected database operation: ${String(property)}`);
              return target[property];
            },
          });
        },
      };
    }
    async close() { calls.push(['close']); }
  }

  const counts = await trustedReservationTool.countReleaseBlockers({
    uri: 'mongodb://trusted.example.invalid/mosaic',
    MongoClientClass: FakeMongoClient,
  });
  assert.deepEqual(counts, {
    activeReservationCount: 0,
    incompletePaidOrderCount: 0,
    unresolvedPaymentIntentCount: 0,
  });
  const aggregate = calls.find((entry) => entry[0] === 'aggregate');
  assert.deepEqual(aggregate[1], trustedReservationTool.RELEASE_BLOCKER_PIPELINE);
  assert.deepEqual(aggregate[2], {
    maxTimeMS: 10000,
    allowDiskUse: false,
    readConcern: { level: 'majority' },
  });
  assert.equal(calls.some((entry) => entry[0] === 'countDocuments'), false);
  assert.ok(calls.some((entry) => entry[0] === 'close'));

  const documentSource = fs.readFileSync(path.join(
    __dirname,
    '../../infrastructure/release-control/MosaicReadOnlyReservationCheck.json'
  ), 'utf8');
  assert.match(documentSource, /\/opt\/mosaic-release-control\/reservation-check\.cjs/);
  assert.match(documentSource, /__PINNED_RESERVATION_TOOL_SHA256__/);
  assert.match(documentSource, /__PINNED_SYSTEM_NODE_SHA256__/);
  assert.match(documentSource, /__PINNED_SYSTEM_NODE_REALPATH__/);
  assert.match(documentSource, /__PINNED_GET_CONFIG_SHA256__/);
  assert.match(documentSource, /root:root/);
  assert.match(documentSource, /8#\$mode & 022/);
  assert.doesNotMatch(documentSource, /\/var\/app\/current|scripts\/release\/query-active-reservations/);
});

const preflightProofWorkflowPath = path.join(
  __dirname,
  '../../.github/workflows/prove-production-preflight-oidc.yml'
);

function preflightProofSource() {
  return fs.readFileSync(preflightProofWorkflowPath, 'utf8');
}

const releaseControlProofWorkflowPath = path.join(
  __dirname,
  '../../.github/workflows/prove-production-release-control-oidc.yml'
);

function releaseControlProofSource() {
  return fs.readFileSync(releaseControlProofWorkflowPath, 'utf8');
}

const focusedCheckoutGateWorkflowPath = path.join(
  __dirname,
  '../../.github/workflows/focused-checkout-gate.yml'
);

function focusedCheckoutGateWorkflowSource() {
  return fs.readFileSync(focusedCheckoutGateWorkflowPath, 'utf8');
}

const approvedProofReads = [
  ['elasticbeanstalk', 'describe-environments', 'DescribeEnvironments', 'environments'],
  ['elasticbeanstalk', 'describe-configuration-settings', 'DescribeConfigurationSettings', 'configuration'],
  ['elasticbeanstalk', 'describe-environment-resources', 'DescribeEnvironmentResources', 'resources'],
  ['elasticbeanstalk', 'describe-instances-health', 'DescribeInstancesHealth', 'instanceHealth'],
  ['autoscaling', 'describe-auto-scaling-groups', 'DescribeAutoScalingGroups', 'autoScaling'],
  ['elbv2', 'describe-load-balancers', 'DescribeLoadBalancers', 'loadBalancers'],
  ['elbv2', 'describe-listeners', 'DescribeListeners', 'listeners'],
  ['elbv2', 'describe-target-groups', 'DescribeTargetGroups', 'targetGroups'],
  ['elbv2', 'describe-target-health', 'DescribeTargetHealth', 'targetHealthByGroup'],
  ['elbv2', 'describe-load-balancer-attributes', 'DescribeLoadBalancerAttributes', 'loadBalancerAttributes'],
];

function runFocusedPreflightFixture({
  failOperation,
  awsError,
  awsFailures = {},
  awsResultOverrides = {},
  mutateFixture = () => {},
  mutateResponses = () => {},
} = {}) {
  const fixture = topologyFixture();
  mutateFixture(fixture);
  const responses = Object.fromEntries(approvedProofReads.map(([service, operation, , fixtureKey]) => [
    `${service}:${operation}`,
    fixtureKey === 'targetHealthByGroup' ? fixture.targetHealthByGroup[TARGET_GROUP_ARN] : fixture[fixtureKey],
  ]));
  responses['elasticbeanstalk:describe-configuration-settings'] =
    fixture.configuration.ConfigurationSettings;
  mutateResponses(responses);
  const awsCalls = [];
  const messages = [];
  const writes = [];
  const fakeSpawn = (binary, args) => {
    assert.equal(binary, 'aws');
    const operation = `${args[0]}:${args[1]}`;
    awsCalls.push(operation);
    assert.ok(Object.hasOwn(responses, operation), 'only approved read operations reach AWS CLI');
    if (operation === 'elasticbeanstalk:describe-configuration-settings') {
      assert.ok(args.includes('--query'), 'EB configuration must remain filtered');
    }
    if (Object.hasOwn(awsResultOverrides, operation)) return awsResultOverrides[operation];
    if (operation === failOperation || Object.hasOwn(awsFailures, operation)) {
      return { status: 255, stderr: awsFailures[operation] || awsError, stdout: '' };
    }
    return { status: 0, stderr: '', stdout: JSON.stringify(responses[operation]) };
  };
  let result;
  let error;
  try {
    result = focusedPreflightApi.main([
      '--mode', 'focused-baseline', '--release-sha', SHA, '--output', 'unused.json',
    ], {
      env: {
        AWS_REGION: REGION,
        EB_APPLICATION_NAME: APPLICATION,
        EB_ENVIRONMENT_NAME: ENVIRONMENT,
      },
      spawn: fakeSpawn,
      writeJson: (filePath, value) => writes.push({ filePath, value }),
      log: (message) => messages.push(String(message)),
      clock: () => new Date('2026-08-13T00:00:00.000Z'),
    });
  } catch (caught) {
    error = caught;
  }
  return { awsCalls, messages, writes, result, error };
}

test('focused baseline adapter attempts health once, warns only on live AccessDenied, and validates every remaining read', () => {
  const operations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const healthOperation = 'elasticbeanstalk:describe-instances-health';
  const warning = runFocusedPreflightFixture({
    failOperation: healthOperation,
    awsError: `An error occurred (AccessDeniedException) for ${LOAD_BALANCER_ARN} ${INSTANCE_ID}`,
  });
  assert.equal(warning.error, undefined);
  assert.deepEqual(warning.awsCalls, operations);
  assert.equal(warning.awsCalls.filter((operation) => operation === healthOperation).length, 1);
  assert.ok(warning.messages.includes('WARN: DescribeInstancesHealth'));
  assert.ok(warning.messages.includes('WARN CLASS: AccessDenied'));
  assert.equal(warning.writes.length, 1);
  assert.equal(warning.writes[0].value.status, 'passed');
  assert.equal(warning.writes[0].value.instanceHealthVerified, false);
  assert.equal(warning.writes[0].value.instances, null);
  assert.equal(warning.writes[0].value.loadBalancer.healthyTargetCount, 1);
  assert.doesNotMatch(
    JSON.stringify({ messages: warning.messages, evidence: warning.writes[0].value }),
    /arn:aws|123456789012|i-000000001234abcd|AccessDeniedException|An error occurred/
  );

  const healthy = runFocusedPreflightFixture();
  assert.equal(healthy.error, undefined);
  assert.deepEqual(healthy.awsCalls, operations);
  assert.equal(healthy.writes[0].value.status, 'passed');
  assert.equal(Object.hasOwn(healthy.writes[0].value, 'instanceHealthVerified'), false);
  assert.equal(healthy.writes[0].value.instances.length, 1);
  assert.equal(healthy.messages.some((message) => message.startsWith('WARN:')), false);

  const plainDenied = runFocusedPreflightFixture({
    failOperation: healthOperation,
    awsError: 'An error occurred (AccessDenied)',
  });
  assert.equal(plainDenied.error, undefined);
  assert.ok(plainDenied.messages.includes('WARN CLASS: AccessDenied'));
  assert.equal(plainDenied.writes[0].value.instanceHealthVerified, false);
});

test('focused baseline adapter keeps other health failures and all other AWS reads fatal', () => {
  const operations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const healthIndex = operations.indexOf('elasticbeanstalk:describe-instances-health');
  const healthFailures = [
    { status: 255, stderr: 'An error occurred (ResourceNotFoundException)', stdout: '' },
    { status: 255, stderr: 'An error occurred (ValidationError)', stdout: '' },
    { status: 255, stderr: 'An error occurred (ValidationError) while not authorized', stdout: '' },
    { status: 255, stderr: 'An error occurred (ThrottlingException)', stdout: '' },
    { status: null, error: new Error('spawn failed'), stderr: 'An error occurred (AccessDeniedException)', stdout: '' },
    { status: 0, stderr: 'An error occurred (AccessDeniedException)', stdout: '{malformed json' },
  ];
  for (const cliResult of healthFailures) {
    const failure = runFocusedPreflightFixture({
      awsResultOverrides: { 'elasticbeanstalk:describe-instances-health': cliResult },
    });
    assert.ok(failure.error);
    assert.deepEqual(failure.awsCalls, operations.slice(0, healthIndex + 1));
    assert.equal(failure.messages.includes('WARN: DescribeInstancesHealth'), false);
    assert.equal(failure.writes.some(({ value }) => value.status === 'passed'), false);
  }

  for (let index = 0; index < operations.length; index += 1) {
    if (index === healthIndex) continue;
    const failure = runFocusedPreflightFixture({
      failOperation: operations[index],
      awsError: 'An error occurred (AccessDeniedException)',
    });
    assert.ok(failure.error, `${operations[index]} must remain fatal`);
    assert.deepEqual(failure.awsCalls, operations.slice(0, index + 1));
    assert.equal(failure.messages.includes('WARN: DescribeInstancesHealth'), false);
    assert.equal(failure.writes.some(({ value }) => value.status === 'passed'), false);
  }

  const afterWarning = runFocusedPreflightFixture({
    awsFailures: {
      'elasticbeanstalk:describe-instances-health': 'An error occurred (AccessDeniedException)',
      'elbv2:describe-target-health': 'An error occurred (ValidationError)',
    },
  });
  assert.ok(afterWarning.error);
  assert.ok(afterWarning.messages.includes('WARN: DescribeInstancesHealth'));
  assert.deepEqual(afterWarning.awsCalls, operations.slice(0, operations.indexOf('elbv2:describe-target-health') + 1));
  assert.equal(afterWarning.writes.some(({ value }) => value.status === 'passed'), false);
});

test('focused baseline adapter rejects non-focused mode before AWS access', () => {
  for (const mode of ['release', 'rollback', '']) {
    const calls = [];
    assert.throws(() => focusedPreflightApi.main([
      '--mode', mode, '--release-sha', SHA, '--output', 'unused.json',
    ], {
      env: { AWS_REGION: REGION, EB_APPLICATION_NAME: APPLICATION, EB_ENVIRONMENT_NAME: ENVIRONMENT },
      spawn: (...args) => calls.push(args),
      writeJson: () => {},
      log: () => {},
    }));
    assert.deepEqual(calls, []);
  }
});

test('focused baseline adapter rejects malformed configuration and unsafe returned topology', () => {
  const invalidCases = [
    { mutateResponses: (responses) => { responses['elasticbeanstalk:describe-configuration-settings'] = []; } },
    { mutateResponses: (responses) => { responses['elasticbeanstalk:describe-configuration-settings'] = {}; } },
    { mutateFixture: (fixture) => { fixture.instanceHealth.InstanceHealthList[0].Color = 'Red'; } },
    { mutateFixture: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances[0].HealthStatus = 'Unhealthy'; } },
    { mutateFixture: (fixture) => { fixture.targetHealthByGroup[TARGET_GROUP_ARN].TargetHealthDescriptions[0].TargetHealth.State = 'unhealthy'; } },
    { mutateFixture: (fixture) => { fixture.listeners.Listeners.pop(); } },
  ];
  for (const invalidCase of invalidCases) {
    const failure = runFocusedPreflightFixture(invalidCase);
    assert.ok(failure.error);
    assert.equal(failure.writes.some(({ value }) => value.status === 'passed'), false);
  }

  const invalidAfterWarning = runFocusedPreflightFixture({
    failOperation: 'elasticbeanstalk:describe-instances-health',
    awsError: 'An error occurred (AccessDeniedException)',
    mutateFixture: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances[0].HealthStatus = 'Unhealthy'; },
  });
  assert.ok(invalidAfterWarning.error);
  assert.ok(invalidAfterWarning.messages.includes('WARN: DescribeInstancesHealth'));
  assert.equal(invalidAfterWarning.writes.some(({ value }) => value.status === 'passed'), false);
});

test('focused baseline validator failures emit fixed predicate codes and remain fatal', () => {
  const cases = [
    {
      code: 'ENVIRONMENT_HEALTH',
      mutate: (fixture) => { fixture.environments.Environments[0].Health = 'Red'; },
    },
    {
      code: 'ASG_INSTANCE_INVENTORY',
      mutate: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances[0].InstanceId = 'i-foreign'; },
    },
    {
      code: 'ASG_INSTANCE_HEALTH',
      mutate: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances[0].HealthStatus = 'Unhealthy'; },
    },
    {
      code: 'SAFE_CUTOVER_TOPOLOGY',
      mutate: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].MaxSize = 2; },
    },
    {
      code: 'LISTENER_COUNT',
      mutate: (fixture) => { fixture.listeners.Listeners.pop(); },
    },
    {
      code: 'LISTENER_PROTOCOL',
      mutate: (fixture) => { fixture.listeners.Listeners[0].Protocol = 'HTTPS'; },
    },
    {
      code: 'TARGET_INVENTORY',
      mutate: (fixture) => {
        fixture.targetHealthByGroup[TARGET_GROUP_ARN].TargetHealthDescriptions[0].Target.Id = 'i-foreign';
      },
    },
    {
      code: 'TARGET_HEALTH',
      mutate: (fixture) => {
        fixture.targetHealthByGroup[TARGET_GROUP_ARN].TargetHealthDescriptions[0].TargetHealth.State = 'unhealthy';
      },
    },
    {
      code: 'LOAD_BALANCER_IDLE_TIMEOUT',
      mutate: (fixture) => { fixture.loadBalancerAttributes.Attributes[0].Value = 'not-a-number'; },
    },
  ];

  for (const { code, mutate } of cases) {
    const failure = runFocusedPreflightFixture({ mutateFixture: mutate });
    assert.ok(failure.error, `${code} must fail`);
    assert.deepEqual(failure.messages.slice(-2), [
      'FAIL: topology validation',
      `VALIDATION PREDICATE: ${code}`,
    ]);
    assert.equal(failure.writes.length, 1);
    assert.equal(failure.writes[0].value.status, 'failed');
    assert.equal(failure.writes.some(({ value }) => value.status === 'passed'), false);
  }
});

test('focused validator diagnostics never expose identifier-bearing or unknown errors', () => {
  const instanceFailure = runFocusedPreflightFixture({
    mutateFixture: (fixture) => { fixture.instanceHealth.InstanceHealthList[0].Color = 'Red'; },
  });
  assert.ok(instanceFailure.error);
  assert.deepEqual(instanceFailure.messages.slice(-2), [
    'FAIL: topology validation',
    'VALIDATION PREDICATE: HEALTH_INSTANCE_HEALTH',
  ]);
  assert.doesNotMatch(
    JSON.stringify({ messages: instanceFailure.messages, writes: instanceFailure.writes, error: instanceFailure.error.message }),
    /arn:aws|123456789012|i-000000001234abcd|1234abcd|not Green\/Ok/
  );

  const unknown = runFocusedPreflightFixture({
    mutateFixture: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances = [null]; },
  });
  assert.ok(unknown.error);
  assert.deepEqual(unknown.messages.slice(-2), [
    'FAIL: topology validation',
    'VALIDATION PREDICATE: UNKNOWN',
  ]);
  assert.equal(unknown.writes.length, 1);
  assert.equal(unknown.writes[0].value.status, 'failed');
  assert.doesNotMatch(
    JSON.stringify({ messages: unknown.messages, writes: unknown.writes, error: unknown.error.message }),
    /Cannot read properties|TypeError|arn:aws|123456789012|i-000000001234abcd/
  );
});

test('successful focused validation emits no predicate and health AccessDenied warning remains bounded', () => {
  const healthy = runFocusedPreflightFixture();
  assert.equal(healthy.error, undefined);
  assert.equal(healthy.messages.some((message) => message.startsWith('VALIDATION PREDICATE:')), false);

  const warning = runFocusedPreflightFixture({
    failOperation: 'elasticbeanstalk:describe-instances-health',
    awsError: 'An error occurred (AccessDeniedException)',
  });
  assert.equal(warning.error, undefined);
  assert.ok(warning.messages.includes('WARN: DescribeInstancesHealth'));
  assert.ok(warning.messages.includes('WARN CLASS: AccessDenied'));
  assert.equal(warning.messages.some((message) => message.startsWith('VALIDATION PREDICATE:')), false);
  assert.equal(warning.writes[0].value.instanceHealthVerified, false);
  assert.equal(warning.writes[0].value.instances, null);

  const fatalHealth = runFocusedPreflightFixture({
    failOperation: 'elasticbeanstalk:describe-instances-health',
    awsError: 'An error occurred (ValidationError)',
  });
  assert.ok(fatalHealth.error);
  assert.equal(fatalHealth.messages.includes('WARN: DescribeInstancesHealth'), false);
  assert.equal(fatalHealth.messages.some((message) => message.startsWith('VALIDATION PREDICATE:')), false);
  assert.equal(fatalHealth.writes.some(({ value }) => value.status === 'passed'), false);
});

test('production workflow limits the health adapter to focused AWS preflight and preserves production mutation block', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../.github/workflows/deploy-eb-production.yml'), 'utf8');
  const preflight = source.slice(source.indexOf('  aws-preflight:'), source.indexOf('  release-readiness:'));
  const release = source.slice(source.indexOf('  production-approval-and-release:'));
  assert.ok(preflight.includes('run-focused-baseline-preflight.js'));
  assert.ok(preflight.includes('aws-release-topology.js preflight'));
  assert.match(preflight, /RELEASE_MODE:\s*\$\{\{\s*needs\.resolve-release\.outputs\.release_mode\s*\}\}/);
  assert.match(preflight, /\$RELEASE_MODE[^\n]*focused-baseline|focused-baseline[^\n]*\$RELEASE_MODE/);
  assert.match(release, /needs\.resolve-release\.outputs\.release_mode != 'focused-baseline'/);
  assert.match(release, /aws-release-topology\.js preflight/);
  assert.match(release, /aws-release-topology\.js verify/);
  assert.doesNotMatch(release, /run-focused-baseline-preflight\.js/);
  assert.doesNotMatch(preflight, /\b(?:put-role-policy|attach-role-policy|create-bucket|send-command|update-environment)\b/i);
});

function embeddedPreflightProofNode() {
  const match = preflightProofSource().match(/^ {10}node 2>\/dev\/null <<'NODE'\r?\n([\s\S]*?)^ {10}NODE\s*$/m);
  assert.ok(match, 'proof workflow must contain its isolated Node script');
  return match[1].replace(/^ {10}/gm, '');
}

function runEmbeddedPreflightProof({
  failOperation,
  awsError,
  awsFailures = {},
  awsResultOverrides = {},
  mutateFixture = () => {},
  mutateResponses = () => {},
  unapprovedOperation = false,
} = {}) {
  const fixture = topologyFixture();
  mutateFixture(fixture);
  const responses = Object.fromEntries(approvedProofReads.map(([service, operation, , fixtureKey]) => [
    `${service}:${operation}`,
    fixtureKey === 'targetHealthByGroup' ? fixture.targetHealthByGroup[TARGET_GROUP_ARN] : fixture[fixtureKey],
  ]));
  // The collector's --query projects ConfigurationSettings to a bare array.
  responses['elasticbeanstalk:describe-configuration-settings'] = fixture.configuration.ConfigurationSettings;
  mutateResponses(responses);
  const awsCalls = [];
  const messages = [];
  let validated = false;
  let validatedPayload;
  let validatedOptions;
  let validationResult;
  const fakeSpawn = (binary, args) => {
    assert.equal(binary, 'aws');
    const operation = `${args[0]}:${args[1]}`;
    awsCalls.push(operation);
    assert.ok(Object.hasOwn(responses, operation), 'only approved read operations reach AWS CLI');
    if (operation === 'elasticbeanstalk:describe-configuration-settings') {
      assert.ok(args.includes('--query'), 'configuration response is filtered by the AWS CLI query');
    }
    if (Object.hasOwn(awsResultOverrides, operation)) return awsResultOverrides[operation];
    if (operation === failOperation || Object.hasOwn(awsFailures, operation)) {
      return { status: 255, stderr: awsFailures[operation] || awsError, stdout: '' };
    }
    return { status: 0, stderr: '', stdout: JSON.stringify(responses[operation]) };
  };
  const localProcess = {
    env: {
      AWS_REGION: REGION,
      EB_APPLICATION_NAME: APPLICATION,
      EB_ENVIRONMENT_NAME: ENVIRONMENT,
      GITHUB_SHA: SHA,
    },
  };
  const localRequire = (specifier) => {
    if (specifier === 'node:child_process') return { spawnSync: fakeSpawn };
    if (specifier === './scripts/release/release-control-utils') {
      return { createAwsCliRunner: require('../../scripts/release/release-control-utils').createAwsCliRunner };
    }
    if (specifier === './scripts/release/aws-release-topology') {
      return {
        collectAwsTopology: unapprovedOperation
          ? ({ runAws }) => runAws('unapproved', 'read-operation', [])
          : topologyApi.collectAwsTopology,
        validateTopology: (payload, options) => {
          validated = true;
          validatedPayload = payload;
          validatedOptions = options;
          validationResult = topologyApi.validateTopology(payload, options);
          return validationResult;
        },
      };
    }
    throw new Error('Unexpected module in isolated proof');
  };
  vm.runInNewContext(embeddedPreflightProofNode(), {
    require: localRequire,
    process: localProcess,
    console: { log: (...values) => messages.push(values.join(' ')) },
  }, { timeout: 1000 });
  return {
    awsCalls,
    messages,
    validated,
    validatedPayload,
    validatedOptions,
    validationResult,
    exitCode: localProcess.exitCode,
  };
}

test('isolated release-control OIDC proof is manual, main-only, and bound to its Environment', () => {
  const workflow = releaseControlProofSource();
  assert.match(workflow, /^name: Prove production-release-control OIDC$/m);
  const triggerBlock = workflow.match(/^on:\s*\r?\n([\s\S]*?)(?=^[^\s#])/m);
  assert.ok(triggerBlock, 'workflow must declare its own event block');
  assert.deepEqual(
    [...triggerBlock[1].matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]),
    ['workflow_dispatch']
  );
  assert.match(workflow, /^permissions:\s*\r?\n  contents: read\s*\r?\n  id-token: write\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(?:contents|pull-requests|deployments|actions|workflows): write\s*$/m);
  assert.deepEqual(
    [...workflow.matchAll(/^  ([a-z][a-z0-9_-]*):\s*$/gm)]
      .filter((match) => match.index > workflow.indexOf('\njobs:'))
      .map((match) => match[1]),
    ['prove-production-release-control-oidc']
  );
  assert.match(workflow, /^    timeout-minutes: 10\s*$/m);
  assert.match(workflow, /^    environment: production-release-control\s*$/m);
  const mainGuard = workflow.indexOf('- name: Require main ref');
  const proofStep = workflow.indexOf('- name: Prove release-control OIDC assumption');
  assert.ok(mainGuard >= 0 && proofStep > mainGuard, 'main guard must precede OIDC proof');
  assert.match(workflow.slice(mainGuard, proofStep), /\$\{GITHUB_REF:-\}[^\n]*refs\/heads\/main[\s\S]*?exit 1/);
  assert.match(workflow, /ROLE_TO_ASSUME: \$\{\{ vars\.AWS_RELEASE_CONTROL_ROLE_TO_ASSUME \}\}/);
  assert.doesNotMatch(workflow, /secrets\.AWS_RELEASE_CONTROL_ROLE_TO_ASSUME|actions\/checkout@|actions\/upload-artifact@/);
});

test('isolated release-control proof exercises only STS and emits identifier-free evidence', () => {
  const workflow = releaseControlProofSource();
  const awsCalls = [...workflow.matchAll(/\baws\s+([a-z0-9-]+)\s+([a-z0-9-]+)/g)]
    .map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(awsCalls, [
    'sts:assume-role-with-web-identity',
    'sts:get-caller-identity',
  ]);
  assert.match(workflow, /--data-urlencode 'audience=sts\.amazonaws\.com'/);
  assert.match(workflow, /--role-session-name "\$session_name"/);
  assert.match(workflow, /--duration-seconds 900/);
  assert.match(workflow, /caller_arn="\$\(aws sts get-caller-identity --query Arn --output text 2>\/dev\/null\)"/);
  assert.match(workflow, /assumed-role\/mosaic-production-release-control\/\$\{session_name\}/);
  assert.match(workflow, /set \+x/);
  assert.match(workflow, /PRODUCTION RELEASE-CONTROL OIDC VERIFIED/);
  assert.match(workflow, /AWS application permissions: NOT TESTED/);
  assert.match(workflow, /AWS mutation: NO/);
  assert.doesNotMatch(workflow, /(?:printf|echo|cat|tee)[^\n]*(?:\$\{?(?:ROLE_TO_ASSUME|oidc_token|credentials|caller_arn|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)\b|AccountId|AccessKeyId|SecretAccessKey)/);
  assert.doesNotMatch(workflow, /(?:printf|echo)[^\n]*(?:arn:aws|\$\{?expected_account\b)/);
  assert.doesNotMatch(workflow, /\b(?:gh\s+workflow\s+run|aws\s+(?:elbv2|elasticbeanstalk|s3|s3api|ssm|iam))\b/i);
  assert.doesNotMatch(workflow, /\.github\/workflows\/deploy-eb-production|workflow_run:|push:|pull_request:/);
});

test('focused checkout gate workflow is manual, main-only, and release-control scoped', () => {
  const workflow = focusedCheckoutGateWorkflowSource();
  assert.match(workflow, /^name: Focused checkout gate$/m);
  const triggerBlock = workflow.match(/^on:\s*\r?\n([\s\S]*?)(?=^[^\s#])/m);
  assert.ok(triggerBlock, 'workflow must declare its own event block');
  assert.deepEqual(
    [...triggerBlock[1].matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]),
    ['workflow_dispatch']
  );
  assert.doesNotMatch(workflow, /\b(?:push|pull_request|pull_request_target|workflow_run|repository_dispatch):/);
  assert.match(workflow, /^permissions:\s*\r?\n  contents: read\s*\r?\n  id-token: write\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(?:contents|pull-requests|deployments|actions|workflows): write\s*$/m);
  assert.match(workflow, /^    environment: production-release-control\s*$/m);
  assert.match(workflow, /^  RELEASE_MODE: focused-baseline\s*$/m);
  assert.doesNotMatch(workflow, /inputs:\s*[\s\S]*release[-_ ]mode|github\.event\.inputs|inputs\.release_mode/);

  const mainGuard = workflow.indexOf('- name: Require main ref');
  const checkout = workflow.indexOf('- name: Checkout current main');
  const controllerGuard = workflow.indexOf('- name: Reconfirm current main controller');
  const awsCredentials = workflow.indexOf('- name: Configure release-control AWS credentials');
  assert.ok(mainGuard >= 0 && checkout > mainGuard && controllerGuard > checkout && awsCredentials > controllerGuard);
  assert.match(workflow.slice(mainGuard, checkout), /\$\{GITHUB_REF:-\}[^\n]*refs\/heads\/main[\s\S]*?exit 1/);
  assert.match(workflow.slice(controllerGuard, awsCredentials), /git fetch --no-tags origin main/);
  assert.match(workflow.slice(controllerGuard, awsCredentials), /git rev-parse origin\/main/);
  assert.match(workflow.slice(controllerGuard, awsCredentials), /git rev-parse HEAD/);
  assert.match(workflow.slice(controllerGuard, awsCredentials), /WORKFLOW_SHA[^\n]*current_main|current_main[^\n]*WORKFLOW_SHA/);
});

test('focused checkout gate workflow uses only release-control OIDC and focused gate commands', () => {
  const workflow = focusedCheckoutGateWorkflowSource();
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /uses: aws-actions\/configure-aws-credentials@[0-9a-f]{40}/);
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.AWS_RELEASE_CONTROL_ROLE_TO_ASSUME \}\}/);
  assert.doesNotMatch(workflow, /secrets\.AWS_RELEASE_CONTROL_ROLE_TO_ASSUME|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|mosaic-admin/);

  assert.match(workflow, /manage-checkout-gate\.js enable\s*\\\s*\r?\n\s*--release-mode focused-baseline\s*\\\s*\r?\n\s*--confirm ENABLE_CHECKOUT_GATE/);
  assert.match(workflow, /manage-checkout-gate\.js verify\s*\\\s*\r?\n\s*--release-mode focused-baseline\s*\\\s*\r?\n\s*--expected-state active/);
  assert.match(workflow, /RELEASE_MODE=focused-baseline bash scripts\/release\/verify-checkout-gate\.sh\s*\\\s*\r?\n\s*--release-mode focused-baseline/);
  assert.match(workflow, /https?:\/\/api\.mosaicbizhub\.com/);
  assert.match(workflow, /\/api\/orders\/initiate/);
  assert.match(workflow, /\/api\/payments\/create-payment-intent/);
  assert.match(workflow, /expectedStatus": 503/);
});

test('focused checkout gate workflow leaves gate active, uploads evidence, and excludes reset or deploy', () => {
  const workflow = focusedCheckoutGateWorkflowSource();
  assert.match(workflow, /Reassert active checkout gate after verification failure/);
  assert.match(workflow, /steps\.enable\.outputs\.attempted == 'true'/);
  assert.match(workflow, /gate-failure-safe-active\.json/);
  assert.match(workflow, /checkoutGateFinalState: 'active'/);
  assert.match(workflow, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /focused-checkout-gate-summary\.json/);
  assert.match(workflow, /retention-days: 14/);

  assert.doesNotMatch(workflow, /DISABLE_CHECKOUT_GATE|manage-checkout-gate\.js disable|--expected-state inactive|ungate/i);
  assert.doesNotMatch(workflow, /reset-prelaunch-test-liabilities|RESET_PRELAUNCH_TEST_LIABILITIES|--apply|CHECKOUT_INITIATION_GATED/);
  assert.doesNotMatch(workflow, /deploy-eb-exact-sha|UpdateEnvironment|create-application-version|elasticbeanstalk.*update|aws ssm send-command|AWS-RunShellScript/i);
  assert.doesNotMatch(workflow, /\b(?:mongo|mongosh|stripe|paymentIntents\.cancel|releaseInventoryReservation|sendEmail)\b/i);
});

test('isolated production-preflight proof is manual, single-job, and read-only at GitHub', () => {
  const workflow = preflightProofSource();
  const triggerBlock = workflow.match(/^on:\s*\r?\n([\s\S]*?)(?=^[^\s#])/m);
  assert.ok(triggerBlock, 'workflow must declare its own event block');
  assert.match(triggerBlock[1], /^  workflow_dispatch:\s*(?:\{\})?\s*$/m);
  assert.equal(
    [...triggerBlock[1].matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]).join(','),
    'workflow_dispatch'
  );

  const jobNames = [...workflow.matchAll(/^  ([a-z][a-z0-9_-]*):\s*$/gm)]
    .filter((match) => match.index > workflow.indexOf('\njobs:'))
    .map((match) => match[1]);
  assert.equal(jobNames.length, 1, 'proof must have exactly one job');
  assert.match(workflow, /^permissions:\s*\r?\n  contents: read\s*\r?\n  id-token: write\s*$/m);
  assert.doesNotMatch(workflow, /^(?:  |    |      )(?:actions|checks|contents|deployments|issues|packages|pull-requests|statuses|workflows): write\s*$/m);
  assert.match(workflow, /environment:\s*(?:\r?\n\s+name:\s*)?production-preflight\s*$/m);
  assert.doesNotMatch(workflow, /\b(?:push|pull_request|pull_request_target|workflow_run|repository_dispatch):/);
});

test('isolated preflight proof rejects non-main refs before OIDC and uses a masked role binding', () => {
  const workflow = preflightProofSource();
  const guardStart = workflow.indexOf('- name: Require main ref');
  const checkoutStart = workflow.indexOf('- name: Check out exact main commit');
  const guard = workflow.slice(guardStart, checkoutStart);
  const oidcRequest = workflow.indexOf('ACTIONS_ID_TOKEN_REQUEST_URL');
  const roleAssumption = workflow.indexOf('assume-role-with-web-identity');
  assert.ok(guardStart >= 0 && checkoutStart > guardStart, 'main guard must be the first step');
  assert.match(guard, /\$GITHUB_REF[^\n]*refs\/heads\/main/);
  assert.match(guard, /exit 1/);
  assert.ok(oidcRequest >= 0 && roleAssumption >= 0, 'OIDC role assumption is required');
  assert.ok(checkoutStart < oidcRequest && guardStart < roleAssumption);
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /secrets\.AWS_PREFLIGHT_ROLE_TO_ASSUME/);
  assert.doesNotMatch(workflow, /vars\.AWS_PREFLIGHT_ROLE_TO_ASSUME/);
  assert.match(workflow, /vars\.AWS_REGION\s*\|\|\s*'us-east-1'/);
  assert.doesNotMatch(workflow, /\b(?:aws\s+sts\s+get-caller-identity|set-output)\b/i);
});

test('isolated preflight topology proof is limited to approved reads and identifier-free evidence', () => {
  const workflow = preflightProofSource();
  const topologySource = fs.readFileSync(path.join(
    __dirname,
    '../../scripts/release/aws-release-topology.js'
  ), 'utf8');
  assert.match(workflow, /collectAwsTopology/);
  assert.match(workflow, /createAwsCliRunner/);
  const collectionStart = topologySource.indexOf('function collectAwsTopology(');
  const collectionEnd = topologySource.indexOf('function cliConfiguration(', collectionStart);
  assert.ok(collectionStart >= 0 && collectionEnd > collectionStart,
    'bound the operation review to collectAwsTopology');
  const collection = topologySource.slice(collectionStart, collectionEnd);
  const operations = [...collection.matchAll(/runAws\(\s*'([^']+)',\s*'([^']+)'/g)]
    .map((match) => `${match[1]}:${match[2]}`)
    .sort();
  assert.deepEqual(operations, [
    'autoscaling:describe-auto-scaling-groups',
    'elasticbeanstalk:describe-configuration-settings',
    'elasticbeanstalk:describe-environment-resources',
    'elasticbeanstalk:describe-environments',
    'elasticbeanstalk:describe-instances-health',
    'elbv2:describe-listeners',
    'elbv2:describe-load-balancer-attributes',
    'elbv2:describe-load-balancers',
    'elbv2:describe-target-groups',
    'elbv2:describe-target-health',
  ]);
  const workflowLabels = [...workflow.matchAll(/^\s+'([^']+)': '(Describe[^']+)',?\s*$/gm)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(workflowLabels, approvedProofReads.map(([service, operation, label]) => [
    `${service}:${operation}`, label,
  ]));
  assert.match(workflow, /approvedReads = Object\.freeze\(/);
  assert.match(workflow, /Object\.hasOwn\(approvedReads,/);
  assert.match(workflow, /createAwsCliRunner\(\{\s*awsCli: 'aws',\s*spawn:/);
  const classifier = workflow.slice(
    workflow.indexOf('function classifyAwsError('),
    workflow.indexOf('let failureClass =', workflow.indexOf('function classifyAwsError('))
  );
  assert.deepEqual([...classifier.matchAll(/return '([^']+)'/g)].map((match) => match[1]), [
    'AccessDenied', 'ResourceNotFound', 'ValidationError', 'OtherAwsError',
  ]);
  assert.doesNotMatch(workflow, /actions\/upload-artifact|\.github\/workflows\/deploy-eb-production|gh\s+workflow\s+run/i);
  assert.doesNotMatch(workflow, /\b(?:ssm|s3api|s3|elasticbeanstalk\s+(?:update|create|terminate)|elbv2\s+(?:modify|create|delete)|autoscaling\s+(?:update|create|delete))\b/i);
  assert.doesNotMatch(workflow, /\baws\s+iam\b|put-role-policy|attach-role-policy|create-policy/i);
  assert.doesNotMatch(workflow, /\b(?:contents|pull-requests|deployments): write\b/);
  assert.doesNotMatch(workflow, /(?:printf|console\.log|console\.error|process\.stdout\.write)[^\n]*(?:\$\{?AWS_|\$\{?ROLE_|arn:aws|AccountId|LoadBalancerArn|InstanceId|TargetGroupArn|error\.message)/i);
  assert.doesNotMatch(workflow, /console\.log\([^\n]*(?:stderr|detail|result\.stdout)/i);
  assert.doesNotMatch(workflow, /console\.error|process\.stderr\.write|\baws\s+sts\s+get-caller-identity\b/i);
  const messages = [...workflow.matchAll(/printf '%s\\n' '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(messages, [
    'FAIL: main ref required',
    'PASS: main ref',
    'PASS: masked role binding present',
    'PASS: GitHub OIDC token issued',
    'PASS: AWS role assumption',
  ]);
  assert.match(workflow, /set \+x/);
  assert.match(workflow, /2>\/dev\/null/);
});

test('isolated preflight proof reports fixed stage results and validates collected topology', () => {
  const workflow = preflightProofSource();
  assert.match(workflow, /fail\(\)\s*\{\s*printf 'FAIL: %s\\n' "\$1"\s*exit 1\s*\}/);
  const failureStages = [...workflow.matchAll(/\bfail '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(failureStages)], [
    'masked role binding',
    'GitHub OIDC token',
    'AWS role assumption',
    'read-only AWS topology collection',
  ]);
  const nodeMarkers = [...workflow.matchAll(/console\.log\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(nodeMarkers, [
    'WARN: DescribeInstancesHealth',
    'WARN CLASS: AccessDenied',
    'FAIL: read-only AWS topology collection',
    'PASS: read-only AWS topology collection',
    'FAIL: topology validation',
  ]);
  assert.match(workflow, /\? 'PASS: topology validation \(EB instance health unverified\)'/);
  assert.match(workflow, /: 'PASS: topology validation'/);
  assert.doesNotMatch(workflow, /FAIL: production-preflight OIDC\/topology proof/);

  const successMarkers = [
    'PASS: masked role binding present',
    'PASS: GitHub OIDC token issued',
    'PASS: AWS role assumption',
    'PASS: read-only AWS topology collection',
    'PASS: topology validation',
  ];
  const positions = successMarkers.map((marker) => workflow.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));

  const collection = workflow.indexOf('payload = topology.collectAwsTopology(');
  const validation = workflow.indexOf('validateTopology(validationPayload, {');
  assert.ok(collection >= 0 && validation > collection, 'validation must follow collection');
  assert.match(workflow, /configuration: \{ ConfigurationSettings: payload\.configuration \}/);
  assert.match(workflow, /allowInstanceHealthAccessDeniedInProof: instanceHealthAccessDenied/);
  assert.match(workflow, /mode: 'preflight'/);
  assert.match(workflow, /releaseSha: process\.env\.GITHUB_SHA/);
  assert.match(workflow, /mixedVersionSafe: false/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /node 2>\/dev\/null <<'NODE'/);
  assert.match(workflow, /--output text 2>\/dev\/null/);
});

test('isolated proof validates the filtered configuration and labels every approved AWS read', () => {
  const expectedOperations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const expectedPasses = approvedProofReads.map(([, , label]) => `PASS: ${label}`);
  const collected = runEmbeddedPreflightProof();
  assert.deepEqual(collected.awsCalls, expectedOperations);
  assert.deepEqual(collected.messages, [
    ...expectedPasses,
    'PASS: read-only AWS topology collection',
    'PASS: topology validation',
  ]);
  assert.equal(collected.validated, true);
  assert.equal(collected.exitCode, undefined);
  assert.equal(collected.validatedPayload.configuration.ConfigurationSettings.length, 1);
  assert.equal(collected.validatedOptions.mode, 'preflight');
  assert.equal(collected.validationResult.status, 'passed');
  assert.equal(Object.hasOwn(collected.validationResult, 'instanceHealthVerified'), false);
  assert.doesNotMatch(collected.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd/);
});

test('isolated proof warns only for denied EB instance health and completes every later read', () => {
  const expectedOperations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const expectedPasses = approvedProofReads.map(([, , label]) => `PASS: ${label}`);
  const healthIndex = expectedOperations.indexOf('elasticbeanstalk:describe-instances-health');
  const warning = runEmbeddedPreflightProof({
    failOperation: expectedOperations[healthIndex],
    awsError: `An error occurred (AccessDeniedException) for ${LOAD_BALANCER_ARN} ${INSTANCE_ID}`,
  });
  assert.deepEqual(warning.awsCalls, expectedOperations);
  assert.equal(warning.awsCalls.filter((operation) => operation === expectedOperations[healthIndex]).length, 1);
  assert.deepEqual(warning.messages, [
    ...expectedPasses.slice(0, healthIndex),
    'WARN: DescribeInstancesHealth',
    'WARN CLASS: AccessDenied',
    ...expectedPasses.slice(healthIndex + 1),
    'PASS: read-only AWS topology collection',
    'PASS: topology validation (EB instance health unverified)',
  ]);
  assert.equal(warning.validated, true);
  assert.equal(warning.exitCode, undefined);
  assert.equal(warning.validatedPayload.instanceHealth, null);
  assert.equal(warning.validatedPayload.configuration.ConfigurationSettings.length, 1);
  assert.equal(warning.validatedOptions.allowInstanceHealthAccessDeniedInProof, true);
  assert.equal(warning.validationResult.instanceHealthVerified, false);
  assert.equal(warning.validationResult.instances, null);
  assert.equal(warning.validationResult.loadBalancer.healthyTargetCount, 1);
  assert.doesNotMatch(warning.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd|AccessDeniedException|An error occurred/);
  assert.doesNotMatch(JSON.stringify(warning.validationResult), /arn:aws|123456789012|i-000000001234abcd/);

  const laterFailure = runEmbeddedPreflightProof({
    awsFailures: {
      'elasticbeanstalk:describe-instances-health': 'An error occurred (AccessDeniedException)',
      'elbv2:describe-target-health': `An error occurred (ValidationError) for ${TARGET_GROUP_ARN}`,
    },
  });
  const targetHealthIndex = expectedOperations.indexOf('elbv2:describe-target-health');
  assert.deepEqual(laterFailure.awsCalls, expectedOperations.slice(0, targetHealthIndex + 1));
  assert.deepEqual(laterFailure.messages, [
    ...expectedPasses.slice(0, healthIndex),
    'WARN: DescribeInstancesHealth',
    'WARN CLASS: AccessDenied',
    ...expectedPasses.slice(healthIndex + 1, targetHealthIndex),
    'FAIL: DescribeTargetHealth',
    'FAIL CLASS: ValidationError',
    'FAIL: read-only AWS topology collection',
  ]);
  assert.equal(laterFailure.validated, false);
  assert.equal(laterFailure.exitCode, 1);
  assert.doesNotMatch(laterFailure.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd|An error occurred/);
});

test('isolated proof stops at any denied read other than EB instance health', () => {
  const expectedOperations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const expectedPasses = approvedProofReads.map(([, , label]) => `PASS: ${label}`);
  const healthIndex = expectedOperations.indexOf('elasticbeanstalk:describe-instances-health');

  for (let index = 0; index < approvedProofReads.length; index += 1) {
    if (index === healthIndex) continue;
    const [, , label] = approvedProofReads[index];
    const failure = runEmbeddedPreflightProof({
      failOperation: expectedOperations[index],
      awsError: `An error occurred (AccessDeniedException) for ${LOAD_BALANCER_ARN} ${INSTANCE_ID}`,
    });
    assert.deepEqual(failure.awsCalls, expectedOperations.slice(0, index + 1));
    assert.deepEqual(failure.messages, [
      ...expectedPasses.slice(0, index),
      `FAIL: ${label}`,
      'FAIL CLASS: AccessDenied',
      'FAIL: read-only AWS topology collection',
    ]);
    assert.equal(failure.validated, false);
    assert.equal(failure.exitCode, 1);
    assert.doesNotMatch(failure.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd|AccessDeniedException/);
  }
});

test('other EB instance-health errors and malformed or unhealthy returned topology remain fatal', () => {
  const expectedOperations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const expectedPasses = approvedProofReads.map(([, , label]) => `PASS: ${label}`);
  const healthIndex = expectedOperations.indexOf('elasticbeanstalk:describe-instances-health');
  for (const [awsError, expectedClass] of [
    [`An error occurred (ResourceNotFoundException) for ${INSTANCE_ID}`, 'ResourceNotFound'],
    [`An error occurred (ValidationError) for ${INSTANCE_ID}`, 'ValidationError'],
    [`An error occurred (ValidationError) while not authorized to perform on ${INSTANCE_ID}`, 'ValidationError'],
    [`An error occurred (ThrottlingException) for ${INSTANCE_ID}`, 'OtherAwsError'],
  ]) {
    const failure = runEmbeddedPreflightProof({
      failOperation: expectedOperations[healthIndex],
      awsError,
    });
    assert.deepEqual(failure.awsCalls, expectedOperations.slice(0, healthIndex + 1));
    assert.deepEqual(failure.messages, [
      ...expectedPasses.slice(0, healthIndex),
      'FAIL: DescribeInstancesHealth',
      `FAIL CLASS: ${expectedClass}`,
      'FAIL: read-only AWS topology collection',
    ]);
    assert.equal(failure.validated, false);
    assert.equal(failure.exitCode, 1);
    assert.doesNotMatch(failure.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd|An error occurred/);
  }

  for (const [cliResult, expectedClass] of [
    [{ status: null, error: new Error('spawn failed'), stderr: 'An error occurred (AccessDeniedException)', stdout: '' }, 'AccessDenied'],
    [{ status: 0, stderr: '', stdout: '{malformed json' }, 'OtherAwsError'],
  ]) {
    const failure = runEmbeddedPreflightProof({
      awsResultOverrides: { [expectedOperations[healthIndex]]: cliResult },
    });
    assert.deepEqual(failure.awsCalls, expectedOperations.slice(0, healthIndex + 1));
    assert.deepEqual(failure.messages, [
      ...expectedPasses.slice(0, healthIndex),
      'FAIL: DescribeInstancesHealth',
      `FAIL CLASS: ${expectedClass}`,
      'FAIL: read-only AWS topology collection',
    ]);
    assert.equal(failure.validated, false);
    assert.equal(failure.exitCode, 1);
    assert.doesNotMatch(failure.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd|An error occurred/);
  }

  const invalidCases = [
    { mutateResponses: (responses) => { responses['elasticbeanstalk:describe-configuration-settings'] = []; } },
    { mutateFixture: (fixture) => { fixture.instanceHealth.InstanceHealthList[0].Color = 'Red'; } },
    { mutateFixture: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances[0].HealthStatus = 'Unhealthy'; } },
    { mutateFixture: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].MaxSize = 2; } },
    { mutateFixture: (fixture) => { fixture.targetHealthByGroup[TARGET_GROUP_ARN].TargetHealthDescriptions[0].TargetHealth.State = 'unhealthy'; } },
    { mutateFixture: (fixture) => { fixture.listeners.Listeners.pop(); } },
  ];
  for (const invalidCase of invalidCases) {
    const failure = runEmbeddedPreflightProof(invalidCase);
    assert.deepEqual(failure.awsCalls, expectedOperations);
    assert.deepEqual(failure.messages, [
      ...expectedPasses,
      'PASS: read-only AWS topology collection',
      'FAIL: topology validation',
    ]);
    assert.equal(failure.validated, true);
    assert.equal(failure.exitCode, 1);
    assert.doesNotMatch(failure.messages.join('\n'), /arn:aws|123456789012|i-000000001234abcd/);
  }

  const invalidAfterWarning = runEmbeddedPreflightProof({
    failOperation: expectedOperations[healthIndex],
    awsError: 'An error occurred (AccessDeniedException)',
    mutateFixture: (fixture) => { fixture.autoScaling.AutoScalingGroups[0].Instances[0].HealthStatus = 'Unhealthy'; },
  });
  assert.deepEqual(invalidAfterWarning.awsCalls, expectedOperations);
  assert.deepEqual(invalidAfterWarning.messages, [
    ...expectedPasses.slice(0, healthIndex),
    'WARN: DescribeInstancesHealth',
    'WARN CLASS: AccessDenied',
    ...expectedPasses.slice(healthIndex + 1),
    'PASS: read-only AWS topology collection',
    'FAIL: topology validation',
  ]);
  assert.equal(invalidAfterWarning.validated, true);
  assert.equal(invalidAfterWarning.exitCode, 1);
});

test('isolated proof emits only approved AWS error classes and rejects unapproved operations', () => {
  const firstOperation = approvedProofReads[0].slice(0, 2).join(':');
  for (const [awsCode, expectedClass] of [
    ['AccessDeniedException', 'AccessDenied'],
    ['ResourceNotFoundException', 'ResourceNotFound'],
    ['ValidationError', 'ValidationError'],
    ['ThrottlingException', 'OtherAwsError'],
  ]) {
    const failure = runEmbeddedPreflightProof({
      failOperation: firstOperation,
      awsError: `An error occurred (${awsCode}) for ${TARGET_GROUP_ARN}`,
    });
    assert.deepEqual(failure.messages, [
      'FAIL: DescribeEnvironments',
      `FAIL CLASS: ${expectedClass}`,
      'FAIL: read-only AWS topology collection',
    ]);
    assert.equal(failure.validated, false);
    assert.doesNotMatch(failure.messages.join('\n'), /arn:aws|123456789012|An error occurred/);
  }
  const unapproved = runEmbeddedPreflightProof({ unapprovedOperation: true });
  assert.deepEqual(unapproved.awsCalls, []);
  assert.deepEqual(unapproved.messages, ['FAIL: read-only AWS topology collection']);
  assert.equal(unapproved.exitCode, 1);
  assert.equal(unapproved.validated, false);
});
