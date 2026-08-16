#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FULL_SHA = /^[a-f0-9]{40}$/i;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error('Invalid production evidence arguments');
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!values.directory || !values.output || !FULL_SHA.test(values['release-sha'] || '')
      || !['success', 'failure', 'cancelled'].includes(values['job-status'])) {
    throw new Error('Directory, output, full release SHA, and job status are required');
  }
  return values;
}

function readOptionalJson(directory, name) {
  const filePath = path.join(directory, name);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function exactReleaseEvidence(file, releaseSha) {
  if (!file) return false;
  let hasReleaseIdentity = false;
  for (const key of ['releaseSha', 'expectedSha']) {
    if (file[key] !== undefined) {
      hasReleaseIdentity = true;
      if (String(file[key]).toLowerCase() !== releaseSha) return false;
    }
  }
  return hasReleaseIdentity && (file.status === undefined || file.status === 'passed');
}

function reservationProof(file) {
  return Boolean(
    file
    && file.status === 'passed'
    && file.mode === 'require-zero'
    && file.readOnly === true
    && file.activeReservationCount === 0
    && file.incompletePaidOrderCount === 0
    && file.unresolvedPaymentIntentCount === 0
  );
}

function deriveGateState(files) {
  const attempted = Boolean(files.gateAttempt || files.gateEnabled);
  const activationVerified = Boolean(
    files.gateEnabled
    && files.gateEnabled.status === 'passed'
    && files.gateEnabled.gateState === 'active'
  );
  const failureSafeAttempted = Boolean(files.gateFailureSafe);
  // manage-checkout-gate writes gateState=active on a failed transition only
  // after its own read-back has verified fail-safe recovery.
  const enabledFailureRecoveredActive = Boolean(
    files.gateEnabled
    && files.gateEnabled.status === 'failed'
    && files.gateEnabled.gateState === 'active'
  );
  const failureSafeActiveVerified = Boolean(
    files.gateFailureSafe
    && files.gateFailureSafe.gateState === 'active'
    && ['passed', 'failed'].includes(files.gateFailureSafe.status)
  );
  const finalInactiveVerified = Boolean(
    files.gateFinal
    && files.gateFinal.status === 'passed'
    && files.gateFinal.gateState === 'inactive'
  );

  let finalState;
  let finalStateVerified;
  let checkoutGate;
  if (failureSafeAttempted) {
    finalState = failureSafeActiveVerified ? 'active' : 'unknown';
    finalStateVerified = failureSafeActiveVerified;
    checkoutGate = failureSafeActiveVerified ? 'ACTIVE_VERIFIED' : 'UNKNOWN_TREAT_ACTIVE';
  } else if (enabledFailureRecoveredActive) {
    finalState = 'active';
    finalStateVerified = true;
    checkoutGate = 'ACTIVE_VERIFIED';
  } else if (finalInactiveVerified) {
    finalState = 'inactive';
    finalStateVerified = true;
    checkoutGate = 'INACTIVE_VERIFIED';
  } else if (attempted) {
    finalState = 'unknown';
    finalStateVerified = false;
    checkoutGate = 'UNKNOWN_TREAT_ACTIVE';
  } else {
    finalState = 'unknown';
    finalStateVerified = false;
    checkoutGate = 'UNKNOWN_TREAT_ACTIVE';
  }

  return {
    attempted,
    activationVerified,
    failureSafeAttempted,
    finalState,
    finalStateVerified,
    checkoutGate,
  };
}

const PREAPPROVAL_JOB_PHASES = [
  ['resolve', 'release-resolution'],
  ['exactCi', 'exact-sha-ci'],
  ['targetCheckoutSurface', 'exact-target-checkout-surface'],
  ['sourceCertificate', 'staging-source-certificate'],
  ['publicPreflight', 'public-preflight'],
  ['awsPreflight', 'aws-preflight'],
  ['readiness', 'production-readiness'],
];

function deriveWorkflowPreApproval(workflowResults) {
  if (
    !workflowResults
    || workflowResults.schemaVersion !== 1
    || !workflowResults.jobs
    || typeof workflowResults.jobs !== 'object'
    || Array.isArray(workflowResults.jobs)
  ) {
    return null;
  }
  const jobs = {};
  for (const [key] of PREAPPROVAL_JOB_PHASES) {
    const result = workflowResults.jobs[key];
    jobs[key] = ['success', 'failure', 'cancelled', 'skipped'].includes(result)
      ? result
      : 'unknown';
  }
  const normalRelease = workflowResults.normalRelease === true;
  let failurePhase = null;
  for (const [key, phase] of PREAPPROVAL_JOB_PHASES) {
    const expectedSuccess = key === 'sourceCertificate' && !normalRelease
      ? jobs[key] === 'success' || jobs[key] === 'skipped'
      : jobs[key] === 'success';
    if (!expectedSuccess) {
      failurePhase = phase;
      break;
    }
  }
  return {
    allRequiredPhasesPassed: failurePhase === null,
    failurePhase,
    normalRelease,
    jobs,
  };
}

function deriveDeploymentState(file, releaseSha) {
  const attempted = file?.deploymentAttempted === true || file?.deployment === 'success';
  const identityVerified = Boolean(
    file
    && String(file.releaseSha || '').toLowerCase() === releaseSha
    && file.versionLabel === `mosaic-${releaseSha}`
    && /^[a-f0-9]{64}$/.test(file.packageSha256 || '')
  );
  const verified = Boolean(
    attempted
    && identityVerified
    && (file.deploymentVerified === true || file.deployment === 'success')
    && (file.status === undefined || file.status === 'passed')
  );
  return {
    attempted,
    verified,
    identityVerified,
    status: file?.status || (verified ? 'passed' : attempted ? 'attempted' : 'not-reached'),
    versionLabel: file?.versionLabel || null,
    packageSha256: file?.packageSha256 || null,
    sourceTree: file?.sourceTree || null,
    packageSource: file?.packageSource || null,
    applicationVersion: file?.applicationVersion || null,
  };
}

function deriveFailurePhase(state, jobStatus) {
  if (state.releaseSafetyComplete && jobStatus === 'success') return null;
  if (state.preApprovalFailurePhase) return state.preApprovalFailurePhase;
  if (!state.preApprovalPassed) return 'production-preflight-approval-or-ref-revalidation';
  if (!state.gate.attempted || !state.gate.activationVerified) return 'checkout-gate-enable';
  if (!state.drainPassed) return 'checkout-drain';
  if (!state.reservationsBeforeZero) return 'pre-deploy-reservations';
  if (!state.deployment.attempted || !state.deployment.verified) return 'elastic-beanstalk-deploy';
  if (!state.postDeploymentPassed) return 'post-deploy-verification';
  if (!state.reservationsAfterZero) return 'post-deploy-reservations';
  if (!state.gate.finalStateVerified || state.gate.finalState !== 'inactive'
      || !state.publicUngatedPassed) return 'checkout-ungate';
  return 'evidence-finalization';
}

function buildProductionEvidence({ directory, releaseSha, jobStatus, runUrl, now = new Date() }) {
  const normalizedSha = releaseSha.toLowerCase();
  const files = {
    releaseIdentity: readOptionalJson(directory, 'release-identity.json'),
    sourceCertificate: readOptionalJson(directory, 'source-certificate.json'),
    publicPreflight: readOptionalJson(directory, 'public-preflight.json'),
    awsPreflight: readOptionalJson(directory, 'aws-preflight.json'),
    approvedTopology: readOptionalJson(directory, 'aws-approved-preflight.json'),
    workflowResults: readOptionalJson(directory, 'workflow-results.json'),
    gateAttempt: readOptionalJson(directory, 'gate-attempt.json'),
    gateEnabled: readOptionalJson(directory, 'gate-enabled.json'),
    drain: readOptionalJson(directory, 'drain-approved.json'),
    reservationsBefore: readOptionalJson(directory, 'reservations-before.json'),
    deployment: readOptionalJson(directory, 'eb-deployment.json'),
    awsDeployed: readOptionalJson(directory, 'aws-deployed.json'),
    publicDeployed: readOptionalJson(directory, 'public-deployed.json'),
    reservationsAfter: readOptionalJson(directory, 'reservations-after.json'),
    gateDisabled: readOptionalJson(directory, 'gate-disabled.json'),
    gateFinal: readOptionalJson(directory, 'gate-final.json'),
    gateFailureSafe: readOptionalJson(directory, 'gate-failure-safe.json'),
    publicUngated: readOptionalJson(directory, 'public-ungated.json'),
  };

  const gate = deriveGateState(files);
  const deployment = deriveDeploymentState(files.deployment, normalizedSha);
  const approvedTopologyPassed = exactReleaseEvidence(files.approvedTopology, normalizedSha);
  const reservationsBeforeZero = reservationProof(files.reservationsBefore);
  const reservationsAfterZero = reservationProof(files.reservationsAfter);
  const drainPassed = files.drain?.approved === true;
  const awsDeployedPassed = exactReleaseEvidence(files.awsDeployed, normalizedSha)
    && files.awsDeployed.expectedVersion === `mosaic-${normalizedSha}`;
  const publicDeployedPassed = exactReleaseEvidence(files.publicDeployed, normalizedSha)
    && files.publicDeployed.observedSha === normalizedSha;
  const publicUngatedPassed = exactReleaseEvidence(files.publicUngated, normalizedSha)
    && files.publicUngated.observedSha === normalizedSha;
  const postDeploymentPassed = awsDeployedPassed && publicDeployedPassed;

  // Reaching and passing the approved topology step is workflow-DAG evidence
  // that all required preapproval jobs succeeded before the protected
  // production job was admitted. Individual artifacts add detail when this is
  // rebuilt later in the summary job, but are not required in the job-local FS.
  const workflowPreApproval = deriveWorkflowPreApproval(files.workflowResults);
  const preApprovalPassed = workflowPreApproval
    ? workflowPreApproval.allRequiredPhasesPassed && approvedTopologyPassed
    : approvedTopologyPassed;
  const preApprovalFailurePhase = workflowPreApproval?.failurePhase || null;
  const releaseSafetyComplete = Boolean(
    preApprovalPassed
    && gate.activationVerified
    && drainPassed
    && reservationsBeforeZero
    && deployment.verified
    && postDeploymentPassed
    && reservationsAfterZero
    && gate.finalStateVerified
    && gate.finalState === 'inactive'
    && publicUngatedPassed
  );
  const released = jobStatus === 'success' && releaseSafetyComplete;
  const state = {
    preApprovalPassed,
    preApprovalFailurePhase,
    gate,
    drainPassed,
    reservationsBeforeZero,
    deployment,
    postDeploymentPassed,
    reservationsAfterZero,
    publicUngatedPassed,
    releaseSafetyComplete,
  };
  const failurePhase = deriveFailurePhase(state, jobStatus);
  const productionMutation = gate.attempted || deployment.attempted;
  const exactTestStatus = workflowPreApproval?.jobs.exactCi
    || (preApprovalPassed ? 'success' : 'unknown');

  return {
    schemaVersion: 2,
    repository: process.env.GITHUB_REPOSITORY || 'Techware-Hut/mosaic-backend',
    releaseSha: normalizedSha,
    workflowRunUrl: runUrl || null,
    generatedAt: now.toISOString(),
    workflowConclusion: jobStatus,
    status: released ? 'success' : 'blocked',
    result: released ? 'RELEASE COMPLETED' : 'BLOCKED',
    blocked: !released,
    workflowFailed: jobStatus === 'failure',
    workflowCancelled: jobStatus === 'cancelled',
    failingPhase: failurePhase,
    source: files.sourceCertificate ? {
      stagingSha: files.sourceCertificate.sourceStagingSha,
      releasePullRequest: files.sourceCertificate.releasePullRequest,
      certification: files.sourceCertificate.stagingCertification,
    } : null,
    preApproval: {
      allRequiredPhasesPassed: preApprovalPassed,
      failingPhase: preApprovalFailurePhase,
      evidenceBasis: preApprovalPassed
        ? workflowPreApproval
          ? 'exact workflow job results plus approved exact-topology evidence'
          : 'protected-production-job reachability plus approved exact-topology evidence'
        : workflowPreApproval ? 'exact workflow job results' : 'not proven',
      workflowJobs: workflowPreApproval?.jobs || null,
      exactShaTests: workflowPreApproval?.jobs.exactCi || (preApprovalPassed ? 'success' : 'unknown'),
      sourceCertificate: files.sourceCertificate
        ? 'success'
        : files.releaseIdentity?.breakGlass === true
          ? 'not-required-break-glass'
          : workflowPreApproval?.jobs.sourceCertificate || (
            preApprovalPassed ? 'success-by-job-reachability' : 'unknown'
          ),
      publicPreflight: files.publicPreflight
        ? 'success'
        : workflowPreApproval?.jobs.publicPreflight
          || (preApprovalPassed ? 'success-by-job-reachability' : 'unknown'),
      awsPreflight: files.awsPreflight?.status === 'passed'
        ? 'success'
        : workflowPreApproval?.jobs.awsPreflight
          || (preApprovalPassed ? 'success-by-job-reachability' : 'unknown'),
      productionApprovalEntered: Boolean(files.approvedTopology),
    },
    tests: {
      unit: exactTestStatus,
      contract: exactTestStatus,
      integration: exactTestStatus,
      basis: workflowPreApproval
        ? 'exact workflow job result'
        : preApprovalPassed ? 'required-job reachability' : 'not proven',
    },
    productionMutation,
    mutations: {
      checkoutGateAttempted: gate.attempted,
      deploymentAttempted: deployment.attempted,
      deploymentVerified: deployment.verified,
    },
    checkoutGate: gate.checkoutGate,
    rollbackNeeded: deployment.attempted && !releaseSafetyComplete,
    topology: files.approvedTopology ? {
      environmentState: files.approvedTopology.environmentState,
      currentVersion: files.approvedTopology.currentVersion,
      policy: files.approvedTopology.topology?.deploymentPolicy,
      minSize: files.approvedTopology.topology?.minSize,
      maxSize: files.approvedTopology.topology?.maxSize,
      instanceCount: files.approvedTopology.topology?.instanceCount,
      healthyTargetCount: files.approvedTopology.loadBalancer?.healthyTargetCount,
    } : null,
    version: files.awsDeployed?.currentVersion || deployment.versionLabel,
    deployment,
    gate: {
      mutationAttempted: gate.attempted,
      activation: gate.activationVerified ? 'verified-active' : gate.attempted ? 'not-verified' : 'not-reached',
      drainSeconds: files.drain?.drainSeconds ?? null,
      removal: files.gateDisabled?.status === 'passed' ? 'transition-verified' : 'not-verified',
      finalState: gate.finalState,
      finalStateVerified: gate.finalStateVerified,
      safetyAssumption: gate.checkoutGate === 'UNKNOWN_TREAT_ACTIVE' ? 'treat-active' : null,
      normalCheckoutRestored: publicUngatedPassed && gate.finalState === 'inactive',
    },
    reservations: {
      requiredCount: 0,
      before: files.reservationsBefore?.activeReservationCount ?? null,
      incompletePaidBefore: files.reservationsBefore?.incompletePaidOrderCount ?? null,
      unresolvedPaymentIntentsBefore: files.reservationsBefore?.unresolvedPaymentIntentCount ?? null,
      beforeVerifiedZero: reservationsBeforeZero,
      after: files.reservationsAfter?.activeReservationCount ?? null,
      incompletePaidAfter: files.reservationsAfter?.incompletePaidOrderCount ?? null,
      unresolvedPaymentIntentsAfter: files.reservationsAfter?.unresolvedPaymentIntentCount ?? null,
      afterVerifiedZero: reservationsAfterZero,
    },
    probes: {
      preflight: files.publicPreflight ? 'success' : preApprovalPassed ? 'success-by-job-reachability' : 'not-complete',
      deployed: publicDeployedPassed ? 'success' : 'not-complete',
      ungated: publicUngatedPassed ? 'success' : 'not-complete',
    },
    nextAction: released
      ? 'Perform the issue-specific production UAT checklist.'
      : gate.finalState !== 'inactive' || !gate.finalStateVerified
        ? 'Treat checkout as gated; inspect the failing phase and reconcile or rollback under break-glass control.'
        : deployment.attempted && !releaseSafetyComplete
          ? 'Reconcile the attempted deployment and rollback under break-glass control if the exact release cannot be proven healthy.'
          : releaseSafetyComplete
            ? 'Production safety proofs passed; resolve the workflow/evidence finalization failure without redeploying.'
            : 'No application deployment was attempted; resolve the failing precondition and rerun safely.',
  };
}

function renderSummary(evidence) {
  return [
    `## ${evidence.result}`,
    '',
    `- Release SHA: \`${evidence.releaseSha}\``,
    `- Failing phase: ${evidence.failingPhase || 'none'}`,
    `- Production mutation attempted: ${evidence.productionMutation ? 'YES' : 'NO'}`,
    `- Gate mutation attempted: ${evidence.gate.mutationAttempted ? 'YES' : 'NO'}`,
    `- Checkout gate: ${evidence.checkoutGate}`,
    `- Deployment attempted / verified: ${evidence.deployment.attempted ? 'YES' : 'NO'} / ${evidence.deployment.verified ? 'YES' : 'NO'}`,
    `- Current release version: ${evidence.version || 'unknown'}`,
    `- Pre-deploy reservations (verified zero): ${evidence.reservations.before ?? 'unknown'} (${evidence.reservations.beforeVerifiedZero ? 'YES' : 'NO'})`,
    `- Post-deploy reservations (verified zero): ${evidence.reservations.after ?? 'unknown'} (${evidence.reservations.afterVerifiedZero ? 'YES' : 'NO'})`,
    `- Rollback needed: ${evidence.rollbackNeeded ? 'YES' : 'NO'}`,
    `- Next action: ${evidence.nextAction}`,
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const evidence = buildProductionEvidence({
    directory: args.directory,
    releaseSha: args['release-sha'],
    jobStatus: args['job-status'],
    runUrl: args['run-url'],
  });
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const summary = renderSummary(evidence);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(summary);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Production evidence generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildProductionEvidence,
  deriveDeploymentState,
  deriveFailurePhase,
  deriveGateState,
  exactReleaseEvidence,
  parseArgs,
  readOptionalJson,
  renderSummary,
  reservationProof,
};
