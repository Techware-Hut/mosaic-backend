#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const FULL_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const CERTIFICATION_WORKFLOW = 'staging-release-certification.yml';
const CERTIFICATION_WORKFLOW_PATH = '.github/workflows/staging-release-certification.yml';
const CONTROLLER_WORKFLOW_PATH = '.github/workflows/staging-release-pr-controller.yml';
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
const TRUSTED_STATUS_CONTEXT = 'mosaic/trusted-staging-certification';
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_CERTIFICATE_BYTES = 512 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const REQUIRED_PRODUCTION_PROOF = Object.freeze([
  'exact-main-preflight',
  'checkout-gate-and-drain',
  'zero-active-reservations-before-and-after-deploy',
  'exact-eb-instance-and-public-release-identity',
  'health-readiness-auth-cors-and-featured-products',
]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: verify-main-release-source.js --main-sha <sha> --output <path>');
    }
    values[key.slice(2)] = value;
  }

  if (!FULL_SHA.test(values['main-sha'] || '') || !values.output) {
    throw new Error('Usage: verify-main-release-source.js --main-sha <sha> --output <path>');
  }

  return {
    mainSha: values['main-sha'].toLowerCase(),
    output: values.output,
  };
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requireFullSha(value, label) {
  if (!FULL_SHA.test(value || '')) throw new Error(`${label} must be a full SHA`);
  return value.toLowerCase();
}

