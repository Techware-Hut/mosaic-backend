'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const topologyApi = require('../../scripts/release/aws-release-topology');
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

test('focused-baseline gate CLI mode is explicit and invalid mode fails before AWS access', () => {
  const args = ['verify', '--release-mode', 'focused-baseline', '--output', 'unused.json'];
  assert.equal(gateApi.cliConfiguration(args, {}, gateConfig()).releaseMode, 'focused-baseline');
  assert.throws(
    () => gateApi.cliConfiguration([
      'enable', '--release-mode', 'focused-baseline', '--confirm', 'ENABLE_CHECKOUT_GATE',
      '--output', 'unused.json',
    ], {}, gateConfig()),
    /Focused live ALB mutation is disabled/,
  );
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

function embeddedPreflightProofNode() {
  const match = preflightProofSource().match(/^ {10}node 2>\/dev\/null <<'NODE'\r?\n([\s\S]*?)^ {10}NODE\s*$/m);
  assert.ok(match, 'proof workflow must contain its isolated Node script');
  return match[1].replace(/^ {10}/gm, '');
}

function runEmbeddedPreflightProof({ failOperation, awsError, unapprovedOperation = false } = {}) {
  const fixture = topologyFixture();
  const responses = Object.fromEntries(approvedProofReads.map(([service, operation, , fixtureKey]) => [
    `${service}:${operation}`,
    fixtureKey === 'targetHealthByGroup' ? fixture.targetHealthByGroup[TARGET_GROUP_ARN] : fixture[fixtureKey],
  ]));
  // The collector's --query projects ConfigurationSettings to a bare array.
  responses['elasticbeanstalk:describe-configuration-settings'] = fixture.configuration.ConfigurationSettings;
  const awsCalls = [];
  const messages = [];
  let validated = false;
  const fakeSpawn = (binary, args) => {
    assert.equal(binary, 'aws');
    const operation = `${args[0]}:${args[1]}`;
    awsCalls.push(operation);
    assert.ok(Object.hasOwn(responses, operation), 'only approved read operations reach AWS CLI');
    if (operation === 'elasticbeanstalk:describe-configuration-settings') {
      assert.ok(args.includes('--query'), 'configuration response is filtered by the AWS CLI query');
    }
    if (operation === failOperation) {
      return { status: 255, stderr: awsError, stdout: '' };
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
          return topologyApi.validateTopology(payload, options);
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
  return { awsCalls, messages, validated, exitCode: localProcess.exitCode };
}

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
    'FAIL: read-only AWS topology collection',
    'PASS: read-only AWS topology collection',
    'FAIL: topology validation',
    'PASS: topology validation',
  ]);
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
  const validation = workflow.indexOf('validateTopology(payload, {');
  assert.ok(collection >= 0 && validation > collection, 'validation must follow collection');
  assert.match(workflow, /mode: 'preflight'/);
  assert.match(workflow, /releaseSha: process\.env\.GITHUB_SHA/);
  assert.match(workflow, /mixedVersionSafe: false/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /node 2>\/dev\/null <<'NODE'/);
  assert.match(workflow, /--output text 2>\/dev\/null/);
});

test('isolated proof labels every approved AWS read and stops at the failing operation', () => {
  const expectedOperations = approvedProofReads.map(([service, operation]) => `${service}:${operation}`);
  const expectedPasses = approvedProofReads.map(([, , label]) => `PASS: ${label}`);
  const collected = runEmbeddedPreflightProof();
  // The existing validator expects a ConfigurationSettings envelope, while the
  // collector's AWS CLI query returns an array. Diagnostics leave that contract unchanged.
  assert.deepEqual(collected.awsCalls, expectedOperations);
  assert.deepEqual(collected.messages, [
    ...expectedPasses,
    'PASS: read-only AWS topology collection',
    'FAIL: topology validation',
  ]);
  assert.equal(collected.validated, true);
  assert.equal(collected.exitCode, 1);

  for (let index = 0; index < approvedProofReads.length; index += 1) {
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
