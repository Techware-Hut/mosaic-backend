const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildS3ClientConfig,
  getStaticS3CredentialState,
} = require('../../utils/s3ClientConfig');
const { getMissingS3UploadEnvNames } = require('../../utils/uploadDiagnostics');

// Fake, obviously non-real values assembled at runtime so no credential-like
// literal appears in source.
const fakeAccessKey = ['fake', 'access', 'id'].join('-');
const fakeSecretKey = ['fake', 'secret', 'value'].join('-');

test('both static keys set -> explicit credentials passed through unchanged', () => {
  const env = {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: fakeAccessKey,
    AWS_SECRET_ACCESS_KEY: fakeSecretKey,
  };
  assert.equal(getStaticS3CredentialState(env), 'static');
  assert.deepEqual(buildS3ClientConfig(env), {
    region: 'us-east-1',
    credentials: { accessKeyId: fakeAccessKey, secretAccessKey: fakeSecretKey },
  });
});

test('neither key set -> no credentials key (AWS default credential chain)', () => {
  for (const env of [
    { AWS_REGION: 'us-east-1' },
    { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '   ' },
  ]) {
    const config = buildS3ClientConfig(env);
    assert.equal(getStaticS3CredentialState(env), 'default-chain');
    assert.deepEqual(config, { region: 'us-east-1' });
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'credentials'), false);
  }
});

test('exactly one key set -> throws a clear config error (fail closed)', () => {
  for (const env of [
    { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: fakeAccessKey },
    { AWS_REGION: 'us-east-1', AWS_SECRET_ACCESS_KEY: fakeSecretKey },
    { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: fakeAccessKey, AWS_SECRET_ACCESS_KEY: ' ' },
  ]) {
    assert.equal(getStaticS3CredentialState(env), 'partial');
    assert.throws(
      () => buildS3ClientConfig(env),
      (err) => {
        assert.equal(err.code, 'S3_PARTIAL_STATIC_CREDENTIALS');
        assert.match(err.message, /AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set/);
        // Never echo the configured value back.
        assert.equal(err.message.includes(fakeAccessKey), false);
        assert.equal(err.message.includes(fakeSecretKey), false);
        return true;
      }
    );
  }
});

test('upload diagnostics: unset keys are not an error; partial keys are reported', () => {
  const base = { AWS_REGION: 'us-east-1', AWS_S3_BUCKET: 'bucket' };
  assert.deepEqual(getMissingS3UploadEnvNames(base), []);
  assert.deepEqual(
    getMissingS3UploadEnvNames({ ...base, AWS_ACCESS_KEY_ID: fakeAccessKey, AWS_SECRET_ACCESS_KEY: fakeSecretKey }),
    []
  );
  assert.deepEqual(
    getMissingS3UploadEnvNames({ ...base, AWS_ACCESS_KEY_ID: fakeAccessKey }),
    ['AWS_SECRET_ACCESS_KEY']
  );
  assert.deepEqual(getMissingS3UploadEnvNames({}), ['AWS_REGION', 'AWS_S3_BUCKET']);
});

function collectJsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('no controller/util constructs S3Client with inline env credentials', () => {
  const root = path.join(__dirname, '..', '..');
  const files = [
    ...collectJsFiles(path.join(root, 'controllers')),
    ...collectJsFiles(path.join(root, 'utils')),
  ];
  const offenders = [];
  const s3ClientUsers = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/new\s+S3Client\s*\(/.test(src)) continue;
    s3ClientUsers.push(path.relative(root, file));
    if (/accessKeyId\s*:\s*process\.env\.AWS_ACCESS_KEY_ID/.test(src) ||
        /secretAccessKey\s*:\s*process\.env\.AWS_SECRET_ACCESS_KEY/.test(src) ||
        !/new\s+S3Client\s*\(\s*buildS3ClientConfig\s*\(/.test(src)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.ok(s3ClientUsers.length >= 7, `expected S3Client users, found ${s3ClientUsers.length}`);
  assert.deepEqual(offenders, []);
});
