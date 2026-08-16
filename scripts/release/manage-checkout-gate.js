#!/usr/bin/env node
'use strict';

const {
  assertArn,
  createAwsCliRunner,
  nowIso,
  optionalOption,
  parseOptions,
  readJson,
  requireOption,
  resourceRef,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const ACTIVE_PATH = '/api/orders/initiate';
// Express routing is case-insensitive and non-strict by default. ALB value
// path patterns are case-sensitive, so an exact value would leave equivalent
// mixed-case and trailing-slash checkout routes open. This bounded regex
// covers only those application-equivalent spellings of the one route.
const ACTIVE_PATH_REGEX = '^/[aA][pP][iI]/[oO][rR][dD][eE][rR][sS]/[iI][nN][iI][tT][iI][aA][tT][eE]/?$';
const DEFAULT_DISABLED_PATH = '/__mosaic_release_control/checkout_gate_disabled__';
const REQUIRED_TAG_KEY = 'mosaic:release-control';
const REQUIRED_TAG_VALUE = 'checkout-initiation';

function one(values, label) {
  if (!Array.isArray(values) || values.length !== 1) {
    throw new Error(`${label} must contain exactly one item`);
  }
  return values[0];
}

function priority(value, name) {
  if (!/^\d+$/.test(String(value || ''))) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (parsed !== 1) {
    throw new Error(`${name} must be exactly 1 so no listener rule can precede the checkout gate`);
  }
  return String(parsed);
}

function requireFirstPriority(config) {
  if (String(config.httpPriority) !== '1' || String(config.httpsPriority) !== '1') {
    throw new Error('Both checkout-gate listener rules must use priority 1');
  }
}

function exactPath(value, name) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(String(value || '')) || /[*?]/.test(value)) {
    throw new Error(`${name} must be one exact path without a wildcard`);
  }
  return value;
}

function parseElbv2Arn(value, resourceType, name) {
  assertArn(value, name);
  const pattern = resourceType === 'loadbalancer'
    ? /^arn:(aws(?:-[a-z]+)?):elasticloadbalancing:([a-z0-9-]+):(\d{12}):loadbalancer\/app\/([^/]+)\/([^/]+)$/
    : /^arn:(aws(?:-[a-z]+)?):elasticloadbalancing:([a-z0-9-]+):(\d{12}):listener-rule\/app\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/;
  const match = String(value).match(pattern);
  if (!match) throw new Error(`${name} is not an Application Load Balancer ${resourceType} ARN`);
  return {
    partition: match[1],
    region: match[2],
    account: match[3],
    loadBalancerName: match[4],
    loadBalancerId: match[5],
  };
}

function validatePinnedArnSet(config) {
  requireFirstPriority(config);
  const loadBalancer = parseElbv2Arn(
    config.loadBalancerArn,
    'loadbalancer',
    'CHECKOUT_GATE_LOAD_BALANCER_ARN'
  );
  const http = parseElbv2Arn(config.httpRuleArn, 'listener-rule', 'CHECKOUT_GATE_HTTP_RULE_ARN');
  const https = parseElbv2Arn(
    config.httpsRuleArn,
    'listener-rule',
    'CHECKOUT_GATE_HTTPS_RULE_ARN'
  );
  for (const rule of [http, https]) {
    if (
      rule.partition !== loadBalancer.partition ||
      rule.region !== loadBalancer.region ||
      rule.account !== loadBalancer.account ||
      rule.loadBalancerName !== loadBalancer.loadBalancerName ||
      rule.loadBalancerId !== loadBalancer.loadBalancerId
    ) {
      throw new Error('Pinned gate rules and load balancer must share one AWS identity');
    }
  }
  if (config.region !== loadBalancer.region) {
    throw new Error('AWS_REGION does not match the pinned gate resources');
  }
}

function conditionValues(condition) {
  if (Array.isArray(condition.Values)) return condition.Values;
  if (condition.HttpRequestMethodConfig && Array.isArray(condition.HttpRequestMethodConfig.Values)) {
    return condition.HttpRequestMethodConfig.Values;
  }
  if (condition.PathPatternConfig && Array.isArray(condition.PathPatternConfig.Values)) {
    return condition.PathPatternConfig.Values;
  }
  return [];
}

