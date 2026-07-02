const REQUIRED_S3_UPLOAD_ENV_NAMES = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_S3_BUCKET',
];

function getMissingS3UploadEnvNames(env = process.env) {
  return REQUIRED_S3_UPLOAD_ENV_NAMES.filter((name) => {
    const value = env[name];
    return value === undefined || value === null || String(value).trim() === '';
  });
}

function buildUploadStorageConfigError(missingEnv) {
  return {
    success: false,
    code: 'UPLOAD_STORAGE_NOT_CONFIGURED',
    message: 'Upload storage is not configured. Please contact support.',
    missingEnv,
  };
}

function sanitizeUploadError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code,
    message: error?.message || 'Unknown upload error',
    statusCode: error?.$metadata?.httpStatusCode,
  };
}

function logUploadFailure(label, error, context = {}) {
  console.error(`[upload:${label}]`, {
    ...context,
    ...sanitizeUploadError(error),
  });
}

function logUploadConfigFailure(label, missingEnv, context = {}) {
  console.error(`[upload:${label}] storage configuration missing`, {
    ...context,
    missingEnv,
  });
}

function buildUploadedMediaResponse(payload) {
  const fileUrl = payload.fileUrl;
  return {
    ...payload,
    url: fileUrl,
    mediaUrl: fileUrl,
    location: fileUrl,
  };
}

module.exports = {
  REQUIRED_S3_UPLOAD_ENV_NAMES,
  buildUploadedMediaResponse,
  buildUploadStorageConfigError,
  getMissingS3UploadEnvNames,
  logUploadConfigFailure,
  logUploadFailure,
};