function selectCanonicalReleasePullRequest(pullRequests, repository, mainSha) {
  if (!Array.isArray(pullRequests)) throw new Error('GitHub pull-request response was malformed');
  const matches = pullRequests.filter((pullRequest) => (
    pullRequest?.merged_at
    && pullRequest?.base?.ref === 'main'
    && pullRequest?.base?.repo?.full_name === repository
    && pullRequest?.head?.ref === 'staging'
    && pullRequest?.head?.repo?.full_name === repository
    && pullRequest?.merge_commit_sha?.toLowerCase() === mainSha.toLowerCase()
    && FULL_SHA.test(pullRequest?.head?.sha || '')
    && Number.isSafeInteger(pullRequest?.number)
    && pullRequest.number > 0
  ));

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one merged canonical staging-to-main pull request for ${mainSha}; found ${matches.length}`
    );
  }

  return matches[0];
}

function selectExactCertificationRun(runs, repository, sourceSha) {
  if (!Array.isArray(runs)) throw new Error('GitHub workflow-runs response was malformed');
  const matches = runs.filter((run) => (
    run?.event === 'push'
    && run?.head_branch === 'staging'
    && run?.head_sha?.toLowerCase() === sourceSha.toLowerCase()
    && run?.head_repository?.full_name === repository
    && run?.path === CERTIFICATION_WORKFLOW_PATH
    && run?.status === 'completed'
    && run?.conclusion === 'success'
    && Number.isSafeInteger(run?.id)
    && run.id > 0
  ));

  if (matches.length === 0) {
    throw new Error(`No successful exact-SHA staging certification exists for ${sourceSha}`);
  }

  return matches.sort((left, right) => right.id - left.id)[0];
}

function selectExactCertificateArtifact(artifacts, sourceSha, certificationRunId) {
  if (!Array.isArray(artifacts)) throw new Error('GitHub artifacts response was malformed');
  const expectedName = `staging-certification-${sourceSha.toLowerCase()}`;
  const matches = artifacts.filter((artifact) => (
    artifact?.name === expectedName
    && artifact?.expired === false
    && Number.isSafeInteger(artifact?.id)
    && artifact.id > 0
    && (
      certificationRunId === undefined
      || (
        artifact?.workflow_run?.id === certificationRunId
        && artifact?.workflow_run?.head_sha?.toLowerCase() === sourceSha.toLowerCase()
      )
    )
  ));

  if (matches.length !== 1) {
    throw new Error(
      `Expected one unexpired ${expectedName} artifact from the selected certification run; found ${matches.length}`
    );
  }

  return matches[0];
}

function selectExactTrustedArtifact(artifacts, sourceSha, controllerRunId) {
  if (!Array.isArray(artifacts)) throw new Error('GitHub trusted-controller artifacts response was malformed');
  const expectedName = `validated-staging-release-${sourceSha.toLowerCase()}`;
  const matches = artifacts.filter((artifact) => (
    artifact?.name === expectedName
    && artifact?.expired === false
    && Number.isSafeInteger(artifact?.id)
    && artifact.id > 0
    && artifact?.workflow_run?.id === controllerRunId
  ));

  if (matches.length !== 1) {
    throw new Error(
      `Expected one unexpired ${expectedName} artifact from the trusted controller run; found ${matches.length}`
    );
  }
  return matches[0];
}

function parseCanonicalRunTarget(targetUrl, repository) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (_error) {
    throw new Error('Trusted staging status target URL was invalid');
  }
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = parsed.pathname.match(new RegExp(`^/${escapedRepository}/actions/runs/(\\d+)/?$`));
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.search || parsed.hash || !match) {
    throw new Error('Trusted staging status target was not the canonical controller run URL');
  }
  return requirePositiveInteger(Number(match[1]), 'Trusted controller run id');
}

function selectExactTrustedStatus(statuses, expected) {
  if (!Array.isArray(statuses)) throw new Error('GitHub commit statuses response was malformed');
  if (!/^[A-Za-z0-9-]+\[bot\]$/.test(expected.creator || '')) {
    throw new Error('TRUSTED_STATUS_CREATOR must be the configured GitHub App bot login');
  }
  const status = statuses.find((entry) => entry?.context === TRUSTED_STATUS_CONTEXT);
  if (!status) throw new Error('Merged staging SHA lacks the App-owned trusted certification status');
  const expectedDescription = `Certified for main ${expected.baselineSha}`;
  if (
    status.state !== 'success'
    || status.description !== expectedDescription
    || status.creator?.login !== expected.creator
    || status.creator?.type !== 'Bot'
  ) {
    throw new Error('App-owned trusted staging status identity or baseline did not match');
  }
  return {
    id: requirePositiveInteger(status.id, 'Trusted status id'),
    creator: status.creator.login,
    targetUrl: status.target_url,
    controllerRunId: parseCanonicalRunTarget(status.target_url, expected.repository),
  };
}

function validateTrustedControllerRun(run, expected) {
  if (
    run?.id !== expected.runId
    || run?.path !== CONTROLLER_WORKFLOW_PATH
    || run?.event !== 'workflow_run'
    || run?.repository?.full_name !== expected.repository
    || run?.head_repository?.full_name !== expected.repository
    || run?.head_branch !== 'main'
    || run?.head_sha?.toLowerCase() !== expected.baselineSha
    || run?.status !== 'completed'
    || run?.conclusion !== 'success'
    || run?.html_url !== expected.targetUrl
  ) {
    throw new Error('Trusted staging controller run identity or result did not match GitHub');
  }
}

function githubRequestFactory({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!token) throw new Error('GITHUB_TOKEN is required');

  return async function githubRequest(route, options = {}) {
    if (typeof route !== 'string' || !route.startsWith('/')) {
      throw new Error('GitHub API route must be repository-relative');
    }
    const response = await fetchImpl(`${apiUrl.replace(/\/$/, '')}${route}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed with HTTP ${response.status}`);
    }

    if (options.responseType === 'buffer') {
      const maximum = options.maxBytes || MAX_ARCHIVE_BYTES;
      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maximum) {
        throw new Error('Certification archive exceeded the maximum allowed size');
      }
      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          length += chunk.length;
          if (length > maximum) {
            await reader.cancel();
            throw new Error('Certification archive exceeded the maximum allowed size');
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks, length);
      } else {
        body = Buffer.from(await response.arrayBuffer());
      }
      if (body.length === 0 || body.length > maximum) {
        throw new Error('Certification archive size was invalid');
      }
      return body;
    }

    return response.json();
  };
}

async function downloadCertificateManifest({ githubRequest, repository, artifact, expectedMemberName, label }) {
  if (
    artifact.size_in_bytes !== undefined
    && (
      !Number.isSafeInteger(artifact.size_in_bytes)
      || artifact.size_in_bytes <= 0
      || artifact.size_in_bytes > MAX_ARCHIVE_BYTES
    )
  ) {
    throw new Error(`${label} artifact metadata exceeded the maximum allowed size`);
  }
  const archive = await githubRequest(
    `/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
    { responseType: 'buffer', maxBytes: MAX_ARCHIVE_BYTES }
  );
  if (!Buffer.isBuffer(archive)) {
    throw new Error(`${label} artifact download did not return a binary archive`);
  }
  if (typeof artifact.digest === 'string') {
    const archiveDigest = `sha256:${crypto.createHash('sha256').update(archive).digest('hex')}`;
    if (artifact.digest !== archiveDigest) {
      throw new Error(`${label} archive digest did not match GitHub artifact metadata`);
    }
  }
  return {
    archive,
    manifest: parseCertificateArchive(archive, expectedMemberName),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_error) {
    throw new Error(`${label} was not valid UTF-8`);
  }
}