function pathMatcher(condition) {
  const config = condition.PathPatternConfig || {};
  const values = Array.isArray(config.Values)
    ? config.Values
    : Array.isArray(condition.Values) ? condition.Values : [];
  const regexValues = Array.isArray(config.RegexValues)
    ? config.RegexValues
    : Array.isArray(condition.RegexValues) ? condition.RegexValues : [];
  return { values, regexValues };
}

function validateRuleShape(rule, expectedPriority, config, label) {
  if (!rule || rule.IsDefault === true || rule.Priority === 'default') {
    throw new Error(`${label} is missing or is the default listener rule`);
  }
  if (String(rule.Priority) !== expectedPriority) {
    throw new Error(`${label} priority differs from its pinned configuration`);
  }
  if (!Array.isArray(rule.Actions) || rule.Actions.length !== 1) {
    throw new Error(`${label} must have exactly one action`);
  }
  const action = rule.Actions[0];
  if (
    action.Type !== 'fixed-response' ||
    !action.FixedResponseConfig ||
    String(action.FixedResponseConfig.StatusCode) !== '503'
  ) {
    throw new Error(`${label} action must remain a fixed HTTP 503 response`);
  }
  if (!Array.isArray(rule.Conditions) || rule.Conditions.length !== 2) {
    throw new Error(`${label} must have exactly two conditions`);
  }
  const methodConditions = rule.Conditions.filter((entry) => entry.Field === 'http-request-method');
  const pathConditions = rule.Conditions.filter((entry) => entry.Field === 'path-pattern');
  if (
    methodConditions.length !== 1 ||
    pathConditions.length !== 1 ||
    JSON.stringify(conditionValues(methodConditions[0])) !== JSON.stringify(['POST'])
  ) {
    throw new Error(`${label} must match only HTTP method POST`);
  }
  const matcher = pathMatcher(pathConditions[0]);
  const active = matcher.values.length === 0
    && JSON.stringify(matcher.regexValues) === JSON.stringify([ACTIVE_PATH_REGEX]);
  const inactive = matcher.regexValues.length === 0
    && JSON.stringify(matcher.values) === JSON.stringify([config.disabledPath]);
  if (!active && !inactive) {
    throw new Error(`${label} path condition is not a recognized exact gate state`);
  }
  return active ? 'active' : 'inactive';
}

function tagsFor(snapshot, ruleArn) {
  const descriptions = snapshot.tags && snapshot.tags.TagDescriptions;
  if (!Array.isArray(descriptions)) throw new Error('Gate rule tags are unavailable');
  const description = descriptions.find((entry) => entry.ResourceArn === ruleArn);
  if (!description || !Array.isArray(description.Tags)) throw new Error('Gate rule tags are unavailable');
  return description.Tags;
}

function hasRequiredTag(tags, config) {
  return tags.some((tag) => tag.Key === config.tagKey && tag.Value === config.tagValue);
}

function isCanonicalGateRule(rule) {
  const method = (rule.Conditions || []).find((entry) => entry.Field === 'http-request-method');
  const path = (rule.Conditions || []).find((entry) => entry.Field === 'path-pattern');
  const matcher = pathMatcher(path || {});
  return (
    JSON.stringify(conditionValues(method || {})) === JSON.stringify(['POST']) &&
    matcher.values.length === 0 &&
    JSON.stringify(matcher.regexValues) === JSON.stringify([ACTIVE_PATH_REGEX])
  );
}

