const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redactValue,
  redactObject,
  buildChangeSummary,
  sanitizeNote,
  isSensitiveFieldName,
} = require('../../utils/audit/redaction');

test('redaction masks sensitive field names and values', () => {
  assert.equal(isSensitiveFieldName('passwordHash'), true);
  assert.equal(isSensitiveFieldName('otp'), true);
  assert.equal(isSensitiveFieldName('stripeSecretKey'), true);
  assert.equal(isSensitiveFieldName('isBlocked'), false);

  assert.equal(redactValue('password', 'secret123'), '[REDACTED]');
  assert.equal(redactValue('isBlocked', true), true);
});

test('buildChangeSummary excludes sensitive fields from field list', () => {
  const summary = buildChangeSummary({
    before: { isBlocked: false, passwordHash: 'hash' },
    after: { isBlocked: true, passwordHash: 'hash2' },
    fields: ['isBlocked', 'passwordHash'],
  });

  assert.deepEqual(summary.fields, ['isBlocked']);
  assert.equal(summary.before.isBlocked, false);
  assert.equal(summary.after.isBlocked, true);
  assert.equal(summary.before.passwordHash, undefined);
});

test('redactObject truncates long strings', () => {
  const longText = 'a'.repeat(200);
  const output = redactObject({ note: longText });
  assert.ok(output.note.endsWith('...'));
  assert.ok(output.note.length <= 120);
});

test('sanitizeNote trims and caps note length', () => {
  assert.equal(sanitizeNote('  hello  '), 'hello');
  assert.equal(sanitizeNote(null), null);
  assert.ok(sanitizeNote('x'.repeat(600)).length <= 500);
});
