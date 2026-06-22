const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const releaseIdentityPath = path.resolve(__dirname, '../../utils/releaseIdentity.js');

function withReleaseIdentity(envOverrides, run) {
  const saved = {};
  for (const key of [
    'RELEASE_COMMIT_SHA',
    'RELEASE_ENVIRONMENT',
    'DEPLOYMENT_VERSION_LABEL',
    'SENTRY_RELEASE',
    'SENTRY_ENVIRONMENT',
    'NODE_ENV',
  ]) {
    saved[key] = process.env[key];
  }

  for (const key of Object.keys(saved)) {
    delete process.env[key];
  }
  Object.assign(process.env, envOverrides);

  delete require.cache[releaseIdentityPath];

  try {
    return run(require(releaseIdentityPath));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    delete require.cache[releaseIdentityPath];
  }
}

test('getPublicReleaseInfo prefers explicit release env vars', () => {
  withReleaseIdentity(
    {
      RELEASE_COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
      RELEASE_ENVIRONMENT: 'production',
      DEPLOYMENT_VERSION_LABEL: 'mosaic-abcdef1',
    },
    ({ getPublicReleaseInfo, isLikelySafePublicReleasePayload }) => {
      const info = getPublicReleaseInfo();
      assert.deepEqual(info, {
        commit: 'abcdef1',
        environment: 'production',
        deploymentVersion: 'mosaic-abcdef1',
      });
      assert.equal(isLikelySafePublicReleasePayload(info), true);
    }
  );
});

test('getSentryRelease falls back to deployment label when SENTRY_RELEASE unset', () => {
  withReleaseIdentity(
    {
      DEPLOYMENT_VERSION_LABEL: 'mosaic-deadbee',
      RELEASE_ENVIRONMENT: 'staging',
    },
    ({ getSentryRelease, getSentryTags }) => {
      assert.equal(getSentryRelease(), 'mosaic-deadbee');
      assert.deepEqual(getSentryTags(), {
        deployment_version: 'mosaic-deadbee',
        commit_sha: 'deadbee',
        environment: 'staging',
      });
    }
  );
});

test('getReleaseCommitSha derives commit from SENTRY_RELEASE mosaic label', () => {
  withReleaseIdentity(
    {
      SENTRY_RELEASE: 'mosaic-1234567890abcdef1234567890abcdef123456',
    },
    ({ getShortReleaseCommitSha }) => {
      assert.equal(getShortReleaseCommitSha(), '1234567');
    }
  );
});

test('unknown commit is returned when no safe release vars are set', () => {
  withReleaseIdentity(
    {
      NODE_ENV: 'test',
    },
    ({ getPublicReleaseInfo }) => {
      assert.deepEqual(getPublicReleaseInfo(), {
        commit: 'unknown',
        environment: 'test',
        deploymentVersion: 'mosaic-unknown',
      });
    }
  );
});

test('isLikelySafePublicReleasePayload rejects secret-like fragments', () => {
  withReleaseIdentity({}, ({ isLikelySafePublicReleasePayload }) => {
    assert.equal(
      isLikelySafePublicReleasePayload({
        commit: 'abc1234',
        environment: 'production',
        deploymentVersion: 'sk_live_bad',
      }),
      false
    );
  });
});