function findEndOfCentralDirectory(archive) {
  if (archive.length < 22) throw new Error('Certification archive was malformed');
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  throw new Error('Certification archive end record was missing');
}

function validateArchiveEntryName(name, expectedName) {
  if (
    name.includes('\0')
    || name.includes('\\')
    || name.startsWith('/')
    || /^[a-z]:/i.test(name)
    || name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Certification archive contained an unsafe member path');
  }
  if (name !== expectedName) {
    throw new Error('Certification archive did not contain the one expected JSON member');
  }
}

function parseCertificateArchive(archiveValue, expectedName) {
  const archive = Buffer.isBuffer(archiveValue) ? archiveValue : Buffer.from(archiveValue || []);
  if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error('Certification archive size was invalid');
  }
  if (!/^staging-certification-[a-f0-9]{40}\.json$/.test(expectedName || '')) {
    throw new Error('Expected certification member name was invalid');
  }

  const eocd = findEndOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const totalEntries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (
    diskNumber !== 0
    || centralDisk !== 0
    || entriesOnDisk !== 1
    || totalEntries !== 1
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || centralOffset + centralSize !== eocd
    || centralOffset + 46 > eocd
  ) {
    throw new Error('Certification archive must contain exactly one non-Zip64 member');
  }

  if (archive.readUInt32LE(centralOffset) !== ZIP_CENTRAL_SIGNATURE) {
    throw new Error('Certification archive central directory was malformed');
  }
  const flags = archive.readUInt16LE(centralOffset + 8);
  const compressionMethod = archive.readUInt16LE(centralOffset + 10);
  const expectedCrc = archive.readUInt32LE(centralOffset + 16);
  const compressedSize = archive.readUInt32LE(centralOffset + 20);
  const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
  const nameLength = archive.readUInt16LE(centralOffset + 28);
  const extraLength = archive.readUInt16LE(centralOffset + 30);
  const commentLength = archive.readUInt16LE(centralOffset + 32);
  const entryDisk = archive.readUInt16LE(centralOffset + 34);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  const centralEnd = centralOffset + 46 + nameLength + extraLength + commentLength;
  if (
    centralEnd !== eocd
    || entryDisk !== 0
    || localOffset === 0xffffffff
    || compressedSize === 0xffffffff
    || uncompressedSize === 0xffffffff
    || uncompressedSize === 0
    || uncompressedSize > MAX_CERTIFICATE_BYTES
    || compressedSize > MAX_ARCHIVE_BYTES
    || (flags & 0x0001) !== 0
    || (flags & ~0x080e) !== 0
    || ![0, 8].includes(compressionMethod)
    || localOffset !== 0
  ) {
    throw new Error('Certification archive member metadata was invalid');
  }
  if (compressedSize === 0 || uncompressedSize > (compressedSize * 100) + 1024) {
    throw new Error('Certification archive member compression ratio was unsafe');
  }

  const memberName = decodeUtf8(
    archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength),
    'Certification archive member name'
  );
  validateArchiveEntryName(memberName, expectedName);

  if (localOffset + 30 > centralOffset || archive.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error('Certification archive local member header was malformed');
  }
  const localFlags = archive.readUInt16LE(localOffset + 6);
  const localMethod = archive.readUInt16LE(localOffset + 8);
  const localNameLength = archive.readUInt16LE(localOffset + 26);
  const localExtraLength = archive.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataOffset + compressedSize;
  if (localFlags !== flags || localMethod !== compressionMethod || dataEnd > centralOffset) {
    throw new Error('Certification archive local member metadata did not match');
  }
  if (
    (flags & 0x0008) === 0
    && (
      archive.readUInt32LE(localOffset + 14) !== expectedCrc
      || archive.readUInt32LE(localOffset + 18) !== compressedSize
      || archive.readUInt32LE(localOffset + 22) !== uncompressedSize
    )
  ) {
    throw new Error('Certification archive local member integrity metadata did not match');
  }
  const localName = decodeUtf8(
    archive.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    'Certification archive local member name'
  );
  if (localName !== memberName) throw new Error('Certification archive member names did not match');

  const compressed = archive.subarray(dataOffset, dataEnd);
  let certificateBytes;
  try {
    certificateBytes = compressionMethod === 0
      ? Buffer.from(compressed)
      : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_CERTIFICATE_BYTES + 1 });
  } catch (_error) {
    throw new Error('Certification archive member could not be decompressed');
  }
  if (
    certificateBytes.length !== uncompressedSize
    || certificateBytes.length > MAX_CERTIFICATE_BYTES
    || crc32(certificateBytes) !== expectedCrc
  ) {
    throw new Error('Certification archive member integrity check failed');
  }

  const certificateText = decodeUtf8(certificateBytes, 'Certification document');
  if (certificateText.charCodeAt(0) === 0xfeff) {
    throw new Error('Certification document must not contain a byte-order mark');
  }
  let manifest;
  try {
    manifest = JSON.parse(certificateText);
  } catch (_error) {
    throw new Error('Certification document was not valid JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Certification document must contain one JSON object');
  }
  if (`${JSON.stringify(manifest, null, 2)}\n` !== certificateText) {
    throw new Error('Certification document was not in canonical JSON form');
  }
  return manifest;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
}

