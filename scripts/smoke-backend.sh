#!/usr/bin/env bash
# Lightweight backend smoke tests — public endpoints first, optional auth if tokens set.
# Usage: API_BASE_URL=https://api.mosaicbizhub.com ./scripts/smoke-backend.sh

set -euo pipefail

BASE="${API_BASE_URL:-http://localhost:3001}"
BASE="${BASE%/}"

PASS=0
FAIL=0
SKIP=0
BLOCKED=0

pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }
skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }
blocked() { echo "BLOCKED  $1 — $2"; BLOCKED=$((BLOCKED + 1)); }

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "$1"
}

get_json() {
  curl -s -w "\n%{http_code}" "$1"
}

echo "=== Mosaic Backend Smoke ==="
echo "API_BASE_URL=$BASE"
echo ""

# P0.1 Root
code=$(http_code "$BASE/")
if [ "$code" = "200" ]; then pass "P0.1 GET / ($code)"; else fail "P0.1 GET / ($code, expected 200)"; fi

# P0.2 Health
code=$(http_code "$BASE/api/health")
if [ "$code" = "200" ]; then pass "P0.2 GET /api/health ($code)"; else fail "P0.2 GET /api/health ($code, expected 200)"; fi

# P0.3 Ready
code=$(http_code "$BASE/api/ready")
if [ "$code" = "200" ]; then pass "P0.3 GET /api/ready ($code)"; else fail "P0.3 GET /api/ready ($code, expected 200)"; fi

release_identity_ok() {
  local path="$1"
  local body
  body=$(curl -s "$BASE$path")
  node -e "
    const payload = JSON.parse(process.argv[1]);
    const release = payload.release;
    if (!release) process.exit(1);
    for (const key of ['commit', 'environment', 'deploymentVersion']) {
      if (!release[key]) process.exit(1);
    }
    const serialized = JSON.stringify(release).toLowerCase();
    for (const bad of ['sk_live_', 'sk_test_', 'whsec_', 'sentry_dsn', 'mongodb', 'password', 'secret']) {
      if (serialized.includes(bad)) process.exit(1);
    }
  " "$body"
}

if release_identity_ok "/api/health"; then
  pass "P0.5 GET /api/health release identity"
else
  fail "P0.5 GET /api/health release identity missing or unsafe"
fi

if release_identity_ok "/api/build-info"; then
  pass "P0.6 GET /api/build-info release identity"
else
  fail "P0.6 GET /api/build-info release identity missing or unsafe"
fi

# P2.1 Unauthenticated auth check
code=$(http_code "$BASE/api/users/auth/check")
if [ "$code" = "401" ]; then pass "P2.1 GET /api/users/auth/check unauth ($code)"; else fail "P2.1 GET /api/users/auth/check ($code, expected 401)"; fi

# P1 public marketplace
for path in \
  "/api/featured-products" \
  "/api/products/list?limit=5" \
  "/api/public/search?keyword=test&limit=5" \
  "/api/services/list?limit=5" \
  "/api/food/list?limit=5"
do
  code=$(http_code "$BASE$path")
  if [ "$code" = "200" ]; then pass "P1 GET $path ($code)"; else fail "P1 GET $path ($code, expected 200)"; fi
done

CORS_ORIGINS=(
  "https://mosaicbizhub.com"
  "https://www.mosaicbizhub.com"
  "https://app.mosaicbizhub.com"
  "https://mosaic-biz-frontend-launch.vercel.app"
  "https://mosaic-biz-frontend-launch-digital-builders.vercel.app"
  "https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app"
  "https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app"
)
if [ -n "${FRONTEND_ORIGIN:-}" ]; then
  CORS_ORIGINS=("$FRONTEND_ORIGIN")
fi
for CORS_ORIGIN in "${CORS_ORIGINS[@]}"; do
  cors_headers=$(curl -s -D - -o /dev/null -X OPTIONS \
    -H "Origin: $CORS_ORIGIN" \
    -H "Access-Control-Request-Method: GET" \
    "$BASE/api/featured-products")
  if echo "$cors_headers" | grep -qi "access-control-allow-origin: $CORS_ORIGIN"; then
    pass "P0.4 CORS preflight (Origin=$CORS_ORIGIN)"
  else
    fail "P0.4 CORS preflight (Origin=$CORS_ORIGIN)"
  fi
done

code=$(http_code "$BASE/api/admin/categories")
if [ "$code" = "401" ]; then
  pass "P3.2 GET /api/admin/categories unauth ($code)"
else
  fail "P3.2 GET /api/admin/categories ($code, expected 401)"
fi

code=$(http_code "$BASE/admin/api/products/test")
if [ "$code" = "200" ]; then
  pass "NOTE GET /admin/api/products/test unauth ($code) — debug route pending PR #96 removal"
elif [ "$code" = "404" ]; then
  pass "NOTE GET /admin/api/products/test absent ($code) — PR #96 fix deployed"
