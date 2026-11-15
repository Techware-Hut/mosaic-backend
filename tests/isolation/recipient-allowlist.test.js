const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyMailRecipientAllowlist,
  createMosaicTransport,
} = require('../../utils/smtpTransport');
const { sendSMS } = require('../../utils/telnyxService');

const ENV_KEYS = [
  'RELEASE_ENVIRONMENT',
  'SENTRY_ENVIRONMENT',
  'MAIL_RECIPIENT_ALLOWLIST',
  'SMS_RECIPIENT_ALLOWLIST',
  'TELNYX_API_KEY',
];

function withEnv(values, fn) {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, values);
  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  return Promise.resolve()
    .then(fn)
    .finally(restore);
}

function fakeTransporter() {
  const sent = [];
  const transporter = applyMailRecipientAllowlist({
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: 'm-1' };
    },
  });
  return { transporter, sent };
}

function captureWarnings() {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.warn = original; } };
}

const addresses = (field) => (field || []).map((entry) => entry.address);

// ── Mail ────────────────────────────────────────────────────────────────────

test('mail: exact address and @domain entries filter to/cc/bcc', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com, @test.mosaic.dev' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const info = await transporter.sendMail({
      from: 'noreply@example.com',
      to: 'QA@example.com, real.customer@gmail.com',
      cc: ['ops@test.mosaic.dev', { name: 'Vendor', address: 'vendor@realbiz.com' }],
      bcc: 'audit@elsewhere.com',
      subject: 'hi',
    });

    assert.equal(info.messageId, 'm-1');
    assert.equal(sent.length, 1);
    assert.deepEqual(addresses(sent[0].to), ['QA@example.com']);
    assert.deepEqual(addresses(sent[0].cc), ['ops@test.mosaic.dev']);
    assert.equal('bcc' in sent[0], false);
    assert.equal(sent[0].subject, 'hi');
  }));

test('mail: @domain suffix does not match look-alike domains', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: '@example.com' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const info = await transporter.sendMail({ to: ['a@notexample.com', 'b@example.com.evil.io'] });
    assert.equal(sent.length, 0);
    assert.equal(info.suppressed, true);
  }));

test('mail: all recipients filtered suppresses send, resolves, logs counts only', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const warn = captureWarnings();
    let info;
    try {
      info = await transporter.sendMail({ to: 'customer@gmail.com', cc: 'other@gmail.com' });
    } finally {
      warn.restore();
    }
    assert.equal(sent.length, 0);
    assert.equal(info.suppressed, true);
    assert.equal(warn.lines.length, 1);
    assert.match(warn.lines[0], /recipients=2, allowed=0/);
    assert.ok(!warn.lines[0].includes('@'));
  }));

test('mail: suppression honours callback-style sendMail', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const warn = captureWarnings();
    try {
      await new Promise((resolve, reject) => {
        transporter.sendMail({ to: 'customer@gmail.com' }, (err, info) => {
          if (err) return reject(err);
          assert.equal(info.suppressed, true);
          return resolve();
        });
      });
    } finally {
      warn.restore();
    }
    assert.equal(sent.length, 0);
  }));

test('mail: allowlist set but with zero valid entries fails closed', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'not-an-email, ,@' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const warn = captureWarnings();
    let info;
    try {
      info = await transporter.sendMail({ to: 'qa@example.com' });
    } finally {
      warn.restore();
    }
    assert.equal(sent.length, 0);
    assert.equal(info.suppressed, true);
  }));

test('mail: non-staging passes the original options through untouched', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'production', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const message = { to: 'customer@gmail.com', cc: 'x@y.com', subject: 's' };
    await transporter.sendMail(message);
    assert.equal(sent.length, 1);
    assert.equal(sent[0], message);
  }));

test('mail: staging with allowlist unset or blank passes through untouched', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging' }, async () => {
    const { transporter, sent } = fakeTransporter();
    const message = { to: 'customer@gmail.com' };
    await transporter.sendMail(message);
    process.env.MAIL_RECIPIENT_ALLOWLIST = '   ';
    await transporter.sendMail(message);
    assert.equal(sent.length, 2);
    assert.equal(sent[0], message);
    assert.equal(sent[1], message);
  }));

test('createMosaicTransport builds from shared SMTP config and installs the guard', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', MAIL_RECIPIENT_ALLOWLIST: 'qa@example.com' }, async () => {
    const configs = [];
    const sent = [];
    const nodemailerMock = {
      createTransport(config) {
        configs.push(config);
        return { sendMail: async (m) => { sent.push(m); return {}; }, verify: async () => true };
      },
    };
    const transporter = createMosaicTransport(nodemailerMock);
    assert.equal(configs.length, 1);
    assert.equal(typeof transporter.verify, 'function');
    const warn = captureWarnings();
    try {
      await transporter.sendMail({ to: 'customer@gmail.com' });
    } finally {
      warn.restore();
    }
    assert.equal(sent.length, 0);
  }));

test('no direct nodemailer.createTransport( call sites remain outside smtpTransport.js', () => {
  const root = path.resolve(__dirname, '../..');
  const skipDirs = new Set(['node_modules', '.git', 'tests']);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const full = path.join(dir, entry.name);
      if (full === path.join(root, 'utils', 'smtpTransport.js')) continue;
      if (fs.readFileSync(full, 'utf8').includes('nodemailer.createTransport(')) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

// ── SMS ─────────────────────────────────────────────────────────────────────
// TELNYX_API_KEY is left unset, so a pass-through returns the
// "not configured" result while a suppression returns success.

test('sms: allowlisted number passes through to the real sender', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', SMS_RECIPIENT_ALLOWLIST: '+17575550100' }, async () => {
    const result = await sendSMS({ to: '(757) 555-0100', text: 'hello' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'TELNYX_API_KEY not configured');
  }));

test('sms: non-allowlisted number is suppressed, resolves successfully, logs no number', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', SMS_RECIPIENT_ALLOWLIST: '+17575550100' }, async () => {
    const warn = captureWarnings();
    let result;
    try {
      result = await sendSMS({ to: '757-260-7200', text: 'hello' });
    } finally {
      warn.restore();
    }
    assert.deepEqual(result, { success: true, suppressed: true, status: 'suppressed' });
    assert.equal(warn.lines.length, 1);
    assert.ok(!warn.lines[0].includes('7200'));
  }));

test('sms: allowlist with zero valid entries fails closed', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging', SMS_RECIPIENT_ALLOWLIST: '7575550100, abc' }, async () => {
    const warn = captureWarnings();
    let result;
    try {
      result = await sendSMS({ to: '757-555-0100', text: 'hello' });
    } finally {
      warn.restore();
    }
    assert.equal(result.suppressed, true);
  }));

test('sms: non-staging ignores the allowlist', () =>
  withEnv({ SENTRY_ENVIRONMENT: 'production', SMS_RECIPIENT_ALLOWLIST: '+17575550100' }, async () => {
    const result = await sendSMS({ to: '757-260-7200', text: 'hello' });
    assert.equal(result.error, 'TELNYX_API_KEY not configured');
  }));

test('sms: staging with allowlist unset passes through', () =>
  withEnv({ RELEASE_ENVIRONMENT: 'staging' }, async () => {
    const result = await sendSMS({ to: '757-260-7200', text: 'hello' });
    assert.equal(result.error, 'TELNYX_API_KEY not configured');
  }));
