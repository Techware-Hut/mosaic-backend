const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
    'RELEASE_MANIFEST_PATH',
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

test('getPublicReleaseInfo prefers packaged manifest over stale Sentry release env', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-release-'));
  const manifestPath = path.join(tempDir, 'release-manifest.json');

  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      commit: 'feedbee1234567890abcdef1234567890abcdef1',
      environment: 'production',
      deploymentVersion: 'mosaic-feedbee1234567890abcdef1234567890abcdef1',
    })
  );

  try {
    withReleaseIdentity(
      {
        RELEASE_MANIFEST_PATH: manifestPath,
        SENTRY_RELEASE: 'mosaic-deadbee1234567890abcdef1234567890abcdef1',
        SENTRY_ENVIRONMENT: 'staging',
      },
      ({ getPublicReleaseInfo, getSentryTags }) => {
        const info = getPublicReleaseInfo();
        assert.deepEqual(info, {
          commit: 'feedbee',
          environment: 'production',
          deploymentVersion: 'mosaic-feedbee1234567890abcdef1234567890abcdef1',
        });
        assert.deepEqual(getSentryTags(), {
          deployment_version: 'mosaic-feedbee1234567890abcdef1234567890abcdef1',
          commit_sha: 'feedbee',
          environment: 'production',
        });
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