function requireSafeRelativePaths(value, label) {
  requireStringArray(value, label);
  for (const entry of value) {
    if (
      entry.length === 0
      || entry.includes('\0')
      || entry.includes('\\')
      || entry.startsWith('/')
      || /^[a-z]:/i.test(entry)
      || entry.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) {
      throw new Error(`${label} contained an unsafe repository path`);
    }
  }
}

function validateCertificateManifest(manifest, expected) {
  if (manifest.schemaVersion !== 1) throw new Error('Certification schemaVersion must be 1');
  if (manifest.repository !== expected.repository) throw new Error('Certification repository did not match');
  if (manifest.sourceBranch !== 'staging' || manifest.targetBranch !== 'main') {
    throw new Error('Certification source/target branches did not match');
  }
  if (manifest.candidateSha !== expected.sourceSha) {
    throw new Error('Certification candidate SHA did not match the merged staging SHA');
  }
  if (manifest.mainSha !== expected.baselineSha) {
    throw new Error('Certification main baseline did not match the canonical merge parent');
  }
  requireFullSha(manifest.mergeBase, 'Certification mergeBase');
  requireFullSha(manifest.promotionBaseline, 'Certification promotionBaseline');
  if (!['main-ancestor', 'promotion-merge-wrapper'].includes(manifest.provenance)) {
    throw new Error('Certification provenance was invalid');
  }
  if (
    manifest.provenance === 'main-ancestor'
    && (manifest.mergeBase !== expected.baselineSha || manifest.promotionBaseline !== expected.baselineSha)
  ) {
    throw new Error('Certification main-ancestor provenance was inconsistent');
  }
  if (!Number.isFinite(Date.parse(manifest.generatedAt || ''))) {
    throw new Error('Certification generatedAt was invalid');
  }
  if (!Array.isArray(manifest.commits) || !Array.isArray(manifest.changedFiles)) {
    throw new Error('Certification change inventory was malformed');
  }
  for (const commit of manifest.commits) {
    if (
      !commit
      || typeof commit !== 'object'
      || !FULL_SHA.test(commit.sha || '')
      || typeof commit.subject !== 'string'
      || commit.subject.length === 0
    ) {
      throw new Error('Certification commit inventory was malformed');
    }
  }
  requireSafeRelativePaths(manifest.changedFiles, 'Certification changedFiles');
  if (
    !Array.isArray(manifest.sourcePrs)
    || manifest.sourcePrs.some((number) => !Number.isSafeInteger(number) || number <= 0)
  ) {
    throw new Error('Certification sourcePrs was malformed');
  }
  requireStringArray(manifest.requiredProductionProof, 'Certification requiredProductionProof');
  requireStringArray(manifest.productionUat, 'Certification productionUat');
  if (
    !manifest.riskSignals
    || typeof manifest.riskSignals !== 'object'
    || typeof manifest.riskSignals.paymentSensitive !== 'boolean'
    || typeof manifest.riskSignals.emailSensitive !== 'boolean'
    || typeof manifest.riskSignals.inventorySensitive !== 'boolean'
    || typeof manifest.riskSignals.mixedVersionSafe !== 'boolean'
  ) {
    throw new Error('Certification riskSignals were missing');
  }
  requireSafeRelativePaths(manifest.riskSignals.sensitiveFiles, 'Certification sensitiveFiles');
  requireSafeRelativePaths(manifest.riskSignals.migrationsOrSchema, 'Certification migrationsOrSchema');
  if (
    !manifest.rollback
    || manifest.rollback.previousMainSha !== expected.baselineSha
    || typeof manifest.rollback.note !== 'string'
    || manifest.rollback.note.length === 0
  ) {
    throw new Error('Certification rollback declaration was invalid');
  }
  if (new Set(manifest.requiredProductionProof).size !== manifest.requiredProductionProof.length) {
    throw new Error('Certification requiredProductionProof contained duplicates');
  }
  for (const proof of REQUIRED_PRODUCTION_PROOF) {
    if (!manifest.requiredProductionProof.includes(proof)) {
      throw new Error('Certification requiredProductionProof was incomplete');
    }
  }
  if (manifest.productionAccepted !== false) {
    throw new Error('Staging certification must not claim production acceptance');
  }

  const ci = manifest.ci;
  if (
    !ci
    || ci.workflow !== 'ci.yml'
    || ci.event !== 'push'
    || ci.branch !== 'staging'
    || ci.conclusion !== 'success'
  ) {
    throw new Error('Certification exact-CI declaration was invalid');
  }
  requirePositiveInteger(ci.workflowId, 'Certification CI workflowId');
  requirePositiveInteger(ci.runId, 'Certification CI runId');
  requirePositiveInteger(ci.runAttempt, 'Certification CI runAttempt');
  if (typeof ci.runUrl !== 'string' || ci.runUrl.length === 0) {
    throw new Error('Certification CI runUrl was invalid');
  }

  if (!SHA256.test(manifest.contentSha256 || '')) {
    throw new Error('Certification contentSha256 was invalid');
  }
  const payload = { ...manifest };
  delete payload.contentSha256;
  const expectedHash = crypto
    .createHash('sha256')
    .update(`${JSON.stringify(payload, null, 2)}\n`)
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(manifest.contentSha256, 'hex'), Buffer.from(expectedHash, 'hex'))) {
    throw new Error('Certification contentSha256 did not match its canonical payload');
  }

  return {
    schemaVersion: manifest.schemaVersion,
    contentSha256: manifest.contentSha256,
    mainBaselineSha: manifest.mainSha,
    ciRunId: ci.runId,
    ciRunAttempt: ci.runAttempt,
    ciWorkflowId: ci.workflowId,
  };
}

