'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  CERTIFICATION_WORKFLOW_PATH,
  CONTROLLER_WORKFLOW_PATH,
  CI_WORKFLOW_PATH,
  TRUSTED_STATUS_CONTEXT,
  crc32,
  parseCertificateArchive,
  verifyMainReleaseSource,
} = require('../../scripts/release/verify-main-release-source');

const repository = 'Techware-Hut/mosaic-backend';
const mainSha = 'a'.repeat(40);
const sourceSha = 'b'.repeat(40);
const baselineSha = 'c'.repeat(40);
const treeSha = 'd'.repeat(40);
const ciRunId = 701;
const certificationRunId = 801;
const controllerRunId = 802;
const artifactId = 901;
const trustedArtifactId = 902;
const trustedStatusId = 1001;
const trustedStatusCreator = 'mosaic-release-automation[bot]';
const expectedMemberName = `staging-certification-${sourceSha}.json`;

function withContentHash(payload) {
  const manifest = structuredClone(payload);
  manifest.contentSha256 = crypto
    .createHash('sha256')
    .update(`${JSON.stringify(manifest, null, 2)}\n`)
    .digest('hex');
  return manifest;
}

function certificateManifest(overrides = {}) {
  const manifest = {
    schemaVersion: 1,
    repository,
    sourceBranch: 'staging',
    targetBranch: 'main',
    candidateSha: sourceSha,
    mainSha: baselineSha,
    mergeBase: baselineSha,
    promotionBaseline: baselineSha,
    provenance: 'main-ancestor',
    generatedAt: '2026-08-13T20:00:00.000Z',
    ci: {
      workflow: 'ci.yml',
      event: 'push',
      branch: 'staging',
      workflowId: 41,
      runId: ciRunId,
      runAttempt: 1,
      runUrl: `https://github.com/${repository}/actions/runs/${ciRunId}`,
      conclusion: 'success',
    },
    commits: [{ sha: sourceSha, subject: 'Certified release' }],
    changedFiles: ['src/example.js'],
    sourcePrs: [370],
    riskSignals: {
      sensitiveFiles: [],
      migrationsOrSchema: [],
      paymentSensitive: false,
      emailSensitive: false,
      inventorySensitive: false,
      mixedVersionSafe: false,
    },
    rollback: {
      previousMainSha: baselineSha,
      note: 'Keep checkout gated during rollback.',
    },
    requiredProductionProof: [
      'exact-main-preflight',
      'checkout-gate-and-drain',
      'zero-active-reservations-before-and-after-deploy',
      'exact-eb-instance-and-public-release-identity',
      'health-readiness-auth-cors-and-featured-products',
    ],
    productionUat: [],
    productionAccepted: false,
    ...overrides,
  };
  return withContentHash(manifest);
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body, 'utf8');
    const checksum = crc32(body);
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + body.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  return Buffer.concat([localSection, centralSection, eocd]);
}

function certificateArchive(manifest, memberName = expectedMemberName) {
  return createStoredZip([{
    name: memberName,
    body: `${JSON.stringify(manifest, null, 2)}\n`,
  }]);
}

function pullRequest() {
  return {
    number: 273,
    html_url: `https://github.com/${repository}/pull/273`,
    merged_at: '2026-08-13T20:35:47Z',
    merge_commit_sha: mainSha,
    base: { ref: 'main', sha: baselineSha, repo: { full_name: repository } },
    head: { ref: 'staging', sha: sourceSha, repo: { full_name: repository } },
  };
}

