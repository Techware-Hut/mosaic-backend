# Vendor Approval Progression E2E — Backend Verification Proof

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch verified:** `main`  
**Commit SHA:** `fd59d7fbad6a645327b44656dd3c4000011529f6`  
**Includes reconcile fix:** `d333cbc` (PR #101 — payment reconcile on submit)  
**Evidence date:** 2026-06-20  
**Production API:** `https://api.mosaicbizhub.com`  
**Launch frontend:** `https://mosaic-biz-frontend-launch.vercel.app`  

No secrets, cookie values, JWTs, OTPs, payment IDs, credentials, or PII in this document.

---

## Executive verdict

**Root cause assessment:** **No backend P0 defect identified.** Automated tests and production route/CORS probes pass. Credentialed live progression steps (admin finalize, verified vendor profile PUT, business record) are **BLOCKED — env-owned** (`SMOKE_TEST_ADMIN_TOKEN` / `SMOKE_TEST_VENDOR_TOKEN` not configured in session). Live $24.99 charge **deferred by policy** (not approved).

| Area | Result |
| --- | --- |
| Code + unit/contract tests | **PASS** (239 + 16) |
| CORS (both origins) | **PASS** |
| Route auth guards (production) | **PASS** |
| Admin pending → verify → finalize (live) | **BLOCKED** — no admin smoke token |
| Verified vendor profile unlock (live) | **BLOCKED** — no vendor smoke token |
| Live payment → submit | **NOT TESTED** — charge not approved |
| Code changes required | **None** |
| PR opened | **None** |

---

## Scope decisions (from plan)

| Decision | Choice |
| --- | --- |
| Target branch | `origin/main` only |
| Live Stripe charge | **Not approved** — skipped |
| Production data mutation | None performed (no admin finalize without token) |

---

## Commands run

| Command | Result |
| --- | --- |
| `git checkout main && git pull origin main` | Fast-forward to `fd59d7f` |
| `git merge-base --is-ancestor d333cbc HEAD` | reconcile fix **PRESENT** |
| `npm test` | **239 pass**, 0 fail |
| `npm run test:contract` | **16 pass**, 0 fail |
| `npm run smoke:backend` (Origin: launch Vercel) | **18 pass**, 0 fail, 5 blocked (no tokens) |
| `npm run smoke:backend` (Origin: app.mosaicbizhub.com) | **18 pass**, 0 fail, 5 blocked |
| `./scripts/vendor-login-session-proof.ps1` (both origins) | CORS **PASS**; credentialed login **BLOCKED** |
| `./scripts/vendor-approval-progression-e2e-proof.ps1` | Guards **PASS**; credentialed steps **BLOCKED** |
| `node scripts/read-only-onboarding-state-snapshot.js` | **BLOCKED** — MongoDB SRV unreachable from local network |

---

## Route contracts verified (static + guards)

All routes registered in [`routes/vendorOnboarding.routes.js`](../routes/vendorOnboarding.routes.js), mounted at `/api/vendor-onboarding`.

| Route | Auth | Expected | Live guard probe |
| --- | --- | --- | --- |
| `POST /api/vendor-onboarding/stage1/create-payment` | vendor JWT | PI created; `payment_pending` | Not probed unauth (same middleware) |
| `GET /api/vendor-onboarding/stage1/payment-status` | vendor JWT | `canSubmit` when paid | **401** unauth — PASS |
| `POST /api/vendor-onboarding/submit` | vendor JWT | `submitted` when paid + valid | **401** unauth — PASS |
| `GET /api/vendor-onboarding/pending` | admin JWT | `status=submitted` only | **401** unauth — PASS |
| `GET /api/vendor-onboarding/:applicationId` | admin JWT | full application | Not probed (requires admin token) |
| `POST /api/vendor-onboarding/:applicationId/verify` | admin JWT | checklist/points only | Not probed (requires admin token) |
| `POST /api/vendor-onboarding/:applicationId/finalize` | admin JWT | DB `verified`; JSON may say `approved` | Not probed (requires admin token) |
| `PUT/PATCH /api/vendor-onboarding/business-profile` | vendor + `requireStage1VerifiedVendor` | 403 unless `verified`; PUT syncs Business | **401** unauth — PASS |

**Known non-defect:** finalize response `data.status: "approved"` vs DB `status: "verified"` — asserted in [`tests/admin/vendor-onboarding-finalize.test.js`](../tests/admin/vendor-onboarding-finalize.test.js).

**Payment-submit reconcile:** `submitForReview` on `main` calls `reconcileVendorVerificationPaymentFromStripe` before paid check — covered by [`tests/vendor/vendor-verification-payment-submit-reconcile.test.js`](../tests/vendor/vendor-verification-payment-submit-reconcile.test.js) (7 tests pass).

---

## CORS verification

| Origin | Probe | Expected | Actual | Owner | Sev |
| --- | --- | --- | --- | --- | --- |
| `https://mosaic-biz-frontend-launch.vercel.app` | OPTIONS `/api/featured-products` | 204 + ACAO echo + credentials | **204**, ACAO matches, credentials=true | backend | P2 — **PASS** |
| `https://app.mosaicbizhub.com` | OPTIONS `/api/featured-products` | 204 + ACAO echo + credentials | **204**, ACAO matches, credentials=true | backend | P2 — **PASS** |
| launch Vercel | OPTIONS `/api/users/login` | credentialed preflight | **204**, ACAO matches | backend | P2 — **PASS** |
| app.mosaicbizhub.com | OPTIONS `/api/users/login` | credentialed preflight | **204**, ACAO matches | backend | P2 — **PASS** |

Config source: [`utils/corsOrigins.js`](../utils/corsOrigins.js), [`app.js`](../app.js).

---

## E2E step matrix

| # | Step | Expected | Actual | HTTP | Owner | Sev |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Fresh vendor account coordination | onboarding-data 404 or draft | Not run with frontend in this session | — | frontend | deferred |
| 2 | Live $24.99 payment | `verificationPayment.status=paid` | **NOT TESTED** — charge not approved | — | env | deferred |
| 3 | Post-payment state | `canSubmit=true` | **BLOCKED** — no vendor token | — | env | deferred |
| 4 | Submit | `status=submitted` | Covered by unit tests; live **BLOCKED** — no vendor token | — | env | deferred |
| 5 | Admin pending queue | submitted app listed | **BLOCKED** — `SMOKE_TEST_ADMIN_TOKEN` unset | — | env | deferred |
| 6 | Admin detail | 200 + same applicationId | **BLOCKED** — no admin token | — | env | deferred |
| 7 | Admin verify checklist | 200; status stays submitted | **BLOCKED** — no admin token | — | env | deferred |
| 8 | Finalize approval | JSON `approved`; DB `verified` | Prior prod audit + unit tests **PASS**; live **BLOCKED** | — | env | deferred |
| 9 | Pending queue removal | app absent after approve | **BLOCKED** — no admin token | — | env | deferred |
| 10 | Business profile unlock | PUT 200 not 403 | **BLOCKED** — `SMOKE_TEST_VENDOR_TOKEN` unset | — | env | deferred |
| 11 | Business record | `/api/business/my` 200 after PUT | **BLOCKED** — no vendor token; sync covered by unit tests | — | env | deferred |

### Backend P0 triggers — none observed

No live reproduction of: paid cannot submit, missing from queue, verify/finalize failure, approval not `verified`, profile 403 after verify, profile save failure, or CORS blocks.

---

## Automated test evidence (state transitions)

| Transition | Test file | Result |
| --- | --- | --- |
| payment reconcile → submit | `vendor-verification-payment-submit-reconcile.test.js` | **PASS** |
| submit → submitted + email | `vendor-onboarding-submit-email.test.js` | **PASS** |
| pending queue = submitted only | `vendorOnboardVerifyStage1.pending-applications.test.js` | **PASS** |
| finalize → DB verified, JSON approved | `vendor-onboarding-finalize.test.js` | **PASS** |
| requireStage1VerifiedVendor gate | `require-verified-vendor.test.js` | **PASS** |
| Business create/update on PUT | `vendor-onboarding-business-sync.test.js` | **PASS** |
| CORS allowlist | `cors-origins.test.js` | **PASS** |
| Webhook raw body before JSON | `backend-launch-contract.test.js` | **PASS** |

---

## Frontend coordination checklist (for launch test session)

Share with frontend tester before coordinated run:

1. Use **one** dedicated test vendor + admin smoke account (not real customers).
2. **Do not** complete Stripe payment unless product owner approves live $24.99 charge.
3. For submit/admin steps without new payment: use vendor already at `paid` + complete draft, or backend verifies queue with a pre-existing submitted test application.
4. After admin finalize, vendor should refresh session if frontend caches pre-verify state.
5. Frontend should treat finalize JSON `approved` as success; poll onboarding `status=verified` for profile setup routing.

**Env vars required for backend live proof (session only, never commit):**

- `SMOKE_TEST_ADMIN_TOKEN`
- `SMOKE_TEST_VENDOR_TOKEN` (verified vendor for profile steps)
- Optional: `SMOKE_TEST_VENDOR_EMAIL` / `SMOKE_TEST_VENDOR_PASSWORD` for cookie chain proof

Run credentialed proof:

```powershell
$env:SMOKE_TEST_ADMIN_TOKEN = '<session-only>'
$env:SMOKE_TEST_VENDOR_TOKEN = '<session-only>'
./scripts/vendor-approval-progression-e2e-proof.ps1
```

---

## Profile unlock and Business record

| Check | Live prod | Unit tests |
| --- | --- | --- |
| `requireStage1VerifiedVendor` allows PUT when `verified` | **BLOCKED** (no token) | **PASS** |
| `PUT /business-profile` syncs Business | **BLOCKED** (no token) | **PASS** |
| `GET /api/business/my` after PUT | **BLOCKED** (no token) | **PASS** (controller mock) |

---

## Production infrastructure notes

| Check | Result |
| --- | --- |
| `GET /api/health` | **200** `{ status: ok }` |
| `GET /api/ready` | **200** (smoke PASS) |
| Deployed commit SHA via API | **Not exposed** — confirm EB deploy matches `fd59d7f` before relying on payment reconcile in prod |
| MongoDB read-only snapshot | **BLOCKED** — local DNS/network to Atlas SRV failed |

---

## Files added (verification tooling)

| File | Purpose |
| --- | --- |
| [`scripts/vendor-approval-progression-e2e-proof.ps1`](../scripts/vendor-approval-progression-e2e-proof.ps1) | Sanitized live API proof (guards + credentialed flow when tokens set) |
| [`scripts/read-only-onboarding-state-snapshot.js`](../scripts/read-only-onboarding-state-snapshot.js) | Read-only Mongo snapshot (applicationId + status only) |

---

## Known risks

| Risk | Severity |
| --- | --- |
| Prod EB may lag `main` — reconcile fix requires deploy of PR #101 | P2 |
| No dedicated smoke accounts in CI/session — credentialed E2E blocked | P1 |
| Webhook lag without reconcile on older deploy | P2 (mitigated on `main`) |
| S3 upload CORS separate from API CORS | P2 |
| `GET /api/admin/categories` public (unrelated) | P1 |

---

## What was not tested

- Live $24.99 Stripe charge and webhook handler on production
- Email delivery on submit/finalize
- Full frontend UI walkthrough on launch Vercel app
- Credentialed admin finalize / vendor profile PUT on production (blocked)
- MongoDB direct state read (network blocked locally)

---

## Rollback notes

- **Audit-only pass:** no deploy or code change required.
- If a backend fix is deployed later: revert single commit via EB rollback; no Stripe webhook middleware reorder.

---

## Re-run checklist

```powershell
git checkout main
git pull origin main
npm test
npm run test:contract

$env:API_BASE_URL = 'https://api.mosaicbizhub.com'
$env:FRONTEND_ORIGIN = 'https://mosaic-biz-frontend-launch.vercel.app'
npm run smoke:backend

$env:SMOKE_TEST_ADMIN_TOKEN = '<session-only>'
$env:SMOKE_TEST_VENDOR_TOKEN = '<session-only>'
./scripts/vendor-approval-progression-e2e-proof.ps1
```
