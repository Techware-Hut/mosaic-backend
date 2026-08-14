#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  nowIso,
  parseOptions,
  requireOption,
  sanitizeMessage,
  writeJson,
} = require('./release-control-utils');

const LEGACY_PATH = '/create-payment-intent';
const LEGACY_MOUNT = '/api/payments';
const NON_RUNTIME_DIRECTORIES = new Set([
  '.git',
  '.github',
  'coverage',
  'docs',
  'infrastructure',
  'node_modules',
  'release',
  'scripts',
  'tests',
]);

function stripJavaScriptComments(source) {
  const text = String(source);
  let output = '';
  let index = 0;
  let quote = null;

  while (index < text.length) {
    const current = text[index];
    const next = text[index + 1];

    if (quote) {
      output += current;
      if (current === '\\') {
        if (next !== undefined) output += next;
        index += 2;
        continue;
      }
      if (current === quote) quote = null;
      index += 1;
      continue;
    }

    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output += current;
      index += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < text.length && text[index] !== '\n' && text[index] !== '\r') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        output += text[index] === '\n' || text[index] === '\r' ? text[index] : ' ';
        index += 1;
      }
      if (index < text.length) {
        output += '  ';
        index += 2;
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}

function skipTrivia(source, initialIndex) {
  let index = initialIndex;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      return newline === -1 ? source.length : skipTrivia(source, newline + 1);
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      return close === -1 ? source.length : skipTrivia(source, close + 2);
    }
    break;
  }
  return index;
}

function hasStaticStringArgument(source, initialIndex) {
  let index = skipTrivia(source, initialIndex);
  const quote = source[index];
  if (quote !== "'" && quote !== '"' && quote !== '`') return false;
  index += 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && source.startsWith('${', index)) return false;
    if (source[index] === quote) {
      index = skipTrivia(source, index + 1);
      return source[index] === ',' || source[index] === ')';
    }
    index += 1;
  }
  return false;
}