function validateCanonicalGitProvenance(mainCommit, sourceCommit, mainSha, sourceSha) {
  if (mainCommit?.sha?.toLowerCase() !== mainSha || sourceCommit?.sha?.toLowerCase() !== sourceSha) {
    throw new Error('GitHub returned the wrong commit identity');
  }
  if (
    !Array.isArray(mainCommit.parents)
    || mainCommit.parents.length !== 2
    || !FULL_SHA.test(mainCommit.parents[0]?.sha || '')
    || mainCommit.parents[1]?.sha?.toLowerCase() !== sourceSha
  ) {
    throw new Error('Main release was not a canonical two-parent staging merge');
  }
  const mainTree = requireFullSha(mainCommit?.tree?.sha, 'Main tree');
  const sourceTree = requireFullSha(sourceCommit?.tree?.sha, 'Staging source tree');
  if (mainTree !== sourceTree) {
    throw new Error('Main release tree differs from its certified staging source tree');
  }
  return {
    baselineSha: mainCommit.parents[0].sha.toLowerCase(),
    treeSha: mainTree,
  };
}

function validateExactCiRun(run, manifest, repository, sourceSha) {
  const ci = manifest.ci;
  if (
    run?.id !== ci.runId
    || run?.workflow_id !== ci.workflowId
    || run?.run_attempt !== ci.runAttempt
    || run?.path !== CI_WORKFLOW_PATH
    || run?.event !== 'push'
    || run?.head_branch !== 'staging'
    || run?.head_sha?.toLowerCase() !== sourceSha
    || run?.head_repository?.full_name !== repository
    || run?.status !== 'completed'
    || run?.conclusion !== 'success'
    || run?.html_url !== ci.runUrl
  ) {
    throw new Error('Certification exact CI run identity or result did not match GitHub');
  }
}

