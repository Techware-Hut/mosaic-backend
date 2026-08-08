#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:-}"
AWS_REGION_VALUE="${AWS_REGION:-us-east-1}"
EB_ENVIRONMENT_VALUE="${EB_ENVIRONMENT_NAME:-mosaic-backend-env}"
AWS_CLI="${AWS_CLI:-aws}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Usage: verify-eb-instance-versions.sh <full-40-character-release-sha>" >&2
  exit 2
fi

response_file=$(mktemp)
error_file=$(mktemp)
cleanup() {
  rm -f "$response_file" "$error_file"
}
trap cleanup EXIT

if ! "$AWS_CLI" elasticbeanstalk describe-instances-health \
  --environment-name "$EB_ENVIRONMENT_VALUE" \
  --region "$AWS_REGION_VALUE" \
  --attribute-names Deployment \
  --output json > "$response_file" 2> "$error_file"; then
  echo "Unable to read Elastic Beanstalk per-instance deployment health. Check enhanced health and elasticbeanstalk:DescribeInstancesHealth permission." >&2
  exit 1
fi

node "$SCRIPT_DIR/verify-eb-instance-deployments.js" \
  "mosaic-${RELEASE_SHA,,}" \
  "$response_file"
