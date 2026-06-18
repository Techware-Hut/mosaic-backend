# Smoke Test Tokens — Production Auth Smoke

**Purpose:** Enable authenticated tiers in [`scripts/smoke-backend.ps1`](../scripts/smoke-backend.ps1) without committing secrets.  
**Batch:** A in [`BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md`](BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md)

No secret values belong in this document or the repository.

---

## Required variables

| Variable | Role | Smoke check |
|----------|------|-------------|
| `SMOKE_TEST_CUSTOMER_TOKEN` | Customer session JWT | P2.2 `GET /api/users/auth/check` → 200 |
| `SMOKE_TEST_VENDOR_TOKEN` | Vendor (`business_owner`) JWT | P2.3 auth/check → 200; P2.5 `/api/business/my`; P2.6 onboarding-data |
| `SMOKE_TEST_ADMIN_TOKEN` | Admin JWT | P2.4 auth/check → 200 |

## Optional variables

| Variable | Purpose |
|----------|---------|
| `SMOKE_TEST_PRODUCT_ID` | Public product ID for `GET /api/public/product/:id` |
| `FRONTEND_ORIGIN` | Origin header for CORS preflight probe (default: launch Vercel URL) |
| `API_BASE_URL` | API base (default in script: localhost; use `-ApiBaseUrl` for prod) |

---

## Setup (release owner)

1. Create or designate **non-production test accounts** for customer, vendor, and admin roles in the production database (or a staging mirror if policy requires).
2. Sign in via the normal auth flow and obtain session JWTs (Bearer tokens).
3. Store tokens in a local `.env.smoke` file or shell session — **never commit**.

### PowerShell (session only)

```powershell
$env:SMOKE_TEST_CUSTOMER_TOKEN = '<customer-jwt>'
$env:SMOKE_TEST_VENDOR_TOKEN = '<vendor-jwt>'
$env:SMOKE_TEST_ADMIN_TOKEN = '<admin-jwt>'
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

### Script parameters (alternative to env)

```powershell
./scripts/smoke-backend.ps1 `
  -ApiBaseUrl https://api.mosaicbizhub.com `
  -CustomerToken '<customer-jwt>' `
  -VendorToken '<vendor-jwt>' `
  -AdminToken '<admin-jwt>'
```

Parameters override env vars when both are set.

---

## Acceptance

When all three tokens are supplied, smoke summary should show P2.2–P2.4 as **PASS** instead of **BLOCKED**. With a vendor token, P2.5–P2.6 should also pass (onboarding-data may return **404** for fresh vendors).

For credentialed **cookie** login proof (not Bearer-only), use [`scripts/vendor-login-session-proof.ps1`](../scripts/vendor-login-session-proof.ps1) with `SMOKE_TEST_VENDOR_EMAIL` and `SMOKE_TEST_VENDOR_PASSWORD` — see [`docs/VENDOR_LOGIN_SESSION_AUDIT.md`](VENDOR_LOGIN_SESSION_AUDIT.md).

When tokens are absent, script continues to report **BLOCKED** (expected for CI without secrets).

---

## Security rules

- Do not commit tokens to git, docs, or issue comments.
- Do not use production admin accounts for routine smoke — dedicated test accounts only.
- Rotate tokens if exposed.
- No live payment tests — auth/check probes only unless explicitly extended later.