function certificationRun(overrides = {}) {
  return {
    id: certificationRunId,
    html_url: `https://github.com/${repository}/actions/runs/${certificationRunId}`,
    path: CERTIFICATION_WORKFLOW_PATH,
    event: 'push',
    head_branch: 'staging',
    head_sha: sourceSha,
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function exactCiRun(manifest, overrides = {}) {
  return {
    id: ciRunId,
    workflow_id: manifest.ci.workflowId,
    run_attempt: manifest.ci.runAttempt,
    html_url: manifest.ci.runUrl,
    path: CI_WORKFLOW_PATH,
    event: 'push',
    head_branch: 'staging',
    head_sha: sourceSha,
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function trustedStatus(overrides = {}) {
  return {
    id: trustedStatusId,
    state: 'success',
    context: TRUSTED_STATUS_CONTEXT,
    description: `Certified for main ${baselineSha}`,
    target_url: `https://github.com/${repository}/actions/runs/${controllerRunId}`,
    creator: { login: trustedStatusCreator, type: 'Bot' },
    ...overrides,
  };
}

function controllerRun(overrides = {}) {
  return {
    id: controllerRunId,
    html_url: `https://github.com/${repository}/actions/runs/${controllerRunId}`,
    path: CONTROLLER_WORKFLOW_PATH,
    event: 'workflow_run',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    head_branch: 'main',
    head_sha: baselineSha,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function githubFixture({
  manifest = certificateManifest(),
  trustedManifest = manifest,
  archive,
  trustedArchive,
  runOverrides,
  artifactOverrides,
  ciOverrides,
  statusOverrides,
  controllerRunOverrides,
  trustedArtifactOverrides,
} = {}) {
  const downloaded = archive || certificateArchive(manifest);
  const trustedDownloaded = trustedArchive || certificateArchive(trustedManifest);
  const calls = [];
  const request = async (route, options = {}) => {
    calls.push({ route, options });
    if (route === `/repos/${repository}/commits/${mainSha}/pulls?per_page=100`) {
      return [pullRequest()];
    }
    if (route.startsWith(`/repos/${repository}/actions/workflows/`)) {
      return { workflow_runs: [certificationRun(runOverrides)] };
    }
    if (route === `/repos/${repository}/actions/runs/${certificationRunId}/artifacts?per_page=100`) {
      return {
        artifacts: [{
          id: artifactId,
          name: expectedMemberName.replace(/\.json$/, ''),
          expired: false,
          size_in_bytes: downloaded.length,
          digest: `sha256:${crypto.createHash('sha256').update(downloaded).digest('hex')}`,
          workflow_run: { id: certificationRunId, head_sha: sourceSha },
          ...artifactOverrides,
        }],
      };
    }
    if (route === `/repos/${repository}/actions/artifacts/${artifactId}/zip`) return downloaded;
    if (route === `/repos/${repository}/git/commits/${mainSha}`) {
      return {
        sha: mainSha,
        tree: { sha: treeSha },
        parents: [{ sha: baselineSha }, { sha: sourceSha }],
      };
    }
    if (route === `/repos/${repository}/git/commits/${sourceSha}`) {
      return { sha: sourceSha, tree: { sha: treeSha }, parents: [{ sha: baselineSha }] };
    }
    if (route === `/repos/${repository}/actions/runs/${ciRunId}`) {
      return exactCiRun(manifest, ciOverrides);
    }
    if (route === `/repos/${repository}/commits/${sourceSha}/statuses?per_page=100`) {
      return [trustedStatus(statusOverrides)];
    }
    if (route === `/repos/${repository}/actions/runs/${controllerRunId}`) {
      return controllerRun(controllerRunOverrides);
    }
    if (route === `/repos/${repository}/actions/runs/${controllerRunId}/artifacts?per_page=100`) {
      return {
        artifacts: [{
          id: trustedArtifactId,
          name: `validated-staging-release-${sourceSha}`,
          expired: false,
          size_in_bytes: trustedDownloaded.length,
          digest: `sha256:${crypto.createHash('sha256').update(trustedDownloaded).digest('hex')}`,
          workflow_run: { id: controllerRunId, head_sha: baselineSha },
          ...trustedArtifactOverrides,
        }],
      };
    }
    if (route === `/repos/${repository}/actions/artifacts/${trustedArtifactId}/zip`) {
      return trustedDownloaded;
    }
    throw new Error(`Unexpected GitHub route: ${route}`);
  };
  return { calls, request };
}

test('valid exact certificate binds artifact, baseline, trees, and exact CI run', async () => {
  const fixture = githubFixture();
  const result = await verifyMainReleaseSource({
    repository,
    mainSha,
    githubRequest: fixture.request,
    trustedStatusCreator,
  });

  assert.equal(result.sourceStagingSha, sourceSha);
  assert.equal(result.mainBaselineSha, baselineSha);
  assert.equal(result.tree, treeSha);
  assert.equal(result.stagingCertification.exactCiRunId, ciRunId);
  assert.equal(result.trustedControllerCertification.runId, controllerRunId);
  assert.equal(result.trustedControllerCertification.creator, trustedStatusCreator);
  const download = fixture.calls.find(({ route }) => route.endsWith(`/${artifactId}/zip`));
  assert.equal(download.options.responseType, 'buffer');
});

test('malformed certificate archive is rejected before JSON is trusted', async () => {
  const fixture = githubFixture({ archive: Buffer.from('not-a-zip') });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /archive (?:was malformed|end record was missing)/
  );
});

test('archive path traversal and extra members are rejected', () => {
  const body = `${JSON.stringify(certificateManifest(), null, 2)}\n`;
  assert.throws(
    () => parseCertificateArchive(
      createStoredZip([{ name: `../${expectedMemberName}`, body }]),
      expectedMemberName
    ),
    /unsafe member path/
  );
  assert.throws(
    () => parseCertificateArchive(
      createStoredZip([
        { name: expectedMemberName, body },
        { name: 'second.json', body: '{}' },
      ]),
      expectedMemberName
    ),
    /exactly one/
  );
});

test('certificate candidate SHA must equal the canonical staging merge head', async () => {
  const manifest = certificateManifest({ candidateSha: 'e'.repeat(40) });
  const fixture = githubFixture({ manifest });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /candidate SHA did not match/
  );
});

test('unknown certification schema is rejected even when its content hash is valid', async () => {
  const manifest = certificateManifest({ schemaVersion: 2 });
  const fixture = githubFixture({ manifest });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /schemaVersion must be 1/
  );
});

test('certificate main baseline must equal the first canonical merge parent', async () => {
  const wrongBaseline = 'e'.repeat(40);
  const manifest = certificateManifest({
    mainSha: wrongBaseline,
    mergeBase: wrongBaseline,
    promotionBaseline: wrongBaseline,
  });
  const fixture = githubFixture({ manifest });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /main baseline did not match/
  );
});

test('certificate canonical content hash is recomputed and enforced', async () => {
  const manifest = certificateManifest();
  manifest.changedFiles.push('src/tampered.js');
  const fixture = githubFixture({ manifest });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /contentSha256 did not match/
  );
});

test('exact CI path, event, head, and successful result are revalidated from GitHub', async () => {
  for (const ciOverrides of [
    { path: '.github/workflows/lookalike.yml' },
    { event: 'workflow_dispatch' },
    { head_sha: 'e'.repeat(40) },
    { head_branch: 'main' },
    { head_sha: 'e'.repeat(40) },
    { conclusion: 'failure' },
  ]) {
    const fixture = githubFixture({ ciOverrides });
    await assert.rejects(
      verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
      /exact CI run identity or result/
    );
  }
});

test('certification run path and artifact workflow identity fail closed', async () => {
  const wrongRun = githubFixture({ runOverrides: { path: '.github/workflows/lookalike.yml' } });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: wrongRun.request, trustedStatusCreator }),
    /No successful exact-SHA staging certification/
  );

  const wrongArtifact = githubFixture({
    artifactOverrides: { workflow_run: { id: certificationRunId + 1, head_sha: sourceSha } },
  });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: wrongArtifact.request, trustedStatusCreator }),
    /selected certification run; found 0/
  );
});

