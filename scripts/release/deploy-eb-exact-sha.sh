#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:-}"
OUTPUT_PATH="${2:-release-evidence/eb-deployment.json}"
AWS_REGION_VALUE="${AWS_REGION:-}"
EB_APPLICATION_VALUE="${EB_APPLICATION_NAME:-}"
EB_ENVIRONMENT_VALUE="${EB_ENVIRONMENT_NAME:-}"
EB_RELEASE_BUCKET_VALUE="${EB_RELEASE_BUCKET:-}"
RELEASE_MODE_VALUE="${RELEASE_MODE:-release}"
AWS_CLI="${AWS_CLI:-aws}"
APPROVED_FOCUSED_BASELINE_SHA="9bc75c257a9f483a287f122dbd38514b7a4b55d4"

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Usage: deploy-eb-exact-sha.sh <full-release-sha> [output-json]" >&2
  exit 2
fi
if [ "$RELEASE_MODE_VALUE" = "focused-baseline" ]; then
  if [ "${FOCUSED_BASELINE_SHA:-}" != "$APPROVED_FOCUSED_BASELINE_SHA" ] \
    || [[ ! "${FOCUSED_RELEASE_REF:-}" =~ ^refs/heads/release/focused/[a-z0-9]+(-[a-z0-9]+)*$ ]] \
    || [ "$RELEASE_SHA" = "$APPROVED_FOCUSED_BASELINE_SHA" ]; then
    echo "Focused target is not bound to the approved production baseline and protected ref" >&2
    exit 2
  fi