function inspectGate(snapshot, config, clock, options = {}) {
  requireFirstPriority(config);
  const loadBalancer = one(
    snapshot.loadBalancers && snapshot.loadBalancers.LoadBalancers,
    'LoadBalancers'
  );
  if (
    loadBalancer.LoadBalancerArn !== config.loadBalancerArn ||
    loadBalancer.Type !== 'application' ||
    loadBalancer.Scheme !== 'internet-facing' ||
    !loadBalancer.State || loadBalancer.State.Code !== 'active'
  ) {
    throw new Error('Pinned checkout-gate load balancer identity or state is unexpected');
  }
  const listeners = snapshot.listeners && snapshot.listeners.Listeners;
  if (!Array.isArray(listeners) || listeners.length !== 2) {
    throw new Error('Pinned load balancer must have exactly two listeners');
  }
  const expected = [
    { port: 80, protocol: 'HTTP', ruleArn: config.httpRuleArn, rulePriority: config.httpPriority },
    { port: 443, protocol: 'HTTPS', ruleArn: config.httpsRuleArn, rulePriority: config.httpsPriority },
  ];
  const records = [];
  const canonicalByListener = [];
  for (const item of expected) {
    const listener = listeners.find(
      (candidate) => candidate.Port === item.port && candidate.Protocol === item.protocol
    );
    if (!listener || listener.LoadBalancerArn !== config.loadBalancerArn) {
      throw new Error(`Pinned ${item.protocol}/${item.port} listener is unavailable`);
    }
    const response = snapshot.rulesByListener && snapshot.rulesByListener[listener.ListenerArn];
    if (!response || !Array.isArray(response.Rules)) {
      throw new Error(`Rules for ${item.protocol}/${item.port} are unavailable`);
    }
    const rule = response.Rules.find((candidate) => candidate.RuleArn === item.ruleArn);
    if (!rule) throw new Error(`Pinned ${item.protocol}/${item.port} gate rule is unavailable`);
    const duplicateTargets = response.Rules.filter(isCanonicalGateRule);
    canonicalByListener.push({ port: item.port, duplicates: duplicateTargets.length });
    const state = validateRuleShape(
      rule,
      item.rulePriority,
      config,
      `${item.protocol}/${item.port} gate rule`
    );
    if (!hasRequiredTag(tagsFor(snapshot, item.ruleArn), config)) {
      throw new Error(`${item.protocol}/${item.port} gate rule lacks its pinned ownership tag`);
    }
    records.push({
      port: item.port,
      protocol: item.protocol,
      listenerArn: listener.ListenerArn,
      ruleArn: item.ruleArn,
      priority: item.rulePriority,
      state,
    });
  }
  if (config.httpRuleArn === config.httpsRuleArn) {
    throw new Error('HTTP and HTTPS must use two distinct pinned gate rules');
  }
  if (records.some((record) => canonicalByListener.find((entry) => entry.port === record.port).duplicates > (record.state === 'active' ? 1 : 0))) {
    throw new Error('An unpinned listener rule also targets canonical checkout initiation');
  }
  const states = [...new Set(records.map((record) => record.state))];
  if (states.length !== 1 && !options.allowMixed) {
    throw new Error('Checkout gate rules are in a mixed state');
  }
  const state = states.length === 1 ? states[0] : 'mixed';

  return {
    state,
    records,
    evidence: {
      schemaVersion: 1,
      status: state === 'mixed' ? 'blocked' : 'passed',
      checkedAt: nowIso(clock),
      gateState: state,
      target: { method: 'POST', path: ACTIVE_PATH, fixedResponseStatus: 503 },
      loadBalancerRef: resourceRef(config.loadBalancerArn, 'alb'),
      rules: records.map((record) => ({
        ruleRef: resourceRef(record.ruleArn, `rule-${record.port}`),
        listener: `${record.protocol}/${record.port}`,
        priority: record.priority,
        state: record.state,
      })),
    },
  };
}

function gateConditions(pathValue) {
  const pathPatternConfig = pathValue === ACTIVE_PATH
    ? { RegexValues: [ACTIVE_PATH_REGEX] }
    : { Values: [pathValue] };
  return [
    {
      Field: 'http-request-method',
      HttpRequestMethodConfig: { Values: ['POST'] },
    },
    {
      Field: 'path-pattern',
      PathPatternConfig: pathPatternConfig,
    },
  ];
}

function createAwsGateClient({ runAws, region, config }) {
  const regionArgs = ['--region', region];
  return {
    read() {
      const loadBalancers = runAws('elbv2', 'describe-load-balancers', [
        '--load-balancer-arns', config.loadBalancerArn,
        ...regionArgs,
      ]);
      const listeners = runAws('elbv2', 'describe-listeners', [
        '--load-balancer-arn', config.loadBalancerArn,
        ...regionArgs,
      ]);
      const rulesByListener = {};
      for (const listener of listeners.Listeners || []) {
        rulesByListener[listener.ListenerArn] = runAws('elbv2', 'describe-rules', [
          '--listener-arn', listener.ListenerArn,
          ...regionArgs,
        ]);
      }
      const tags = runAws('elbv2', 'describe-tags', [
        '--resource-arns', config.httpRuleArn, config.httpsRuleArn,
        ...regionArgs,
      ]);
      return { loadBalancers, listeners, rulesByListener, tags };
    },
    modifyRule(ruleArn, pathValue) {
      runAws('elbv2', 'modify-rule', [
        '--rule-arn', ruleArn,
        '--conditions', JSON.stringify(gateConditions(pathValue)),
        ...regionArgs,
      ]);
    },
  };
}

