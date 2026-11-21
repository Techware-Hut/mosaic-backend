/**
 * Shared S3Client configuration.
 *
 * - Both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY set (non-empty after trim):
 *   explicit static credentials are passed exactly as before (raw env values),
 *   so existing deployments that use static keys behave identically.
 * - Neither set: `credentials` is omitted and the AWS SDK default credential
 *   provider chain is used (e.g. the EC2 instance profile role).
 * - Exactly one set: throws, so a half-configured environment fails closed
 *   instead of silently mixing a partial static key with another identity.
 */

const ACCESS_KEY_ENV = 'AWS_ACCESS_KEY_ID';
const SECRET_KEY_ENV = 'AWS_SECRET_ACCESS_KEY';

function isSet(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getStaticS3CredentialState(env = process.env) {
  const hasAccessKey = isSet(env[ACCESS_KEY_ENV]);
  const hasSecretKey = isSet(env[SECRET_KEY_ENV]);
  if (hasAccessKey && hasSecretKey) return 'static';
  if (!hasAccessKey && !hasSecretKey) return 'default-chain';
  return 'partial';
}

function buildS3ClientConfig(env = process.env) {
  const state = getStaticS3CredentialState(env);
  if (state === 'partial') {
    const err = new Error(
      `S3 credential configuration error: ${ACCESS_KEY_ENV} and ${SECRET_KEY_ENV} must both be set ` +
        '(static keys) or both be unset (AWS default credential chain, e.g. instance role).'
    );
    err.code = 'S3_PARTIAL_STATIC_CREDENTIALS';
    throw err;
  }

  const config = { region: env.AWS_REGION };
  if (state === 'static') {
    config.credentials = {
      accessKeyId: env[ACCESS_KEY_ENV],
      secretAccessKey: env[SECRET_KEY_ENV],
    };
  }
  return config;
}

module.exports = {
  ACCESS_KEY_ENV,
  SECRET_KEY_ENV,
  buildS3ClientConfig,
  getStaticS3CredentialState,
};
