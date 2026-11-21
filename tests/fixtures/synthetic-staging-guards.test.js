const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GuardError,
  assertPreconditions,
  parseMongoTarget,
  parseMailAllowlist,
  isAllowlisted,
} = require('../../scripts/fixtures/lib/guards');
const { main, parseArgs } = require('../../scripts/fixtures/seed-synthetic-staging');
const { resolveDriverConnectionStringParser } = require('../../scripts/fixtures/lib/guards');
const { RELATED_DELETE_ORDER, RELATED_COLLECTIONS } = require('../../scripts/fixtures/lib/seeder');

test('related documents are deleted dependents-first and every related collection is covered', () => {
  const pos = (c) => RELATED_DELETE_ORDER.indexOf(c);
  assert.ok(pos('refunds') < pos('orders'));
  assert.ok(pos('carts') < pos('cartitems'));
  assert.deepEqual(
    [...RELATED_DELETE_ORDER].sort(),
    RELATED_COLLECTIONS.map((r) => r.collection).sort()
  );
});
const fs = require('node:fs');
const path = require('node:path');

const SECRET = 'n0t-a-real-pass';
const NL = String.fromCharCode(10);

const EMAILS = {
  buyer: 'qa+buyer@example.test',
  vendorA: 'qa+vendor-a@example.test',
  vendorB: 'qa+vendor-b@example.test',
  admin: 'qa+admin@example.test',
  foodVendor: 'qa+food@example.test',
};

function goodEnv(overrides = {}) {
  return {
    RELEASE_ENVIRONMENT: 'staging',
    FIXTURE_SEED_CONFIRM: 'synthetic-staging',
    MONGODB_URI: `mongodb+srv://qa_user:${SECRET}@cluster0.example.test/mbh_fixture_staging?retryWrites=true`,
    FIXTURE_ALLOWED_DB_HOSTS: 'cluster0.example.test',
    FIXTURE_ALLOWED_DB_NAMES: 'mbh_fixture_staging',
    MAIL_RECIPIENT_ALLOWLIST: Object.values(EMAILS).join(','),
    FIXTURE_EMAIL_BUYER: EMAILS.buyer,
    FIXTURE_EMAIL_VENDOR_A: EMAILS.vendorA,
    FIXTURE_EMAIL_VENDOR_B: EMAILS.vendorB,
    FIXTURE_EMAIL_ADMIN: EMAILS.admin,
    FIXTURE_EMAIL_FOOD_VENDOR: EMAILS.foodVendor,
    ...overrides,
  };
}

function failureCodes(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof GuardError, `expected GuardError, got ${err && err.name}`);
    return err.failures.map((f) => f.code);
  }
  assert.fail('expected the guard to refuse');
  return [];
}

test('parseMongoTarget returns hosts and db name without credentials', () => {
  const target = parseMongoTarget(
    `mongodb://u:${SECRET}@h1.example.test:27017,h2.example.test:27018/stage_db?authSource=admin`
  );
  assert.deepEqual(target.hosts, ['h1.example.test', 'h2.example.test']);
  assert.equal(target.dbName, 'stage_db');
  assert.ok(!JSON.stringify(target).includes(SECRET));
});

test('parseMongoTarget rejects malformed URIs without echoing any part of them', () => {
  for (const uri of [
    `https://u:${SECRET}@example.test/db`,
    `mongodb://u:${SECRET}@/db`,
    `mongodb+srv://u:${SECRET}@h1.example.test,h2.example.test/db`,
  ]) {
    assert.throws(
      () => parseMongoTarget(uri),
      (err) => !err.message.includes(SECRET) && !err.message.includes('example.test')
    );
  }
  assert.throws(() => parseMongoTarget(''), /not set/);
});

test('hosts are compared case-insensitively and ignore whitespace in the allowlist', () => {
  const target = assertPreconditions({
    env: goodEnv({
      MONGODB_URI: 'mongodb://CLUSTER0.Example.TEST:27017/mbh_fixture_staging',
      FIXTURE_ALLOWED_DB_HOSTS: '  Cluster0.EXAMPLE.test , other.example.test ',
    }),
    emails: EMAILS,
  });
  assert.deepEqual(target.hosts, ['cluster0.example.test']);
});

test('refuses when FIXTURE_ALLOWED_DB_NAMES is unset', () => {
  for (const value of [undefined, '', ' , ']) {
    const codes = failureCodes(() =>
      assertPreconditions({ env: goodEnv({ FIXTURE_ALLOWED_DB_NAMES: value }), emails: EMAILS })
    );
    assert.deepEqual(codes, ['DB_NAME_ALLOWLIST']);
  }
});

test('refuses a database name not exactly in FIXTURE_ALLOWED_DB_NAMES', () => {
  for (const name of ['other_staging', 'mbh_fixture2_staging', 'xmbh_fixture_staging']) {
    const codes = failureCodes(() =>
      assertPreconditions({
        env: goodEnv({ MONGODB_URI: `mongodb://cluster0.example.test/${name}` }),
        emails: EMAILS,
      })
    );
    assert.deepEqual(codes, ['DB_NAME_NOT_ALLOWED']);
  }
});