function manifestComparisonPayload(manifest) {
  const payload = structuredClone(manifest);
  delete payload.generatedAt;
  delete payload.contentSha256;
  delete payload.artifactFileSha256;
  return payload;
}

async function verifyMainReleaseSource({ repository, mainSha, githubRequest, trustedStatusCreator }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
    throw new Error('GITHUB_REPOSITORY must be owner/name');
  }
  mainSha = requireFullSha(mainSha, 'mainSha');

  const encodedMainSha = encodeURIComponent(mainSha);
  const pullRequests = await githubRequest(
    `/repos/${repository}/commits/${encodedMainSha}/pulls?per_page=100`
  );
  const releasePullRequest = selectCanonicalReleasePullRequest(
    pullRequests,
    repository,
    mainSha
  );
  const sourceSha = releasePullRequest.head.sha.toLowerCase();

  const mainCommit = await githubRequest(`/repos/${repository}/git/commits/${mainSha}`);
  const sourceCommit = await githubRequest(`/repos/${repository}/git/commits/${sourceSha}`);
  const provenance = validateCanonicalGitProvenance(mainCommit, sourceCommit, mainSha, sourceSha);

  const workflowRuns = await githubRequest(
    `/repos/${repository}/actions/workflows/${CERTIFICATION_WORKFLOW}/runs`
      + `?event=push&branch=staging&status=success&head_sha=${sourceSha}&per_page=100`
  );
  const certificationRun = selectExactCertificationRun(
    workflowRuns.workflow_runs || [],
    repository,
    sourceSha
  );
  const artifactResponse = await githubRequest(
    `/repos/${repository}/actions/runs/${certificationRun.id}/artifacts?per_page=100`
  );
  const certificateArtifact = selectExactCertificateArtifact(
    artifactResponse.artifacts || [],
    sourceSha,
    certificationRun.id
  );
  const expectedMemberName = `staging-certification-${sourceSha}.json`;
  const { manifest } = await downloadCertificateManifest({
    githubRequest,
    repository,
    artifact: certificateArtifact,
    expectedMemberName,
    label: 'Staging certification',
  });
  const certificate = validateCertificateManifest(manifest, {
    repository,
    sourceSha,
    baselineSha: provenance.baselineSha,
  });
  const exactCiRun = await githubRequest(`/repos/${repository}/actions/runs/${certificate.ciRunId}`);
  validateExactCiRun(exactCiRun, manifest, repository, sourceSha);

  const statuses = await githubRequest(
    `/repos/${repository}/commits/${sourceSha}/statuses?per_page=100`
  );
  const trustedStatus = selectExactTrustedStatus(statuses, {
    repository,
    sourceSha,
    baselineSha: provenance.baselineSha,
    creator: trustedStatusCreator,
  });
  const controllerRun = await githubRequest(
    `/repos/${repository}/actions/runs/${trustedStatus.controllerRunId}`
  );
  validateTrustedControllerRun(controllerRun, {
    runId: trustedStatus.controllerRunId,
    targetUrl: trustedStatus.targetUrl,
    repository,
    baselineSha: provenance.baselineSha,
  });
  const trustedArtifactsResponse = await githubRequest(
    `/repos/${repository}/actions/runs/${trustedStatus.controllerRunId}/artifacts?per_page=100`
  );
  const trustedArtifact = selectExactTrustedArtifact(
    trustedArtifactsResponse.artifacts || [],
    sourceSha,
    trustedStatus.controllerRunId
  );
  const { manifest: trustedManifest } = await downloadCertificateManifest({
    githubRequest,
    repository,
    artifact: trustedArtifact,
    expectedMemberName,
    label: 'Trusted controller certification',
  });
  const trustedCertificate = validateCertificateManifest(trustedManifest, {
    repository,
    sourceSha,
    baselineSha: provenance.baselineSha,
  });
  validateExactCiRun(exactCiRun, trustedManifest, repository, sourceSha);
  if (
    JSON.stringify(manifestComparisonPayload(trustedManifest))
    !== JSON.stringify(manifestComparisonPayload(manifest))
  ) {
    throw new Error('Trusted controller certificate did not match the staging certificate payload');
  }

  return {
    repository,
    mainSha,
    sourceStagingSha: sourceSha,
    mainBaselineSha: provenance.baselineSha,
    tree: provenance.treeSha,
    releasePullRequest: {
      number: releasePullRequest.number,
      url: releasePullRequest.html_url,
    },
    stagingCertification: {
      workflow: CERTIFICATION_WORKFLOW_PATH,
      runId: certificationRun.id,
      runUrl: certificationRun.html_url,
      artifactName: certificateArtifact.name,
      artifactId: certificateArtifact.id,
      schemaVersion: certificate.schemaVersion,
      contentSha256: certificate.contentSha256,
      exactCiRunId: certificate.ciRunId,
      exactCiRunAttempt: certificate.ciRunAttempt,
    },
    trustedControllerCertification: {
      context: TRUSTED_STATUS_CONTEXT,
      statusId: trustedStatus.id,
      creator: trustedStatus.creator,
      runId: trustedStatus.controllerRunId,
      runUrl: trustedStatus.targetUrl,
      workflow: CONTROLLER_WORKFLOW_PATH,
      artifactName: trustedArtifact.name,
      artifactId: trustedArtifact.id,
      contentSha256: trustedCertificate.contentSha256,
    },
  };
}