function dynamicExpressPostRegistrations(source) {
  const text = String(source);
  const outboundHttpReceivers = new Set();
  for (const match of text.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]axios['"]\s*\)/g
  )) outboundHttpReceivers.add(match[1]);
  for (const match of text.matchAll(
    /\bconst\s*\{\s*default\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*require\s*\(\s*['"]axios['"]\s*\)/g
  )) outboundHttpReceivers.add(match[1]);
  for (const match of text.matchAll(
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"]axios['"]/g
  )) outboundHttpReceivers.add(match[1]);

  const dynamic = [];
  const calls = [
    ...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(post|route)\s*\(/g),
    ...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\[\s*(['"])(post|route)\2\s*\]\s*\(/g),
  ].map((match) => ({
    receiver: match[1],
    method: match[3] || match[2],
    offset: match.index,
    argumentIndex: match.index + match[0].length,
  })).sort((left, right) => left.offset - right.offset);

  for (const call of calls) {
    // A statically imported axios client is the one known non-routing `.post`
    // surface in runtime sources. Every other POST/route registration must use
    // one literal first argument; unknown receivers fail closed intentionally.
    if (call.method === 'post' && outboundHttpReceivers.has(call.receiver)) continue;
    if (!hasStaticStringArgument(text, call.argumentIndex)) {
      dynamic.push({ receiver: call.receiver, method: call.method, offset: call.offset });
    }
  }
  return dynamic;
}

function analyzeCheckoutSurface({ appSource, paymentRoutesSource, orderRoutesSource, runtimeRouteSources, clock }) {
  const paymentsMounted = String(appSource).includes(LEGACY_MOUNT);
  const sources = Array.isArray(runtimeRouteSources)
    ? runtimeRouteSources
    : [appSource, paymentRoutesSource];
  const legacyRoutePresent = sources.some(
    (source) => String(source).toLowerCase().includes(LEGACY_PATH)
  );
  const dynamicRouteRegistrations = sources.flatMap(dynamicExpressPostRegistrations);
  const executableAppSource = stripJavaScriptComments(appSource);
  const executableOrderRoutesSource = stripJavaScriptComments(orderRoutesSource || '');
  const canonicalMountPresent = /\bapp\s*\.\s*use\s*\(\s*['"]\/api\/orders['"]\s*,\s*orderRoutes\b/i
    .test(executableAppSource);
  const canonicalRoutePresent = /\b[A-Za-z_$][\w$]*\s*\.\s*post\s*\(\s*['"]\/initiate['"]\s*,/i
    .test(executableOrderRoutesSource);
  // Retiring only the original mount is insufficient: an alternate router can
  // expose the same liability. Any runtime route definition is a release stop.
  const exclusiveCanonicalSurface = canonicalMountPresent
    && canonicalRoutePresent
    && !legacyRoutePresent
    && dynamicRouteRegistrations.length === 0;
  return {
    schemaVersion: 1,
    status: exclusiveCanonicalSurface ? 'passed' : 'blocked',
    checkedAt: nowIso(clock),
    canonicalGate: { method: 'POST', path: '/api/orders/initiate' },
    legacyPaymentSurfaceActive: legacyRoutePresent || dynamicRouteRegistrations.length > 0,
    canonicalMountPresent,
    canonicalRoutePresent,
    dynamicPostPathRegistrationCount: dynamicRouteRegistrations.length,
    paymentsMounted,
    runtimeRouteSourceCount: sources.length,
    productionMutation: false,
    nextAction: exclusiveCanonicalSurface
      ? 'Checkout initiation is exclusive to the canonical gated surface.'
      : 'Restore the exact canonical order-initiation route, retire legacy/dynamic payment routes, and reconcile outstanding issued intents before automatic cutover.',
  };
}

function collectRuntimeRouteSources(root, dependencies = {}) {
  const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const stat = dependencies.lstat || ((file) => fs.lstatSync(file));
  const readDirectory = dependencies.readDirectory
    || ((directory) => fs.readdirSync(directory, { withFileTypes: true }));
  const sources = [];
  const appPath = path.join(root, 'app.js');
  sources.push(readFile(appPath));
  const visit = (directory) => {
    for (const entry of readDirectory(directory)) {
      const absolute = path.join(directory, entry.name);
      if (stat(absolute).isSymbolicLink()) {
        throw new Error('Runtime route source must not be a symbolic link');
      }
      if (entry.isDirectory()) {
        if (!NON_RUNTIME_DIRECTORIES.has(entry.name)) visit(absolute);
      } else if (entry.isFile() && /\.(?:c?js|mjs|tsx?)$/i.test(entry.name)) {
        if (absolute === appPath) continue;
        sources.push(readFile(absolute));
      }
    }
  };
  visit(root);
  return sources;
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseOptions(argv);
  const output = requireOption(options, '--output');
  const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const root = dependencies.root
    || (options['--root'] ? path.resolve(options['--root']) : path.resolve(__dirname, '../..'));
  const runtimeRouteSources = dependencies.runtimeRouteSources
    || collectRuntimeRouteSources(root, { readFile });
  const orderRoutesSource = dependencies.orderRoutesSource
    || readFile(path.join(root, 'routes', 'orderRoutes.js'));
  const result = analyzeCheckoutSurface({
    appSource: runtimeRouteSources[0],
    paymentRoutesSource: runtimeRouteSources.find((source) => String(source).includes(LEGACY_MOUNT)) || '',
    orderRoutesSource,
    runtimeRouteSources,
    clock: dependencies.clock,
  });
  (dependencies.writeJson || writeJson)(output, result);
  if (result.status !== 'passed') {
    throw new Error('Legacy payment-intent surface prevents an exclusive checkout gate');
  }
  console.log('Checkout surface contract passed.');
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Checkout surface contract failed: ${sanitizeMessage(error)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  analyzeCheckoutSurface,
  collectRuntimeRouteSources,
  dynamicExpressPostRegistrations,
  NON_RUNTIME_DIRECTORIES,
  main,
  stripJavaScriptComments,
};
