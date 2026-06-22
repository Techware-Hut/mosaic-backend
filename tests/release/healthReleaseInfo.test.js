const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const healthRoutes = require('../../routes/healthRoutes');
const {
  getPublicReleaseInfo,
  isLikelySafePublicReleasePayload,
} = require('../../utils/releaseIdentity');

async function withHealthApp(run) {
  const app = express();
  app.use('/api', healthRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('health and build-info expose safe release metadata without breaking core fields', async () => {
  await withHealthApp(async (baseUrl) => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.service, 'mosaic-backend');
    assert.ok(health.release);
    assert.equal(typeof health.release.commit, 'string');
    assert.equal(typeof health.release.environment, 'string');
    assert.equal(typeof health.release.deploymentVersion, 'string');
    assert.equal(isLikelySafePublicReleasePayload(health.release), true);

    const buildInfoRes = await fetch(`${baseUrl}/api/build-info`);
    assert.equal(buildInfoRes.status, 200);
    const buildInfo = await buildInfoRes.json();
    assert.deepEqual(buildInfo.release, getPublicReleaseInfo());
  });
});

test('ready preserves database status fields and adds release metadata', async () => {
  const originalReadyState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    get() {
      return 1;
    },
  });

  try {
    await withHealthApp(async (baseUrl) => {
      const readyRes = await fetch(`${baseUrl}/api/ready`);
      assert.equal(readyRes.status, 200);
      const ready = await readyRes.json();
      assert.equal(ready.status, 'ready');
      assert.equal(ready.database, 'connected');
      assert.ok(ready.release);
    });
  } finally {
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      value: originalReadyState,
    });
  }
});
