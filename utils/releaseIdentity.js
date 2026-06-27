const fs = require('fs');
const path = require('path');

const SAFE_LABEL_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_SHA_PATTERN = /^[a-f0-9]{7,40}$/i;
const VERSION_LABEL_PATTERN = /^mosaic-[a-f0-9]{7,40}$/i;
const DEFAULT_RELEASE_MANIFEST_PATH = path.resolve(__dirname, '..', 'release-manifest.json');

function normalizeOptionalString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeCommitSha(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !SAFE_SHA_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized.toLowerCase();
}

function extractCommitFromVersionLabel(label) {
  const normalized = normalizeOptionalString(label);
  if (!normalized) return undefined;

  const mosaicMatch = normalized.match(/^mosaic-([a-f0-9]{7,40})$/i);
  if (mosaicMatch) {
    return sanitizeCommitSha(mosaicMatch[1]);
  }

  return sanitizeCommitSha(normalized);
}

function getReleaseManifestPath() {
  return normalizeOptionalString(process.env.RELEASE_MANIFEST_PATH) || DEFAULT_RELEASE_MANIFEST_PATH;
}

function readReleaseManifest() {
  try {
    const raw = fs.readFileSync(getReleaseManifestPath(), 'utf8');
    const manifest = JSON.parse(raw);
    return manifest && typeof manifest === 'object' ? manifest : {};
  } catch (_err) {
    return {};
  }
}

function getReleaseCommitSha() {
  const manifest = readReleaseManifest();

  return (
    sanitizeCommitSha(manifest.commit)
    || extractCommitFromVersionLabel(manifest.deploymentVersion)
    || sanitizeCommitSha(process.env.RELEASE_COMMIT_SHA)
    || extractCommitFromVersionLabel(process.env.DEPLOYMENT_VERSION_LABEL)
    || extractCommitFromVersionLabel(process.env.SENTRY_RELEASE)
    || 'unknown'
  );
}

function getShortReleaseCommitSha() {
  const sha = getReleaseCommitSha();
  return sha === 'unknown' ? sha : sha.slice(0, 7);
}

function getReleaseEnvironment() {
  const manifest = readReleaseManifest();

  return (
    normalizeOptionalString(manifest.environment)
    || normalizeOptionalString(process.env.RELEASE_ENVIRONMENT)
    || normalizeOptionalString(process.env.SENTRY_ENVIRONMENT)
    || normalizeOptionalString(process.env.NODE_ENV)
    || 'development'
  );
}

function getDeploymentVersionLabel() {
  const manifest = readReleaseManifest();
  const manifestVersion = normalizeOptionalString(manifest.deploymentVersion);
  if (manifestVersion && SAFE_LABEL_PATTERN.test(manifestVersion)) {
    return manifestVersion;
  }

  const explicit = normalizeOptionalString(process.env.DEPLOYMENT_VERSION_LABEL);
  if (explicit && SAFE_LABEL_PATTERN.test(explicit)) {
    return explicit;
  }

  const sentryRelease = normalizeOptionalString(process.env.SENTRY_RELEASE);
  if (sentryRelease && SAFE_LABEL_PATTERN.test(sentryRelease)) {
    return sentryRelease;
  }

  const shortSha = getShortReleaseCommitSha();
  if (shortSha !== 'unknown') {
    return `mosaic-${shortSha}`;
  }

  return 'mosaic-unknown';
}

function getSentryRelease() {
  const sentryRelease = normalizeOptionalString(process.env.SENTRY_RELEASE);
  const deploymentLabel = getDeploymentVersionLabel();

  if (deploymentLabel !== 'mosaic-unknown') {
    return deploymentLabel;
  }

  if (sentryRelease && SAFE_LABEL_PATTERN.test(sentryRelease)) {
    return sentryRelease;
  }

  return deploymentLabel;
}

function getPublicReleaseInfo() {
  return {
    commit: getShortReleaseCommitSha(),
    environment: getReleaseEnvironment(),
    deploymentVersion: getDeploymentVersionLabel(),
  };
}

function getSentryTags() {
  return {
    deployment_version: getDeploymentVersionLabel(),
    commit_sha: getShortReleaseCommitSha(),
    environment: getReleaseEnvironment(),
  };
}

function logReleaseIdentityAtStartup() {
  const info = getPublicReleaseInfo();
  console.log(
    `[release] env=${info.environment} version=${info.deploymentVersion} commit=${info.commit}`
  );
}

function isLikelySafePublicReleasePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const serialized = JSON.stringify(payload).toLowerCase();
  const forbiddenFragments = [
    'sk_live_',
    'sk_test_',
    'whsec_',
    'sentry_dsn',
    'mongodb',
    'password',
    'secret',
  ];

  return !forbiddenFragments.some((fragment) => serialized.includes(fragment));
}

module.exports = {
  VERSION_LABEL_PATTERN,
  getReleaseCommitSha,
  getShortReleaseCommitSha,
  getReleaseEnvironment,
  getDeploymentVersionLabel,
  getSentryRelease,
  getPublicReleaseInfo,
  getSentryTags,
  logReleaseIdentityAtStartup,
  isLikelySafePublicReleasePayload,
};
