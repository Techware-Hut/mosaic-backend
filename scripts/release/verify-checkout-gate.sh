#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${PRODUCTION_API_URL:-}}"
HTTP_TIMEOUT_SECONDS="${RELEASE_HTTP_TIMEOUT_SECONDS:-15}"
CURL_BIN="${CURL_BIN:-curl}"

if [[ ! "$BASE_URL" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "Usage: verify-checkout-gate.sh https://production-api.example" >&2
  exit 2
fi

BASE_URL="${BASE_URL%/}"

request_status() {
  local method="$1"
  local path="$2"
  local status
  local -a args=(
    --silent
    --show-error
    --output /dev/null
    --write-out "%{http_code}"
    --max-time "$HTTP_TIMEOUT_SECONDS"
    --request "$method"
  )

  if [ "$method" = "POST" ]; then
    args+=(
      --header "Content-Type: application/json"
      --header "stripe-signature: t=0,v1=invalid-release-preflight"
      --data-binary "{}"
    )
  fi

  if ! status=$("$CURL_BIN" "${args[@]}" "${BASE_URL}${path}"); then
    echo "Request failed for $method $path" >&2
    return 1
  fi

  printf '%s' "$status"
}

initiate_status=$(request_status POST "/api/orders/initiate")
echo "POST /api/orders/initiate: HTTP $initiate_status"
if [ "$initiate_status" != "503" ]; then
  echo "Checkout gate verification failed: expected infrastructure maintenance HTTP 503" >&2
  exit 1
fi

webhook_paths=(
  "/api/webhooks/stripe"
  "/api/stripe/webhook"
  "/api/stripe/payment/webhook"
  "/api/subscription/webhook"
  "/api/vendor-onboarding/webhook/payment"
)

for path in "${webhook_paths[@]}"; do
  status=$(request_status POST "$path")
  echo "POST $path (invalid signature): HTTP $status"
  if [ "$status" = "503" ]; then
    echo "Webhook reachability failed: checkout maintenance gate also blocks $path" >&2
    exit 1
  fi
  if [ "$status" != "400" ]; then
    echo "Webhook reachability failed: expected application signature rejection HTTP 400 for $path" >&2
    exit 1
  fi
done

health_paths=(
  "/api/health"
  "/api/ready"
  "/api/build-info"
)

for path in "${health_paths[@]}"; do
  status=$(request_status GET "$path")
  echo "GET $path: HTTP $status"
  if [ "$status" != "200" ]; then
    echo "Health surface verification failed: expected HTTP 200 for $path" >&2
    exit 1
  fi
done

echo "Checkout gate is active; Stripe webhooks and health surfaces remain reachable."
