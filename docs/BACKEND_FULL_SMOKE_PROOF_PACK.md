# Backend Full Smoke Proof Pack (P0–P6)

**Issue:** [#27 Backend MVP smoke proof pack](https://github.com/Techware-Hut/mosaic-backend/issues/27)  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`  
**Base URL:** `https://api.mosaicbizhub.com`  
**Local URL:** `http://localhost:3001`  
**Date:** 2026-06-18  
**Deployed SHA verified:** **Not confirmed** — prod `/api/health` returns 404 (pre PR #78 EB)

Complements:

- [production-smoke-checklist.md](production-smoke-checklist.md)
- [MVP_BACKEND_SMOKE_PROOF_PACK.md](MVP_BACKEND_SMOKE_PROOF_PACK.md) (Jun 17 browse-only evidence)
- [BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md](BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md)

**Run helper:** `./scripts/smoke-backend.ps1 -ApiBaseUrl $Base` or `./scripts/smoke-backend.sh`

---

## Optional env vars (names only)

| Variable | Purpose |
| --- | --- |
| `API_BASE_URL` | Target API (required for scripts) |
| `SMOKE_TEST_CUSTOMER_TOKEN` | Cookie or Bearer for customer auth probes |
| `SMOKE_TEST_VENDOR_TOKEN` | Vendor (`business_owner`) auth |
| `SMOKE_TEST_ADMIN_TOKEN` | Admin auth |
| `SMOKE_TEST_PRODUCT_ID` | Product detail smoke |
| `SMOKE_TEST_VENDOR_ID` | Vendor profile smoke |
| `FRONTEND_ORIGIN` | CORS preflight origin (default: launch Vercel app) |

Never commit tokens or secrets.

---

## P0 — Infrastructure / liveness

| ID | Endpoint / action | Role | Env / data | Command / step | Expected | Actual (prod 2026-06-18) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0.1 | `GET /` | None | — | `Invoke-RestMethod "$Base/"` | 200 JSON | 200 | Live probe | **Pass** | Legacy root message |
| P0.2 | `GET /api/health` | None | — | `Invoke-RestMethod "$Base/api/health"` | 200 `{ status: ok }` | 404 Cannot GET | Live probe | **Fail** | PR #78 not on EB |
| P0.3 | `GET /api/ready` | None | — | `Invoke-RestMethod "$Base/api/ready"` | 200, `database: connected` | 404 | Live probe | **Fail** | PR #78 not on EB |
| P0.4 | CORS preflight | Browser | `FRONTEND_ORIGIN` | OPTIONS `/api/featured-products` with Origin header | 204/200 + Allow-Origin | Not Run | — | **Not Run** | Run after deploy |
| P0.5 | Ready no internals leak | None | — | Inspect `/api/ready` body | No Mongo URI, no stack trace | N/A (404) | — | **Blocked** | Needs P0.3 pass |

---

## P1 — Public marketplace browsing

| ID | Endpoint | Role | Env / data | Command | Expected | Actual (prod) | Evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1.1 | `GET /api/featured-products` | None | — | GET | 200, `{ products, pagination }` | 200 | Live probe | **Pass** | |
| P1.2 | `GET /api/products/list?limit=5` | None | — | GET | 200, capped list | 200 | Live probe | **Pass** | |
| P1.3 | `GET /api/services/list?limit=5` | None | — | GET | 200 | 200 | Live probe | **Pass** | |
| P1.4 | `GET /api/food/list?limit=5` | None | — | GET | 200 | 200 | Live probe | **Pass** | |
| P1.5 | `GET /api/public/search?keyword=test&limit=5` | None | — | GET | 200, scoped to visible businesses | 200 | Live probe | **Pass** | Batch 1 scope fix on main |
| P1.6 | Ranked listings | None | — | Ranked product route with `isPublished` | Unpublished excluded | Not Run | — | **Not Run** | Unit test covers on main |
| P1.7 | Categories | None | — | Category list endpoints | 200 | Not Run | — | **Not Run** | |
| P1.8 | Empty featured state | None | Empty DB | GET featured | 200 empty array | Not verified | — | **Not Run** | |
| P1.9 | Pagination limit cap | None | `limit=999` | GET list | Limit clamped (≤50) | Not Run | — | **Not Run** | Batch 1 caps on main |

---

## P2 — Auth and role boundaries

| ID | Endpoint / action | Role | Env / data | Expected | Actual | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P2.1 | `GET /api/users/auth/check` | None | — | 401 | 401 | **Pass** | Live probe |
| P2.2 | Customer login / token | Customer | `SMOKE_TEST_CUSTOMER_TOKEN` | 200 loggedIn | — | **Blocked** | No smoke account |
| P2.3 | Vendor login / token | Vendor | `SMOKE_TEST_VENDOR_TOKEN` | 200, role business_owner | — | **Blocked** | |
| P2.4 | Admin login / token | Admin | `SMOKE_TEST_ADMIN_TOKEN` | 200, role admin | — | **Blocked** | |
| P2.5 | Protected customer route | Customer | Token | 401 without token | — | **Blocked** | |
| P2.6 | Vendor route wrong role | Customer token | Token | 403 | — | **Blocked** | |
| P2.7 | Admin route wrong role | Vendor token | Token | 403 | — | **Blocked** | |

Manual auth script (needs Mongo): `node scripts/verify-auth-check-smoke.js`

---

## P3 — Vendor onboarding / profile / listing

| ID | Action | Role | Expected | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| P3.1 | Vendor registration (safe test) | New user | 201/OTP flow | **Blocked** | No disposable test account policy |
| P3.2 | Vendor profile read/update | Vendor | 200 own profile | **Blocked** | Needs vendor token |
| P3.3 | Listing draft create | Vendor | 201 draft | **Blocked** | |
| P3.4 | Inactive vendor hidden publicly | None | Not in search/featured | **Not Run** | Batch 1 unit tests pass |
| P3.5 | Active approved vendor visible | None | Appears in public list | **Not Run** | |

---

## P4 — Checkout / payment / order / email

| ID | Action | Role | Expected | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| P4.1 | `POST /api/orders/initiate` | Customer | 201 with auth | **Blocked** | Needs customer token + cart |
| P4.2 | `POST /api/orders/initiate` unauth | None | 401 | **Blocked** | Run with script after token setup |
| P4.3 | `POST /api/orders/initiate` wrong role | Vendor | 403 | **Blocked** | PR #78 on main |
| P4.4 | `POST /api/payments/create-payment-intent` unauth | None | 401 | **Blocked** | PR #78 on main |
| P4.5 | Stripe webhook signature | Stripe | 400 without sig | **Not Run** | Document only — do not bypass |
| P4.6 | Paid email after `payment_intent.succeeded` | System | Email once | **Not Run** | Stripe test mode only |
| P4.7 | Duplicate webhook no duplicate email | System | Single email | **Not Run** | `paidConfirmationEmailSentAt` on main |
| P4.8 | Failed payment no paid email | System | No paid email | **Not Run** | |

Webhook paths: [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md). **Do not run live charges** unless Stripe test mode explicitly configured.

---

## P5 — Admin / compliance

| ID | Action | Role | Expected | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| P5.1 | Admin vendor approval | Admin | 200 with admin token | **Blocked** | |
| P5.2 | Admin route non-admin | Customer | 403 | **Blocked** | |
| P5.3 | Admin review queue | Admin | 200 list | **Blocked** | |
| P5.4 | No PII leak on public routes | None | No passwordHash/otp in JSON | **Pass** | auth/check 401 returns safe body |
| P5.5 | Content moderation queue | Admin | If present | **Not Run** | |

---

## P6 — Monitoring / security / regression

| ID | Check | Expected | Actual | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| P6.1 | Sentry event capture | Event in dashboard | Not verified | **Blocked** | #18 — needs EB DSN |
| P6.2 | mongo-sanitize + xss mounted | Active post PR #78 | Code on main | **Not Run** (prod) | Unit/integration via app boot |
| P6.3 | No stack traces in prod errors | Generic JSON errors | Not Run | **Not Run** | |
| P6.4 | No secrets in logs | No OTP/keys in EB logs | Not captured | **Blocked** | Needs EB log access |
| P6.5 | Public list response time | < 3s casual | Not measured | **Not Run** | |
| P6.6 | Product indexes in Atlas | Compound indexes exist | Not verified | **Blocked** | Atlas owner — Batch 1 indexes in schema |

---

## Summary

| Tier | Pass | Fail | Blocked | Not Run |
| --- | --- | --- | --- | --- |
| P0 | 1 | 2 | 1 | 1 |
| P1 | 5 | 0 | 0 | 4 |
| P2 | 1 | 0 | 6 | 0 |
| P3 | 0 | 0 | 3 | 2 |
| P4 | 0 | 0 | 4 | 4 |
| P5 | 1 | 0 | 3 | 1 |
| P6 | 0 | 0 | 3 | 3 |

**Launch gate:** P0.2/P0.3 must **Pass** after EB deploy of `fbe3aac`. P2–P5 require smoke tokens. P6.1 requires Sentry EB verify.

---

## Post-deploy rerun (deployment owner)

```powershell
$Base = "https://api.mosaicbizhub.com"
./scripts/smoke-backend.ps1 -ApiBaseUrl $Base

# With tokens (optional):
$env:SMOKE_TEST_CUSTOMER_TOKEN = "<from secure store>"
./scripts/smoke-backend.ps1 -ApiBaseUrl $Base
```

Update this doc with actual results and attach GHA run URL + EB version label.
