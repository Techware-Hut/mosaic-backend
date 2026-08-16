'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

function gateFixture(initialPath = gateApi.DEFAULT_DISABLED_PATH) {
  const rule = (ruleArn) => ({
    RuleArn: ruleArn,
    Priority: '1',
    IsDefault: false,
    Conditions: gateApi.gateConditions(initialPath),
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

function gateConfig() {
  return {
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