function createFixtureGateClient(fixture) {
  const snapshot = JSON.parse(JSON.stringify(fixture));
  let modificationCount = 0;
  return {
    read() {
      return snapshot;
    },
    modifyRule(ruleArn, pathValue) {
      modificationCount += 1;
      if (snapshot.failOnModifyCall === modificationCount) {
        throw new Error('Injected fixture mutation failure');
      }
      for (const response of Object.values(snapshot.rulesByListener || {})) {
        const rule = (response.Rules || []).find((candidate) => candidate.RuleArn === ruleArn);
        if (rule) {
          rule.Conditions = gateConditions(pathValue);
          return;
        }
      }
      throw new Error('Fixture gate rule is unavailable');
    },
  };
}

function forceActive(client, config) {
  let mutationFailed = false;
  // HTTPS is the canonical public surface, so activate it before HTTP.
  for (const ruleArn of [config.httpsRuleArn, config.httpRuleArn]) {
    try {
      client.modifyRule(ruleArn, ACTIVE_PATH);
    } catch (_error) {
      mutationFailed = true;
    }
  }
  try {
    const observed = inspectGate(client.read(), config);
    return !mutationFailed && observed.state === 'active';
  } catch (_error) {
    return false;
  }
}

function transitionGate(client, desiredState, config, clock) {
  // A prior runner loss can leave one of the two listeners active. Enabling is
  // the recovery operation, so validate both pinned rule shapes while allowing
  // that one mixed state. Malformed/unpinned infrastructure still fails before
  // any mutation.
  const before = inspectGate(client.read(), config, clock, { allowMixed: true });
  if (before.state === desiredState) {
    return { ...before.evidence, operation: 'idempotent' };
  }
  if (before.state === 'mixed' && desiredState === 'inactive') {
    const recovered = forceActive(client, config);
    const error = new Error(
      recovered
        ? 'Refused to disable a mixed checkout gate; fail-safe recovery left it active'
        : 'Refused to disable a mixed checkout gate and active fail-safe could not be verified'
    );
    error.gateState = recovered ? 'active' : 'unknown';
    throw error;
  }
  const desiredPath = desiredState === 'active' ? ACTIVE_PATH : config.disabledPath;
  try {
    // There is no atomic ELBv2 operation spanning two listeners. Minimize the
    // interruption window by gating HTTPS first on enable and last on disable.
    const transitionOrder = [...before.records].sort((left, right) =>
      desiredState === 'active' ? right.port - left.port : left.port - right.port
    );
    for (const record of transitionOrder) {
      client.modifyRule(record.ruleArn, desiredPath);
    }
    const after = inspectGate(client.read(), config, clock);
    if (after.state !== desiredState) throw new Error('Gate did not reach its requested state');
    return { ...after.evidence, operation: desiredState === 'active' ? 'enabled' : 'disabled' };
  } catch (_error) {
    const recovered = forceActive(client, config);
    const error = new Error(
      recovered
        ? 'Gate transition failed; fail-safe recovery left checkout gate active'
        : 'Gate transition failed and active fail-safe could not be verified'
    );
    error.gateState = recovered ? 'active' : 'unknown';
    throw error;
  }
}

function verifyGate(client, expectedState, config, clock) {
  const observed = inspectGate(client.read(), config, clock);
  if (observed.state !== expectedState) {
    throw new Error(`Checkout gate is ${observed.state}; expected ${expectedState}`);
  }
  return { ...observed.evidence, operation: 'verified' };
}

