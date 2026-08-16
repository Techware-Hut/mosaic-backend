#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function positiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(String(value || ''))) {
    throw new Error(`${name} must be a positive integer number of seconds`);
  }
  return Number(value);
}

function validateDrainConfiguration({ drainSeconds, maxRequestSeconds, topology }) {
  const drain = positiveInteger(drainSeconds, 'CHECKOUT_DRAIN_SECONDS');
  const maximumRequest = positiveInteger(
    maxRequestSeconds,
    'CHECKOUT_MAX_REQUEST_SECONDS'
  );
  const idleTimeout = positiveInteger(
    topology?.loadBalancer?.idleTimeoutSeconds,
    'observed ALB idle timeout'
  );

  if (drain <= maximumRequest) {
    throw new Error('Checkout drain must be longer than the approved maximum application request duration');
  }
  if (drain <= idleTimeout) {
    throw new Error('Checkout drain must be longer than the observed ALB idle timeout');
  }

  return {
    drainSeconds: drain,
    maxRequestSeconds: maximumRequest,
    albIdleTimeoutSeconds: idleTimeout,
    approved: true,
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error('Usage: validate-release-drain.js --topology <json> --output <json>');
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!values.topology || !values.output) {
    throw new Error('Usage: validate-release-drain.js --topology <json> --output <json>');
  }
  return values;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const topology = JSON.parse(fs.readFileSync(args.topology, 'utf8'));
  const result = validateDrainConfiguration({
    drainSeconds: process.env.CHECKOUT_DRAIN_SECONDS,
    maxRequestSeconds: process.env.CHECKOUT_MAX_REQUEST_SECONDS,
    topology,
  });
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`Approved checkout drain: ${result.drainSeconds} seconds.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Checkout drain validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  positiveInteger,
  validateDrainConfiguration,
  parseArgs,
};
