#!/usr/bin/env bash
set -euo pipefail

HTTP_TIMEOUT_SECONDS="${RELEASE_HTTP_TIMEOUT_SECONDS:-15}"
CURL_BIN="${CURL_BIN:-curl}"
EXPECTED_STATE="active"

if [ "${1:-}" = "--state" ]; then
  EXPECTED_STATE="${2:-}"
  shift 2 || true
fi

if [ "$EXPECTED_STATE" != "active" ] && [ "$EXPECTED_STATE" != "inactive" ]; then
  echo "--state must be active or inactive" >&2
  exit 2
fi

if [ "$#" -eq 0 ] && [ -n "${PRODUCTION_API_URL:-}" ]; then
  set -- "$PRODUCTION_API_URL"
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: verify-checkout-gate.sh [--state active|inactive] BASE_URL [BASE_URL ...]" >&2
  exit 2
fi

request_status() {
  local method="$1"
  local path="$2"
  local base_url="$3"
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

  if ! status=$("$CURL_BIN" "${args[@]}" "${base_url}${path}"); then
    echo "Request failed for $method $path" >&2
    return 1
  fi

  printf '%s' "$status"
}

webhook_paths=(
  "/api/webhooks/stripe"
  "/api/stripe/webhook"
  "/api/stripe/payment/webhook"
  "/api/subscription/webhook"
  "/api/vendor-onboarding/webhook/payment"
)

health_paths=(
  "/api/health"
  "/api/ready"
  "/api/build-info"
)

# These are the application-equivalent spellings accepted by Express's
# default non-strict, case-insensitive router. The ALB gate must cover all of
# them or an authenticated checkout can bypass the controlled cutover.
checkout_paths=(
  "/api/orders/initiate"
  "/api/orders/initiate/"
  "/API/ORDERS/INITIATE"
  "/Api/Orders/Initiate/"
)

surface_number=0
for candidate_base_url in "$@"; do
  surface_number=$((surface_number + 1))
  if [[ ! "$candidate_base_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
    echo "Every BASE_URL must be an origin URL without credentials, path, query, or fragment" >&2
    exit 2
  fi
  BASE_URL="${candidate_base_url%/}"
  echo "Release surface $surface_number"

  for path in "${checkout_paths[@]}"; do
    initiate_status=$(request_status POST "$path" "$BASE_URL")
    echo "POST $path: HTTP $initiate_status"
    if [ "$EXPECTED_STATE" = "active" ] && [ "$initiate_status" != "503" ]; then
      echo "Checkout gate verification failed: expected infrastructure maintenance HTTP 503 for every application-equivalent checkout path" >&2
      exit 1
    fi
    if [ "$EXPECTED_STATE" = "inactive" ] && [ "$initiate_status" != "401" ]; then
      echo "Checkout ungated verification failed: expected normal unauthenticated HTTP 401 for every application-equivalent checkout path" >&2
      exit 1
    fi
  done

  for path in "${webhook_paths[@]}"; do
    status=$(request_status POST "$path" "$BASE_URL")
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

  for path in "${health_paths[@]}"; do
    status=$(request_status GET "$path" "$BASE_URL")
    echo "GET $path: HTTP $status"
    if [ "$status" != "200" ]; then
      echo "Health surface verification failed: expected HTTP 200 for $path" >&2
      exit 1
    fi
  done
done

if [ "$EXPECTED_STATE" = "active" ]; then
  echo "Checkout gate is active on every release surface; Stripe webhooks and health surfaces remain reachable."
else
  echo "Checkout gate is inactive on every release surface; normal auth, Stripe webhooks, and health surfaces are verified."
fi