function cliConfiguration(argv, env = process.env, fixtureConfiguration = {}) {
  const options = parseOptions(argv, { positionals: 1 });
  const action = options._[0];
  if (!['enable', 'disable', 'verify'].includes(action)) {
    throw new Error(
      'Usage: manage-checkout-gate.js enable|disable|verify --output <json> [options]'
    );
  }
  const allowed = new Set(['_', '--output', '--fixture', '--expected-state', '--confirm']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(`Unsupported option: ${key}`);
  }
  const from = (fixtureName, envName, fallback) =>
    fixtureConfiguration[fixtureName] || env[envName] || fallback;
  const disabledPath = exactPath(
    from('disabledPath', 'CHECKOUT_GATE_DISABLED_PATH', DEFAULT_DISABLED_PATH),
    'disabled gate path'
  );
  if (disabledPath === ACTIVE_PATH) throw new Error('Disabled gate path must differ from checkout path');
  const config = {
    action,
    output: requireOption(options, '--output'),
    fixture: options['--fixture'],
    expectedState: optionalOption(
      options,
      '--expected-state',
      env.CHECKOUT_GATE_EXPECTED_STATE || 'active'
    ),
    confirmation: options['--confirm'],
    region: from('region', 'AWS_REGION', 'us-east-1'),
    loadBalancerArn: assertArn(
      from('loadBalancerArn', 'CHECKOUT_GATE_LOAD_BALANCER_ARN'),
      'CHECKOUT_GATE_LOAD_BALANCER_ARN'
    ),
    httpRuleArn: assertArn(
      from('httpRuleArn', 'CHECKOUT_GATE_HTTP_RULE_ARN'),
      'CHECKOUT_GATE_HTTP_RULE_ARN'
    ),
    httpsRuleArn: assertArn(
      from('httpsRuleArn', 'CHECKOUT_GATE_HTTPS_RULE_ARN'),
      'CHECKOUT_GATE_HTTPS_RULE_ARN'
    ),
    httpPriority: priority(
      from('httpPriority', 'CHECKOUT_GATE_HTTP_PRIORITY'),
      'CHECKOUT_GATE_HTTP_PRIORITY'
    ),
    httpsPriority: priority(
      from('httpsPriority', 'CHECKOUT_GATE_HTTPS_PRIORITY'),
      'CHECKOUT_GATE_HTTPS_PRIORITY'
    ),
    disabledPath,
    tagKey: from('tagKey', 'CHECKOUT_GATE_TAG_KEY', REQUIRED_TAG_KEY),
    tagValue: from('tagValue', 'CHECKOUT_GATE_TAG_VALUE', REQUIRED_TAG_VALUE),
  };
  if (!['active', 'inactive'].includes(config.expectedState)) {
    throw new Error('--expected-state must be active or inactive');
  }
  validatePinnedArnSet(config);
  if (!config.fixture && action !== 'verify') {
    const expectedConfirmation = action === 'enable' ? 'ENABLE_CHECKOUT_GATE' : 'DISABLE_CHECKOUT_GATE';
    if (config.confirmation !== expectedConfirmation) {
      throw new Error(`${action} requires --confirm ${expectedConfirmation}`);
    }
  }
  return config;
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  let outputPath;
  try {
    const preliminary = parseOptions(argv, { positionals: 1 });
    const fixture = preliminary['--fixture']
      ? readJson(preliminary['--fixture'], 'Checkout-gate fixture')
      : null;
    const config = cliConfiguration(
      argv,
      dependencies.env || process.env,
      fixture && fixture.configuration ? fixture.configuration : {}
    );
    outputPath = config.output;
    const client = dependencies.client || (fixture
      ? createFixtureGateClient(fixture)
      : createAwsGateClient({
        runAws: dependencies.runAws || createAwsCliRunner(dependencies),
        region: config.region,
        config,
      }));
    const result = config.action === 'verify'
      ? verifyGate(client, config.expectedState, config, dependencies.clock)
      : transitionGate(
        client,
        config.action === 'enable' ? 'active' : 'inactive',
        config,
        dependencies.clock
      );
    (dependencies.writeJson || writeJson)(config.output, result);
    console.log(`Checkout gate ${result.gateState}; status evidence written.`);
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
          checkedAt: nowIso(dependencies.clock),
          operation: argv[0] || 'unknown',
          gateState: error.gateState || 'unknown',
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
    console.error(`Checkout gate control failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIVE_PATH,
  ACTIVE_PATH_REGEX,
  DEFAULT_DISABLED_PATH,
  REQUIRED_TAG_KEY,
  REQUIRED_TAG_VALUE,
  cliConfiguration,
  conditionValues,
  createAwsGateClient,
  createFixtureGateClient,
  forceActive,
  gateConditions,
  inspectGate,
  main,
  parseElbv2Arn,
  transitionGate,
  validatePinnedArnSet,
  verifyGate,
};