test('refuses the production database name even when the env allowlists include it', () => {
  for (const name of ['mosaic', 'Mosaic']) {
    const codes = failureCodes(() =>
      assertPreconditions({
        env: goodEnv({
          MONGODB_URI: `mongodb://cluster0.example.test/${name}`,
          FIXTURE_ALLOWED_DB_NAMES: `${name},mosaic,mbh_fixture_staging`,
        }),
        emails: EMAILS,
      })
    );
    assert.deepEqual(codes, ['DB_NAME_PRODUCTION']);
  }
});

test('refuses any database name that does not end with _staging, regardless of env allowlists', () => {
  for (const name of ['foo', 'mosaic_prod', 'mosaic_staging_old', 'staging', '_staging', 'MOSAIC_STAGING']) {
    const codes = failureCodes(() =>
      assertPreconditions({
        env: goodEnv({
          MONGODB_URI: `mongodb://cluster0.example.test/${name}`,
          FIXTURE_ALLOWED_DB_NAMES: name,
        }),
        emails: EMAILS,
      })
    );
    assert.deepEqual(codes, ['DB_NAME_NOT_STAGING'], name);
  }
});

test('allows mosaic_staging when it is allowlisted', () => {
  const target = assertPreconditions({
    env: goodEnv({
      MONGODB_URI: 'mongodb://cluster0.example.test/mosaic_staging',
      FIXTURE_ALLOWED_DB_NAMES: 'mosaic_staging',
    }),
    emails: EMAILS,
  });
  assert.equal(target.dbName, 'mosaic_staging');
});

test('all guards pass with a complete staging configuration', () => {
  const target = assertPreconditions({ env: goodEnv(), emails: EMAILS });
  assert.deepEqual(target, { hosts: ['cluster0.example.test'], dbName: 'mbh_fixture_staging' });
});

test('refuses unless RELEASE_ENVIRONMENT is exactly staging', () => {
  for (const value of [undefined, '', 'production', 'Staging', 'staging ']) {
    const codes = failureCodes(() =>
      assertPreconditions({ env: goodEnv({ RELEASE_ENVIRONMENT: value }), emails: EMAILS })
    );
    assert.deepEqual(codes, ['RELEASE_ENVIRONMENT']);
  }
});

test('refuses unless FIXTURE_SEED_CONFIRM is exactly synthetic-staging', () => {
  for (const value of [undefined, '', 'yes', 'synthetic']) {
    const codes = failureCodes(() =>
      assertPreconditions({ env: goodEnv({ FIXTURE_SEED_CONFIRM: value }), emails: EMAILS })
    );
    assert.deepEqual(codes, ['FIXTURE_SEED_CONFIRM']);
  }
});

test('refuses when FIXTURE_ALLOWED_DB_HOSTS is unset', () => {
  const codes = failureCodes(() =>
    assertPreconditions({ env: goodEnv({ FIXTURE_ALLOWED_DB_HOSTS: undefined }), emails: EMAILS })
  );
  assert.deepEqual(codes, ['DB_HOST_ALLOWLIST']);
});

test('refuses when any database host is not allowlisted', () => {
  const codes = failureCodes(() =>
    assertPreconditions({
      env: goodEnv({
        MONGODB_URI: 'mongodb://h1.example.test,other.example.test/mbh_fixture_staging',
        FIXTURE_ALLOWED_DB_HOSTS: 'h1.example.test',
      }),
      emails: EMAILS,
    })
  );
  assert.deepEqual(codes, ['DB_HOST_NOT_ALLOWED']);
});

test('refuses a URI without a database name or naming the default test database', () => {
  for (const uri of ['mongodb://cluster0.example.test', 'mongodb://cluster0.example.test/test']) {
    const codes = failureCodes(() =>
      assertPreconditions({ env: goodEnv({ MONGODB_URI: uri }), emails: EMAILS })
    );
    assert.deepEqual(codes, ['DB_NAME_REFUSED']);
  }
});

test('refuses when MAIL_RECIPIENT_ALLOWLIST is unset or has no valid entry (fail closed)', () => {
  for (const value of [undefined, '', ' , ', 'not-an-address']) {
    const codes = failureCodes(() =>
      assertPreconditions({ env: goodEnv({ MAIL_RECIPIENT_ALLOWLIST: value }), emails: EMAILS })
    );
    assert.deepEqual(codes, ['MAIL_ALLOWLIST_UNSET']);
  }
});

test('refuses when any fixture email is not allowlisted', () => {
  const codes = failureCodes(() =>
    assertPreconditions({
      env: goodEnv({ MAIL_RECIPIENT_ALLOWLIST: `${EMAILS.buyer},${EMAILS.vendorA}` }),
      emails: EMAILS,
    })
  );
  assert.deepEqual(codes, ['MAIL_NOT_ALLOWLISTED']);
});

test('domain allowlist entries match exactly, without subdomains', () => {
  const allowlist = parseMailAllowlist('@example.test');
  assert.equal(isAllowlisted('a@example.test', allowlist), true);
  assert.equal(isAllowlisted('a@qa.example.test', allowlist), false);
  assert.equal(isAllowlisted('a@example.testing', allowlist), false);
});