else
  fail "NOTE GET /admin/api/products/test ($code, expected 200 on main or 404 after PR #96)"
fi

# Optional auth probes
auth_header() {
  local token="$1"
  if [ -z "$token" ]; then return 1; fi
  if [[ "$token" == Bearer* ]]; then echo "$token"; else echo "Bearer $token"; fi
}

# P4.2 unauthenticated order initiate
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" "$BASE/api/orders/initiate")
if [ "$code" = "401" ]; then pass "P4.2 POST /api/orders/initiate unauth ($code)"; else fail "P4.2 POST /api/orders/initiate ($code, expected 401)"; fi

# Launch contract guards (unauthenticated only)
code=$(http_code "$BASE/api/products/featured")
if [ "$code" = "404" ]; then pass "P6.0 GET /api/products/featured absent ($code)"; else fail "P6.0 GET /api/products/featured ($code, expected 404)"; fi

code=$(http_code "$BASE/admin/users")
if [ "$code" = "401" ]; then pass "P3.0 GET /admin/users unauth ($code)"; else fail "P3.0 GET /admin/users ($code, expected 401)"; fi

code=$(http_code "$BASE/admin/api/products")
if [ "$code" = "401" ]; then pass "P3.1 GET /admin/api/products unauth ($code)"; else fail "P3.1 GET /admin/api/products ($code, expected 401)"; fi

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" "$BASE/api/payments/create-payment-intent")
if [ "$code" = "401" ]; then pass "P4.3 POST /api/payments/create-payment-intent unauth ($code)"; else fail "P4.3 POST /api/payments/create-payment-intent ($code, expected 401)"; fi

code=$(http_code "$BASE/stripe/account-balance")
if [ "$code" = "401" ]; then pass "P5.0 GET /stripe/account-balance unauth ($code)"; else fail "P5.0 GET /stripe/account-balance ($code, expected 401)"; fi

if [ -n "${SMOKE_TEST_CUSTOMER_TOKEN:-}" ]; then
  hdr=$(auth_header "$SMOKE_TEST_CUSTOMER_TOKEN")
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $hdr" "$BASE/api/users/auth/check")
  if [ "$code" = "200" ]; then pass "P2.2 customer auth/check ($code)"; else fail "P2.2 customer auth/check ($code)"; fi
else
  blocked "P2.2 customer auth" "SMOKE_TEST_CUSTOMER_TOKEN not set"
fi

if [ -n "${SMOKE_TEST_VENDOR_TOKEN:-}" ]; then
  hdr=$(auth_header "$SMOKE_TEST_VENDOR_TOKEN")
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $hdr" "$BASE/api/users/auth/check")
  if [ "$code" = "200" ]; then pass "P2.3 vendor auth/check ($code)"; else fail "P2.3 vendor auth/check ($code)"; fi
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $hdr" "$BASE/api/business/my")
  if [ "$code" = "200" ]; then pass "P2.5 vendor GET /api/business/my ($code)"; else fail "P2.5 vendor GET /api/business/my ($code, expected 200)"; fi
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $hdr" "$BASE/api/vendor-onboarding/onboarding-data")
  if [ "$code" = "200" ] || [ "$code" = "404" ]; then
    pass "P2.6 vendor GET /api/vendor-onboarding/onboarding-data ($code, 404 OK for fresh vendor)"
  elif [ "$code" = "401" ]; then
    fail "P2.6 vendor onboarding-data ($code, expected 200 or 404 — not 401)"
  else
    fail "P2.6 vendor onboarding-data ($code, expected 200 or 404)"
  fi
else
  blocked "P2.3 vendor auth" "SMOKE_TEST_VENDOR_TOKEN not set"
  blocked "P2.5 vendor business/my" "SMOKE_TEST_VENDOR_TOKEN not set"
  blocked "P2.6 vendor onboarding-data" "SMOKE_TEST_VENDOR_TOKEN not set"
fi

if [ -n "${SMOKE_TEST_ADMIN_TOKEN:-}" ]; then
  hdr=$(auth_header "$SMOKE_TEST_ADMIN_TOKEN")
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: $hdr" "$BASE/api/users/auth/check")
  if [ "$code" = "200" ]; then pass "P2.4 admin auth/check ($code)"; else fail "P2.4 admin auth/check ($code)"; fi
else
  blocked "P2.4 admin auth" "SMOKE_TEST_ADMIN_TOKEN not set"
fi

if [ -n "${SMOKE_TEST_PRODUCT_ID:-}" ]; then
  code=$(http_code "$BASE/api/public/product/$SMOKE_TEST_PRODUCT_ID")
  if [ "$code" = "200" ]; then pass "P1 product detail ($code)"; else fail "P1 product detail ($code)"; fi
else
  skip "P1 product detail" "SMOKE_TEST_PRODUCT_ID not set"
fi

echo ""
echo "=== Summary: PASS=$PASS FAIL=$FAIL SKIP=$SKIP BLOCKED=$BLOCKED ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