test('App-owned trusted status must match creator, result, baseline, and canonical controller URL', async () => {
  for (const statusOverrides of [
    { creator: { login: 'untrusted[bot]' } },
    { creator: { login: trustedStatusCreator, type: 'User' } },
    { state: 'failure' },
    { description: `Certified for main ${'e'.repeat(40)}` },
    { target_url: `https://github.com/${repository}/actions/runs/${controllerRunId}/jobs/1` },
  ]) {
    const fixture = githubFixture({ statusOverrides });
    await assert.rejects(
      verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
      /[Tt]rusted staging status|App-owned trusted staging status/
    );
  }
});

test('trusted controller run must be the successful canonical workflow_run', async () => {
  for (const controllerRunOverrides of [
    { path: '.github/workflows/lookalike.yml' },
    { event: 'workflow_dispatch' },
    { conclusion: 'failure' },
    { repository: { full_name: 'someone/else' } },
  ]) {
    const fixture = githubFixture({ controllerRunOverrides });
    await assert.rejects(
      verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
      /Trusted staging controller run identity or result/
    );
  }
});

test('trusted controller artifact must come from that exact run', async () => {
  const fixture = githubFixture({
    trustedArtifactOverrides: { workflow_run: { id: controllerRunId + 1, head_sha: baselineSha } },
  });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /trusted controller run; found 0/
  );
});

test('trusted reconstructed manifest must equal the independently validated staging payload', async () => {
  const trustedManifest = certificateManifest({
    changedFiles: ['src/example.js', 'src/unexpected.js'],
  });
  const fixture = githubFixture({ trustedManifest });
  await assert.rejects(
    verifyMainReleaseSource({ repository, mainSha, githubRequest: fixture.request, trustedStatusCreator }),
    /Trusted controller certificate did not match/
  );
});