fi
if [ "$RELEASE_MODE_VALUE" = "focused-rollback" ]; then
  if [ "$RELEASE_SHA" != "$APPROVED_FOCUSED_BASELINE_SHA" ] \
    || [[ ! "${FOCUSED_RELEASE_SHA:-}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    echo "Focused rollback must target the pinned production baseline from an exact focused release" >&2
    exit 2
  fi
  echo "Focused rollback mutation is disabled until external release gates are complete" >&2
  exit 1
fi
if [ "$RELEASE_MODE_VALUE" != "release" ] && [ "$RELEASE_MODE_VALUE" != "rollback" ] && [ "$RELEASE_MODE_VALUE" != "focused-baseline" ]; then
  echo "RELEASE_MODE must be release, rollback, or focused-baseline" >&2
  exit 2
fi
for name in AWS_REGION_VALUE EB_APPLICATION_VALUE EB_ENVIRONMENT_VALUE EB_RELEASE_BUCKET_VALUE; do
  if [ -z "${!name}" ]; then
    echo "Required deployment configuration is missing" >&2
    exit 2
  fi
done

RELEASE_SHA="${RELEASE_SHA,,}"
VERSION_LABEL="mosaic-$RELEASE_SHA"
CONTROLLER_SHA=$(git rev-parse --verify HEAD^{commit})
if [ "$RELEASE_MODE_VALUE" = "release" ] && [ "$CONTROLLER_SHA" != "$RELEASE_SHA" ]; then
  echo "Checked-out commit does not match the approved release SHA" >&2
  exit 1
fi
if [ "$RELEASE_MODE_VALUE" = "rollback" ] \
  && ! git merge-base --is-ancestor "$RELEASE_SHA" "$CONTROLLER_SHA"; then
  echo "Rollback target is not an ancestor of the trusted controller" >&2
  exit 1
fi

SOURCE_TREE=$(git rev-parse --verify "$RELEASE_SHA^{tree}")
if ! [[ "$SOURCE_TREE" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Unable to resolve the approved release tree" >&2
  exit 1
fi
if git cat-file -e "$RELEASE_SHA:release-manifest.json" 2>/dev/null; then
  echo "The reserved runtime release-manifest.json path must not be committed" >&2
  exit 1
fi
if [ -n "$(git ls-tree -r --name-only "$RELEASE_SHA" -- release-evidence)" ]; then
  echo "Committed release evidence is forbidden in a deployment tree" >&2
  exit 1
fi

# S3 preprocessing caches extensions outside the authorized release prefix.
# Focused bundles already undergo exact-tree validation that forbids EB hooks;
# also reject the one remaining EB preprocessing manifest before opting out.
application_version_process_args=(--process)
if [ "$RELEASE_MODE_VALUE" = "focused-baseline" ]; then
  if git cat-file -e "$RELEASE_SHA:env.yaml" 2>/dev/null; then
    echo "Focused source bundle contains an EB environment manifest requiring preprocessing" >&2
    exit 1
  fi
  application_version_process_args=(--no-process)
fi

package_path=$(mktemp --suffix=.zip)
reused_bundle_path=$(mktemp --suffix=.zip)
postcheck_bundle_path=$(mktemp --suffix=.zip)
cleanup() {
  rm -f "$package_path" "$reused_bundle_path" "$postcheck_bundle_path"
}
trap cleanup EXIT

manifest_json=$(node - "$RELEASE_SHA" "$SOURCE_TREE" "$VERSION_LABEL" <<'NODE'
const [commit, sourceTree, deploymentVersion] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  commit,
  sourceTree,
  environment: 'production',
  deploymentVersion,
}));
NODE
)
validated_manifest_json="$manifest_json"

build_exact_tree_package() {
  # git archive reads only the approved commit. Mutable workspace files,
  # untracked files, node_modules, and run evidence can never enter the bundle.
  git archive \
    --format=zip \
    --output="$package_path" \
    --add-virtual-file="release-manifest.json:$manifest_json" \
    "$RELEASE_SHA"
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

sha256_base64_file() {
  node - "$1" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [input] = process.argv.slice(2);
process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('base64'));
NODE
}

validate_embedded_manifest() {
  local bundle="$1"
  validated_manifest_json=$(python3 scripts/release/validate-eb-source-bundle.py \
    --bundle "$bundle" \
    --release-sha "$RELEASE_SHA" \
    --source-tree "$SOURCE_TREE" \
    --version-label "$VERSION_LABEL")
}

assert_current_main() {
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  local current_main_sha
  current_main_sha=$(git rev-parse --verify refs/remotes/origin/main^{commit})
  if [ "$current_main_sha" != "$CONTROLLER_SHA" ]; then
    echo "Canonical main moved after production approval; refusing stale deployment" >&2
    return 1
  fi
  if [ "$RELEASE_MODE_VALUE" = "release" ] && [ "$current_main_sha" != "$RELEASE_SHA" ]; then
    echo "Canonical main no longer matches the approved release SHA" >&2
    return 1
  fi
}

# Refuse stale work before even creating or uploading a deployment artifact.
assert_current_main

bucket="$EB_RELEASE_BUCKET_VALUE"
if ! [[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "Pinned release bucket name is invalid" >&2
  exit 2
fi
if ! bucket_region=$($AWS_CLI s3api get-bucket-location \
  --bucket "$bucket" \
  --region "$AWS_REGION_VALUE" \
  --query LocationConstraint \
  --output text 2>/dev/null); then
  echo "Unable to read pinned release bucket location" >&2
  exit 1
fi
case "$bucket_region" in
  ""|None|null) bucket_region="us-east-1" ;;
  EU) bucket_region="eu-west-1" ;;
esac
if [ "$bucket_region" != "$AWS_REGION_VALUE" ]; then
  echo "Pinned release bucket region does not match the configured release region" >&2
  exit 1
fi
existing_version=$($AWS_CLI elasticbeanstalk describe-application-versions \
  --application-name "$EB_APPLICATION_VALUE" \
  --version-labels "$VERSION_LABEL" \
  --region "$AWS_REGION_VALUE" \
  --query 'length(ApplicationVersions)' \
  --output text)
if ! [[ "$existing_version" =~ ^[01]$ ]]; then
  echo "Elastic Beanstalk returned an unexpected exact-label version count" >&2
  exit 1
fi

application_version_state="reused"
package_source="exact-git-tree"
bundle_validation="git-tree-and-s3-sha256"
object_key=""
package_sha=""
package_checksum_b64=""

if [ "$existing_version" = "0" ] || [ "$RELEASE_MODE_VALUE" = "release" ] || [ "$RELEASE_MODE_VALUE" = "focused-baseline" ]; then
  build_exact_tree_package
  validate_embedded_manifest "$package_path"
  package_sha=$(sha256_file "$package_path")
  package_checksum_b64=$(sha256_base64_file "$package_path")
  object_key="mosaic-releases/$RELEASE_SHA/$package_sha.zip"
fi

if [ "$existing_version" = "0" ]; then
  $AWS_CLI s3api put-object \
    --bucket "$bucket" \
    --key "$object_key" \
    --body "$package_path" \
    --checksum-algorithm SHA256 \
    --checksum-sha256 "$package_checksum_b64" \
    --metadata "release-sha=$RELEASE_SHA,package-sha256=$package_sha" \
    --region "$AWS_REGION_VALUE" \
    --output json >/dev/null
  $AWS_CLI elasticbeanstalk create-application-version \
    --application-name "$EB_APPLICATION_VALUE" \
    --version-label "$VERSION_LABEL" \
    --description "Immutable GitHub release $RELEASE_SHA package $package_sha" \
    --source-bundle "S3Bucket=$bucket,S3Key=$object_key" \
    --region "$AWS_REGION_VALUE" \
    --no-auto-create-application \
    "${application_version_process_args[@]}" \
    --output json >/dev/null
  application_version_state="created"
else
  read -r existing_bucket object_key < <(
    $AWS_CLI elasticbeanstalk describe-application-versions \
      --application-name "$EB_APPLICATION_VALUE" \
      --version-labels "$VERSION_LABEL" \
      --region "$AWS_REGION_VALUE" \
      --query 'ApplicationVersions[0].[SourceBundle.S3Bucket,SourceBundle.S3Key]' \
      --output text
  )
  if [ "$existing_bucket" != "$bucket" ] || [ -z "$object_key" ] || [ "$object_key" = "None" ]; then
    echo "Existing application version source bundle is unavailable or outside the controlled bucket" >&2
    exit 1
  fi
  if [ "$RELEASE_MODE_VALUE" = "release" ] || [ "$RELEASE_MODE_VALUE" = "focused-baseline" ]; then
    expected_key="mosaic-releases/$RELEASE_SHA/$package_sha.zip"
    if [ "$object_key" != "$expected_key" ]; then
      echo "Existing application version does not reference this exact deterministic package" >&2
      exit 1
    fi
  else
    # Rollbacks intentionally reuse the original historical artifact. Never
    # attribute a freshly rebuilt package hash to it: download the source
    # bundle, validate its embedded identity, and report its own SHA-256.
    $AWS_CLI s3api get-object \
      --bucket "$bucket" \
      --key "$object_key" \
      --checksum-mode ENABLED \
      --region "$AWS_REGION_VALUE" \
      "$reused_bundle_path" \
      --output json >/dev/null
    validate_embedded_manifest "$reused_bundle_path"
    package_sha=$(sha256_file "$reused_bundle_path")
    package_checksum_b64=$(sha256_base64_file "$reused_bundle_path")
    package_source="historical-eb-source-bundle"
    bundle_validation="reviewed-legacy-git-tree-bytes-and-downloaded-sha256"
  fi
fi

application_version_args=(
  --application-name "$EB_APPLICATION_VALUE"
  --version-label "$VERSION_LABEL"
  --region "$AWS_REGION_VALUE"
  --timeout-seconds 600
  --poll-seconds 5
  --output release-evidence/eb-application-version.json
)
if [ "$RELEASE_MODE_VALUE" = "rollback" ] \
  && [ "$existing_version" = "1" ] \
  && [ "$package_source" = "historical-eb-source-bundle" ]; then
  application_version_args+=(--allow-unprocessed-reused)
fi
if [ "$package_source" = "exact-git-tree" ]; then
  read -r remote_checksum remote_release_sha remote_package_sha < <(
    $AWS_CLI s3api head-object \
      --bucket "$bucket" \
      --key "$object_key" \
      --checksum-mode ENABLED \
      --region "$AWS_REGION_VALUE" \
      --query '[ChecksumSHA256,Metadata."release-sha",Metadata."package-sha256"]' \
      --output text
  )
  if [ "$remote_checksum" != "$package_checksum_b64" ] \
    || [ "$remote_release_sha" != "$RELEASE_SHA" ] \
    || [ "$remote_package_sha" != "$package_sha" ]; then
    echo "Stored deployment package checksum or identity metadata does not match" >&2
    exit 1
  fi
fi

if [ "$RELEASE_MODE_VALUE" = "focused-baseline" ] \
  && [ "$package_source" = "exact-git-tree" ]; then
  application_version_args+=(--allow-unprocessed-focused-bundle)
fi
node scripts/release/require-eb-application-version.js \
  "${application_version_args[@]}"

write_deployment_evidence() {
  local status="$1"
  local verified="$2"
  mkdir -p "$(dirname "$OUTPUT_PATH")"
  node - "$OUTPUT_PATH" "$RELEASE_SHA" "$SOURCE_TREE" "$VERSION_LABEL" \
    "$package_sha" "$object_key" "$application_version_state" "$status" "$verified" \
    "$package_source" "$bundle_validation" "$RELEASE_MODE_VALUE" "$validated_manifest_json" <<'NODE'
const fs = require('node:fs');
const [
  output,
  releaseSha,
  sourceTree,
  versionLabel,
  packageSha256,
  sourceBundleKey,
  applicationVersion,
  status,
  verified,
  packageSource,
  bundleIdentityValidation,
  releaseMode,
  releaseManifestJson,
] = process.argv.slice(2);
const payload = {
  schemaVersion: 1,
  status,
  releaseSha,
  releaseMode,
  sourceTree,
  versionLabel,
  packageSha256,
  sourceBundleKey,
  packageSource,
  bundleIdentityValidation,
  releaseManifest: JSON.parse(releaseManifestJson),
  applicationVersion,
  deploymentAttempted: true,
  deploymentVerified: verified === 'true',
};
const temporary = `${output}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, output);
NODE
}

# Bind the traffic mutation to a second current-main read immediately before
# update-environment. Any stale artifact created above remains inert and can be
# garbage-collected; checkout stays gated and no old SHA is served.
# Re-prove the two pinned listener rules and both public listener surfaces here,
# after package/application-version preparation, so that a long Process wait
# cannot leave the deployment authorized by stale gate evidence.
if [ -z "${PRODUCTION_API_URL:-}" ]; then
  echo "PRODUCTION_API_URL is required for the final pre-mutation gate proof" >&2
  exit 2
fi
node scripts/release/manage-checkout-gate.js verify \
  --expected-state active \
  --output release-evidence/gate-before-update-environment.json
bash scripts/release/verify-checkout-gate.sh \
  "$PRODUCTION_API_URL" \
  "http://api.mosaicbizhub.com"
assert_current_main

# Persist truth before update-environment. An AWS error, cancellation, or
# readiness timeout therefore remains an attempted, unverified deployment.
write_deployment_evidence attempted false
$AWS_CLI elasticbeanstalk update-environment \
  --application-name "$EB_APPLICATION_VALUE" \
  --environment-name "$EB_ENVIRONMENT_VALUE" \
  --version-label "$VERSION_LABEL" \
  --region "$AWS_REGION_VALUE" \
  --output json >/dev/null

ready=false
for _attempt in $(seq 1 120); do
  read -r status running_version health < <(
    $AWS_CLI elasticbeanstalk describe-environments \
      --application-name "$EB_APPLICATION_VALUE" \
      --environment-names "$EB_ENVIRONMENT_VALUE" \
      --region "$AWS_REGION_VALUE" \
      --query 'Environments[0].[Status,VersionLabel,Health]' \
      --output text
  )
  if [ "$status" = "Ready" ] && [ "$running_version" = "$VERSION_LABEL" ] && [ "$health" = "Green" ]; then
    ready=true
    break
  fi
  if [ "$status" = "Terminated" ] || [ "$status" = "Terminating" ]; then
    echo "Elastic Beanstalk entered terminal state during deployment" >&2
    exit 1
  fi
  sleep 15
done
if [ "$ready" != "true" ]; then
  echo "Elastic Beanstalk did not reach Ready/Green on the exact version before timeout" >&2
  exit 1
fi

# Recheck the exact source bundle after EB reaches the target. For historical
# rollback artifacts this is a second download/hash, not trust in a mutable key.
if [ "$package_source" = "historical-eb-source-bundle" ]; then
  $AWS_CLI s3api get-object \
    --bucket "$bucket" \
    --key "$object_key" \
    --checksum-mode ENABLED \
    --region "$AWS_REGION_VALUE" \
    "$postcheck_bundle_path" \
    --output json >/dev/null
  validate_embedded_manifest "$postcheck_bundle_path"
  if [ "$(sha256_file "$postcheck_bundle_path")" != "$package_sha" ]; then
    echo "Historical source bundle changed during deployment" >&2
    exit 1
  fi
else
  post_checksum=$($AWS_CLI s3api head-object \
    --bucket "$bucket" \
    --key "$object_key" \
    --checksum-mode ENABLED \
    --region "$AWS_REGION_VALUE" \
    --query 'ChecksumSHA256' \
    --output text)
  if [ "$post_checksum" != "$package_checksum_b64" ]; then
    echo "Exact-tree source bundle changed during deployment" >&2
    exit 1
  fi
fi

write_deployment_evidence passed true
echo "Elastic Beanstalk reached Ready/Green on $VERSION_LABEL."