test('parseArgs defaults to dry-run and rejects conflicting or unknown flags', () => {
  assert.equal(parseArgs([]).mode, 'dry-run');
  assert.equal(parseArgs(['--apply']).mode, 'apply');
  assert.equal(parseArgs(['--cleanup']).mode, 'cleanup-preview');
  assert.equal(parseArgs(['--cleanup', '--dry-run']).mode, 'cleanup-preview');
  assert.equal(parseArgs(['--cleanup', '--apply']).mode, 'cleanup-apply');
  assert.equal(parseArgs(['--cleanup', '--allow-orphans-report']).allowOrphansReport, true);
  assert.throws(() => parseArgs(['--allow-orphans-report']));
  assert.throws(() => parseArgs(['--cleanup', '--apply', '--dry-run']));
  assert.throws(() => parseArgs(['--apply', '--dry-run']));
  assert.throws(() => parseArgs(['--force']));
  assert.throws(() => parseArgs(['--patterns=test']));
});

test('main refuses before connecting and never prints credentials', async () => {
  const out = [];
  const capture = (line) => out.push(String(line));
  const code = await main({
    argv: ['--apply'],
    env: goodEnv({ RELEASE_ENVIRONMENT: 'production' }),
    log: capture,
    error: capture,
  });
  assert.equal(code, 2);
  const text = out.join('\n');
  assert.match(text, /RELEASE_ENVIRONMENT/);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes('qa_user'));
});

test('main refuses when fixture emails are missing or duplicated', async () => {
  const out = [];
  const capture = (line) => out.push(String(line));
  assert.equal(
    await main({ argv: [], env: goodEnv({ FIXTURE_EMAIL_ADMIN: '' }), log: capture, error: capture }),
    2
  );
  assert.equal(
    await main({
      argv: [],
      env: goodEnv({ FIXTURE_EMAIL_ADMIN: EMAILS.buyer }),
      log: capture,
      error: capture,
    }),
    2
  );
  assert.match(out.join('\n'), /FIXTURE_EMAIL_ADMIN/);
  assert.match(out.join('\n'), /distinct/);
});

test('guards also refuse in every --cleanup mode', async () => {
  for (const argv of [['--cleanup'], ['--cleanup', '--dry-run'], ['--cleanup', '--apply']]) {
    for (const overrides of [
      { RELEASE_ENVIRONMENT: 'production' },
      { FIXTURE_SEED_CONFIRM: '' },
      { FIXTURE_ALLOWED_DB_HOSTS: 'other.example.test' },
      { FIXTURE_ALLOWED_DB_NAMES: 'other_db' },
      { MAIL_RECIPIENT_ALLOWLIST: '' },
    ]) {
      const out = [];
      const capture = (line) => out.push(String(line));
      const code = await main({ argv, env: goodEnv(overrides), log: capture, error: capture });
      assert.equal(code, 2, `${argv.join(' ')} ${JSON.stringify(overrides)}`);
      assert.match(out.join(NL), /Refusing to run/);
      assert.ok(!out.join(NL).includes(SECRET));
    }
  }
});

test('main refuses --apply without a fixture password', async () => {
  const out = [];
  const capture = (line) => out.push(String(line));
  const code = await main({ argv: ['--apply'], env: goodEnv(), log: capture, error: capture });
  assert.equal(code, 2);
  assert.match(out.join('\n'), /FIXTURE_PASSWORD/);
});

test('URI parser is the copy the mongoose-resolved mongodb driver loads, with a matching major version', () => {
  const mongooseDir = path.dirname(require.resolve('mongoose/package.json'));
  const mongodbDir = path.dirname(require.resolve('mongodb/package.json', { paths: [mongooseDir] }));
  const driverEntry = require.resolve('mongodb-connection-string-url', { paths: [mongodbDir] });

  const parser = resolveDriverConnectionStringParser();
  assert.equal(parser.mongodbDir, mongodbDir);
  assert.equal(parser.entryPath, driverEntry);
  assert.ok(parser.entryPath.startsWith(parser.packageDir + path.sep));

  // Node resolution from mongodbDir only reaches node_modules dirs on its ancestor chain.
  const parserNodeModules = path.dirname(parser.packageDir);
  assert.equal(path.basename(parserNodeModules), 'node_modules');
  assert.ok(
    (mongodbDir + path.sep).startsWith(path.dirname(parserNodeModules) + path.sep),
    'parser must sit in a node_modules on the mongodb package ancestor chain'
  );

  const parserPkg = JSON.parse(fs.readFileSync(path.join(parser.packageDir, 'package.json'), 'utf8'));
  const mongodbPkg = JSON.parse(fs.readFileSync(path.join(mongodbDir, 'package.json'), 'utf8'));
  assert.equal(parserPkg.name, 'mongodb-connection-string-url');
  const declared = mongodbPkg.dependencies['mongodb-connection-string-url'];
  const declaredMajor = Number(/(\d+)/.exec(declared)[1]);
  assert.equal(Number(parserPkg.version.split('.')[0]), declaredMajor);
});
