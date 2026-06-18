# Backend Deployment Proof — Post-Deploy Release Verification

**Production API:** `https://api.mosaicbizhub.com`  
**Issues:** [#80 CORS](https://github.com/Techware-Hut/mosaic-backend/issues/80) · [#84 Smoke](https://github.com/Techware-Hut/mosaic-backend/issues/84) · [#18 Sentry](https://github.com/Techware-Hut/mosaic-backend/issues/18)  
**Latest verification:** 2026-06-18 19:10:36 UTC (final CORS 4/4 — issue #80 closed)

---

## Final verification (2026-06-18 19:10:36 UTC) — issue #80 closed

| Field | Value |
|-------|-------|
| Repo `main` SHA | `4c77bf6` |
| EB deployed SHA | `afa56ca` (unchanged — no redeploy required) |
| EB env update | **APPLIED** — release owner set `CORS_ORIGINS` + `FRONTEND_URL` on `mosaic-backend-env` |
| CORS 4/4 | **PASS** — all allowlisted origins return 204 + exact ACAO + credentials |
| Smoke script | **PASS=11 FAIL=0 SKIP=1 BLOCKED=3** |
| `npm test` | **196/196 PASS** |

### CORS (OPTIONS `/api/featured-products`)

| Origin | HTTP | ACAO exact | Credentials | Result |
|--------|------|------------|-------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` (apex) | 204 | YES | YES | **PASS** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO | N/A | **PASS** (rejected) |

### Stakeholder summary (final)

| Gate | Status |
|------|--------|
| Code on `main` | **PASS** |
| EB deploy of CORS code | **PASS** (`afa56ca`) |
| EB `CORS_ORIGINS` env | **PASS** |
| Health + readiness | **PASS** |
| Public API browse | **PASS** |
| CORS 4/4 | **PASS** |
| Auth rejection (unauth) | **PASS** |
| Full launch sign-off | **PARTIAL** — authenticated smoke + Sentry dashboard remain |

---

## Why EB was behind `main` (root cause)

| Finding | Detail |
|---------|--------|
| Auto-deploy disabled | [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) — `push: main` is **commented out**; only `workflow_dispatch` triggers deploy |
| PR #85 merge did not deploy | Merging CORS code to `main` @ `5f98461` did **not** trigger EB deploy |
| Last deploy before unblock | GHA run @ `7d01011` (2026-06-18T01:13:55Z) — predated PR #85 merge |
| Production lag evidence | Pre-unblock: `GET /api/health` and `/api/ready` → **404** while public browse routes still returned **200** (older bundle without health routes) |
| Resolution | Manual `workflow_dispatch` run [27781345087](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27781345087) deployed `afa56ca`; health/readiness now **200** |

**Takeaway:** Every merge to `main` requires an explicit `gh workflow run deploy-eb-production.yml --ref main` until push deploy is re-enabled.

---

## Issue #80 resolution attempt (2026-06-18 18:53:34 UTC)

| Field | Value |
|-------|-------|
| Repo `main` SHA | `4c77bf6` |
| EB deployed SHA | `afa56ca` (unchanged) |
| `afa56ca..4c77bf6` diff | **Docs only** — 4 files; no code redeploy required for CORS |
| CORS code on EB | **YES** — `utils/corsOrigins.js` present at `afa56ca` |
| EB env update | **NOT APPLIED** — AWS CLI unavailable; release-owner handoff active |
| Apex CORS | **FAIL 500** — inferred `CORS_ORIGINS` unset |
| Smoke script | **PASS=11 FAIL=0 BLOCKED=3** |
| `npm test` | **196/196 PASS** |

---

## Post-deploy verification (2026-06-18 — full smoke re-run)

| Field | Value |
|-------|-------|
| Repo `main` SHA | `4c77bf6` (docs); EB runtime deploy @ `afa56ca` |
| Docs merged | PR [#86](https://github.com/Techware-Hut/mosaic-backend/pull/86) → `main` @ `afa56ca` |
| GHA deploy run | [27781345087](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27781345087) — **success** |
| Deployed EB version | `mosaic-afa56cab386a73581e71c3a9e4be8b1174d26825` |
| Deployed commit | `afa56ca` — includes CORS code from PR #85 |

### Live smoke (`./scripts/smoke-backend.ps1`)

| Check | Result |
|-------|--------|
| `GET /api/health` | **PASS** (200) |
| `GET /api/ready` | **PASS** (200) |
| Public browse routes | **PASS** (200) |
| Unauth protected routes | **PASS** (401) |
| CORS preflight (launch.vercel.app) | **PASS** (204) |
| Authenticated tiers | **BLOCKED** — no `SMOKE_TEST_*` tokens |

**Summary:** PASS=11, FAIL=0, BLOCKED=3

### CORS (OPTIONS `/api/featured-products`, all four launch origins + negative)

| Origin | HTTP | ACAO exact | Credentials `true` | Result |
|--------|------|------------|----------------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` (apex) | 500 | NO | NO | **FAIL** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO | N/A | **PASS** (rejected) |

**CORS 4/4:** **FAIL** (3/4) — apex returns 500 because `CORS_ORIGINS` is unset on EB; fallback [`LEGACY_DEFAULT_ORIGINS`](../utils/corsOrigins.js) excludes apex.

### Additional public endpoints

| Endpoint | HTTP | Result |
|----------|------|--------|
| `GET /api/categories` | 200 | **PASS** |
| `GET /api/ranked?limit=5` | 200 | **PASS** (canonical ranked route) |

### Protected unauth probes

| Route | HTTP | Stack leak | Result |
|-------|------|------------|--------|
| `GET /api/business/my` | 401 | No | **PASS** |
| `GET /api/vendor-onboarding/onboarding-data` | 401 | No | **PASS** |
| `POST /api/orders/initiate` | 401 | No | **PASS** |
| `POST /api/connect/:id/account-link` | 401 | No | **PASS** |
| `POST /stripe/account-session` | 401 | No | **PASS** |
| `GET /admin/users` | 401 | No | **PASS** |
| `GET /api/admin/categories` | 200 | No | **NOTE** — route has no auth middleware (public admin category list) |

### Sentry (safe probes)

| Check | Result |
|-------|--------|
| `GET /internal/sentry-debug` | **404** — debug route disabled |
| Unauth JSON body | **PASS** — no stack trace |
| Dashboard event | **BLOCKED** |
| EB `SENTRY_*` env names | **BLOCKED** — AWS CLI unavailable |

### Stakeholder summary (post-deploy)

| Gate | Status |
|------|--------|
| Code on `main` | **PASS** |
| EB deploy of latest `main` | **PASS** |
| Health + readiness | **PASS** |
| Public API browse | **PASS** |
| CORS 4/4 | **FAIL** (3/4) |
| Auth rejection | **PASS** |
| Full launch sign-off | **NOT READY** — apex CORS + authenticated smoke remain |

---

## Pre-deploy audit (2026-06-18 18:22 UTC) — superseded

Historical record from before redeploy. Kept for audit trail.

| Field | Value |
|-------|-------|
| Repo `main` SHA | `5f98461` — Merge PR #85 (CORS allowlist) |
| Last GHA EB deploy SHA | `7d01011` — 2026-06-18T01:13:55Z |
| Deploy of `5f98461` confirmed live | **NO** (at time of audit) |
| Deploy proxy evidence | `GET /api/health` → **404**; `GET /api/ready` → **404** |

**Conclusion (historical):** Code was merged to `main`, but production matched pre-merge deploy (`7d01011` era). Resolved by GHA deploy run 27781345087.

---

## Release-owner handoff — apex CORS blocker — COMPLETE

**Status:** **COMPLETE** (2026-06-18). Release owner applied EB env on `mosaic-backend-env`. Apex CORS returns **204** with exact ACAO + credentials.

Historical steps (for audit):

1. AWS Console → Elastic Beanstalk → **`mosaic-backend-env`** (app: **`mosaic-biz-hub-backend`**, region: **`us-east-1`**) → Configuration → Software → Environment properties.
2. Set these properties (exact values — not secrets):

```
CORS_ORIGINS=https://mosaic-biz-frontend-launch.vercel.app,https://app.mosaicbizhub.com,https://mosaicbizhub.com,https://www.mosaicbizhub.com
FRONTEND_URL=https://app.mosaicbizhub.com
```

3. Confirm **names only** (do not log values): `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`, `SENTRY_ENABLED`, `ENABLE_SENTRY_DEBUG_ROUTE`, Stripe webhook secret env names, `MAIL_USER`, `MAIL_PASSWORD` — per [`docs/ENV_VAR_INVENTORY.md`](ENV_VAR_INVENTORY.md).
4. Apply configuration (EB restarts instances).
5. Re-run apex CORS probe; if still 500, trigger redeploy:

```powershell
gh workflow run deploy-eb-production.yml --repo Techware-Hut/mosaic-backend --ref main
gh run watch --repo Techware-Hut/mosaic-backend
```

6. ~~Do **not** close [#80](https://github.com/Techware-Hut/mosaic-backend/issues/80) until 4/4 pass~~ — **CLOSED** 2026-06-18.

---

### CORS / frontend (post-env)

| Variable | Expected | Verified |
|----------|----------|----------|
| `CORS_ORIGINS` | Four launch origins (see CORS proof doc) | **PASS** — 4/4 CORS probe |
| `FRONTEND_URL` | `https://app.mosaicbizhub.com` | **PASS** (inferred with CORS fix) |

### Sentry

| Variable | Purpose |
|----------|---------|
| `SENTRY_DSN` | Enable monitoring |
| `SENTRY_ENVIRONMENT` | e.g. `production` |
| `SENTRY_RELEASE` | e.g. `mosaic-5f98461` |
| `SENTRY_TRACES_SAMPLE_RATE` | Default `0` |
| `SENTRY_PROFILES_SAMPLE_RATE` | Default `0` |
| `SENTRY_ENABLED` | Optional disable switch |
| `ENABLE_SENTRY_DEBUG_ROUTE` | Must be **false/unset** at launch |

### Stripe (names only)

`STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`, `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET`, `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET`

### Email (names only)

`MAIL_USER`, `MAIL_PASSWORD`

No secret values recorded.

---

## Smoke summary

### Local

| Check | Result |
|-------|--------|
| `npm test` | **196/196 PASS** |
| `node -c app.js` | **PASS** |

### Production public

| Tier | Result |
|------|--------|
| Root + marketplace browse | **PASS** (200) |
| Health/readiness | **PASS** (200) |
| Featured canonical route | **PASS** |
| Categories + ranked | **PASS** (200) |

### CORS (OPTIONS `/api/featured-products`)

| Origin | Result |
|--------|--------|
| launch.vercel.app | **PASS** |
| app.mosaicbizhub.com | **PASS** |
| mosaicbizhub.com (apex) | **PASS** |
| www.mosaicbizhub.com | **PASS** |
| evil.example.com | **PASS** (rejected) |

### Unauth protected routes

**PASS** — 401 on auth, vendor, order, connect, admin routes; no stack traces in bodies.

### Authenticated / checkout

**BLOCKED** — no `SMOKE_TEST_*` tokens; no live payment tests.

### Email safety

**PASS** — unit tests + `paidConfirmationEmailSentAt` guard; no pre-payment emails in `initiateOrder`.

### Sentry

| Check | Result |
|-------|--------|
| Debug route disabled | **PASS** (404) |
| No stack leak on 401 | **PASS** |
| Dashboard event proof | **BLOCKED** |

---

## Remaining launch blockers

1. ~~Set `CORS_ORIGINS` on EB~~ — **RESOLVED** (2026-06-18)
2. **Provide** approved smoke test tokens for authenticated tier — Batch A in [`docs/BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md`](BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md)
3. **Verify** Sentry dashboard capture — Batch B (release owner)

---

## Related proof packs

- [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md)
- [`docs/BACKEND_PRODUCTION_SMOKE_PROOF.md`](BACKEND_PRODUCTION_SMOKE_PROOF.md)
- [`docs/BACKEND_FRONTEND_ROUTE_CONTRACT.md`](BACKEND_FRONTEND_ROUTE_CONTRACT.md)
- [`docs/SENTRY_EB_DEPLOY_VERIFICATION.md`](SENTRY_EB_DEPLOY_VERIFICATION.md)
- [`docs/EB_DEPLOYMENT_READINESS_CHECKLIST.md`](EB_DEPLOYMENT_READINESS_CHECKLIST.md)

---

## Repro commands

```powershell
git checkout main
npm test
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

CORS per-origin OPTIONS — see [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md).