function verifyTreeIdentity(mainSha, sourceSha, baselineSha) {
  const fetchShas = [mainSha, sourceSha];
  if (baselineSha) fetchShas.push(baselineSha);
  execFileSync('git', ['fetch', '--no-tags', 'origin', ...fetchShas], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const mainTree = execFileSync('git', ['rev-parse', `${mainSha}^{tree}`], {
    encoding: 'utf8',
  }).trim();
  const sourceTree = execFileSync('git', ['rev-parse', `${sourceSha}^{tree}`], {
    encoding: 'utf8',
  }).trim();
  if (mainTree !== sourceTree) {
    throw new Error('Main release tree differs from its certified staging source tree');
  }
  if (baselineSha) {
    const parentLine = execFileSync('git', ['rev-list', '--parents', '-n', '1', mainSha], {
      encoding: 'utf8',
    }).trim().split(/\s+/);
    if (
      parentLine.length !== 3
      || parentLine[1].toLowerCase() !== baselineSha.toLowerCase()
      || parentLine[2].toLowerCase() !== sourceSha.toLowerCase()
    ) {
      throw new Error('Local main release provenance did not match the certified canonical merge');
    }
  }
  return mainTree;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const githubRequest = githubRequestFactory({
    token: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
  });
  const result = await verifyMainReleaseSource({
    repository: process.env.GITHUB_REPOSITORY,
    mainSha: args.mainSha,
    githubRequest,
    trustedStatusCreator: process.env.TRUSTED_STATUS_CREATOR,
  });
  verifyTreeIdentity(result.mainSha, result.sourceStagingSha, result.mainBaselineSha);

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`Verified canonical staging and App-owned controller certificates for main ${args.mainSha}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Main release-source verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CERTIFICATION_WORKFLOW,
  CERTIFICATION_WORKFLOW_PATH,
  CONTROLLER_WORKFLOW_PATH,
  CI_WORKFLOW_PATH,
  TRUSTED_STATUS_CONTEXT,
  MAX_ARCHIVE_BYTES,
  MAX_CERTIFICATE_BYTES,
  crc32,
  githubRequestFactory,
  parseArgs,
  parseCertificateArchive,
  selectCanonicalReleasePullRequest,
  selectExactCertificationRun,
  selectExactCertificateArtifact,
  selectExactTrustedArtifact,
  selectExactTrustedStatus,
  validateCanonicalGitProvenance,
  validateCertificateManifest,
  validateExactCiRun,
  validateTrustedControllerRun,
  verifyMainReleaseSource,
  verifyTreeIdentity,
};
