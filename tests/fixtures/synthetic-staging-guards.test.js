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

const SECRET = 'n0t-a-real-pass';

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
    MONGODB_URI: `mongodb+srv://qa_user:${SECRET}@cluster0.example.test/mbh_fixture_db?retryWrites=true`,
    FIXTURE_ALLOWED_DB_HOSTS: 'cluster0.example.test',
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

test('parseMongoTarget rejects non-mongo URIs', () => {
  assert.throws(() => parseMongoTarget('https://example.test/db'), /not a mongodb/);
  assert.throws(() => parseMongoTarget(''), /not set/);
});

test('all guards pass with a complete staging configuration', () => {
  const target = assertPreconditions({ env: goodEnv(), emails: EMAILS });
  assert.deepEqual(target, { hosts: ['cluster0.example.test'], dbName: 'mbh_fixture_db' });
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
        MONGODB_URI: 'mongodb://h1.example.test,other.example.test/mbh_fixture_db',
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
  assert.equal(parseArgs(['--cleanup']).mode, 'cleanup');
  assert.throws(() => parseArgs(['--apply', '--cleanup']));
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

test('main refuses --apply without a fixture password', async () => {
  const out = [];
  const capture = (line) => out.push(String(line));
  const code = await main({ argv: ['--apply'], env: goodEnv(), log: capture, error: capture });
  assert.equal(code, 2);
  assert.match(out.join('\n'), /FIXTURE_PASSWORD/);
});
