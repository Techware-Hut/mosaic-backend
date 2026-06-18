# Sentry Elastic Beanstalk Deploy Verification (#18)

**Issue:** [#18 Add Sentry or production error monitoring](https://github.com/Techware-Hut/mosaic-backend/issues/18)  
**Status:** Code on `main`; **post-deploy probe 2026-06-18** — debug route disabled; dashboard proof **BLOCKED**  
**Branch baseline:** `main` @ `5f98461`

---

## Required environment variables (names only — never commit values)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | Yes (to enable) | Sentry project DSN — set in EB only |
| `SENTRY_ENVIRONMENT` | Recommended | e.g. `production` |
| `SENTRY_RELEASE` | Recommended | Match EB version label, e.g. `mosaic-fbe3aac` |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | Default `0` (errors only) |
| `SENTRY_PROFILES_SAMPLE_RATE` | Optional | Default `0` |
| `SENTRY_ENABLED` | Optional | Set `false` to disable without removing DSN |
| `ENABLE_SENTRY_DEBUG_ROUTE` | Optional | `true` **only during verification** |

Reference: [production-env-checklist.md](production-env-checklist.md) § Observability, [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) § Observability.

---

## Where Sentry initializes

| Step | File | Behavior |
| --- | --- | --- |
| 1 | [index.js](../index.js) | `require('./instrument')` before `app` |
| 2 | [instrument.js](../instrument.js) | `Sentry.init()` when `isSentryEnabled()` — DSN present and not disabled |
| 3 | [app.js](../app.js) | `sentryHttpCapture` middleware early in stack |
| 4 | [app.js](../app.js) | `Sentry.setupExpressErrorHandler(app)` after all routes |
| 5 | [index.js](../index.js) | `Sentry.captureException` + `flush` on Mongo startup failure |

Sensitive data scrubbing: `beforeSend` in [instrument.js](../instrument.js) filters passwords, tokens, OTPs, Stripe secrets, cookies.

---

## Initialization order verification

Correct order for Express 5 + `@sentry/node` v10:

1. Load instrument (SDK init)
2. Create Express app
3. Mount `sentryHttpCapture` (5xx on `res.finish`)
4. Mount routes and middleware
5. Mount optional debug route (env-gated)
6. Call `Sentry.setupExpressErrorHandler(app)` **last**

Webhook routes use `express.raw()` **before** `express.json()` — Sentry does not interfere with raw body parsing.

---

## Tests (Sentry disabled without DSN)

File: [tests/sentry/instrument.test.js](../tests/sentry/instrument.test.js)

| Test | Asserts |
| --- | --- |
| No DSN | `isSentryEnabled()` → false |
| `SENTRY_ENABLED=false` | Disabled even with DSN |
| DSN + enabled | `isSentryEnabled()` → true |
| `scrubObject` | Sensitive keys redacted; long strings truncated |

Run: `npm test` (included in full suite — 190 tests).

CI runs without `SENTRY_DSN` — Sentry never initializes in tests.

---

## No secrets in repository

- DSN referenced only in `.env.example` as commented placeholders
- Grep audit: no hardcoded `sentry.io` DSN in source
- EB env properties hold production DSN

---

## How to verify locally

1. Copy `.env.example` Sentry vars to local `.env` (not committed).
2. Set `SENTRY_DSN` to a **dev/staging** Sentry project DSN.
3. Set `SENTRY_ENVIRONMENT=development`.
4. Optionally set `ENABLE_SENTRY_DEBUG_ROUTE=true`.
5. Start server: `npm start`.
6. `GET http://localhost:3001/internal/sentry-debug` — expect HTTP 500.
7. Confirm event in Sentry dashboard (environment `development`).
8. Unset `ENABLE_SENTRY_DEBUG_ROUTE` when done.

Without DSN, server boots normally — no Sentry overhead.

---

## How to verify after EB deploy

1. Deploy release containing [instrument.js](../instrument.js) (already on `main`).
2. Set EB env vars (see table above).
3. Set `SENTRY_RELEASE=mosaic-<deployed-git-sha>` to match GHA version label.
4. Redeploy or restart EB environment.
5. **Temporarily** set `ENABLE_SENTRY_DEBUG_ROUTE=true` on EB.
6. `GET https://api.mosaicbizhub.com/internal/sentry-debug` — expect HTTP 500.
7. Confirm new error event in Sentry:
   - Environment: `production`
   - Release: matches `SENTRY_RELEASE`
   - Message contains `Sentry debug route test error`
8. Set `ENABLE_SENTRY_DEBUG_ROUTE=false` before launch sign-off.
9. Trigger a real 5xx path (if safe in staging) or rely on `sentryHttpCapture` for future 5xx.

---

## What event should appear in Sentry

| Trigger | Event type | Tags / context |
| --- | --- | --- |
| Debug route | Error exception | Unhandled throw from debug handler |
| Controller 5xx | Message | `HTTP 500 GET /path`, status_code tag |
| Unhandled throw | Exception | Express error handler |
| Mongo boot fail | Exception | Startup abort in index.js |

---

## What NOT to test in production

- Do **not** leave `ENABLE_SENTRY_DEBUG_ROUTE=true` at launch sign-off
- Do **not** add a permanent public test error route
- Do **not** commit DSN or auth tokens to git
- Do **not** enable high trace/profile sample rates in MVP (cost + PII risk)

---

## Source maps / build context

Node backend runs unbundled source — **source maps not required** for MVP.

Tie releases to deploy SHA via `SENTRY_RELEASE=mosaic-<sha>` so Sentry groups errors by EB version label.

---

## Error middleware and API responses

`setupExpressErrorHandler` runs after existing route handlers. Controllers that catch errors and return JSON 4xx/5xx without `next(err)` are still reported via `sentryHttpCapture` for status ≥ 500.

Existing client-facing error shapes are unchanged — no stack traces in production JSON responses.

---

## Rollback

If Sentry causes boot issues:

1. Set `SENTRY_ENABLED=false` or remove `SENTRY_DSN` on EB.
2. Restart EB environment.
3. App runs without monitoring.

---

## Post-deploy safe probes (2026-06-18 18:22 UTC)

Production: `https://api.mosaicbizhub.com`

| Probe | Result | Notes |
| --- | --- | --- |
| `GET /internal/sentry-debug` | **404** | Route not mounted — `ENABLE_SENTRY_DEBUG_ROUTE` not active (launch-safe) |
| `GET /api/users/auth/check` unauth body | **PASS** | JSON `{"success":false,"message":"Authentication required"}` — no stack trace |
| Sentry dashboard event | **BLOCKED** | No dashboard access in audit session |
| EB `SENTRY_*` env names | **BLOCKED** | AWS CLI unavailable |

Do **not** enable debug route for launch sign-off without explicit infra approval.

---

## #18 acceptance criteria checklist

| Criterion | Status |
| --- | --- |
| Sentry initialized with EB env DSN | **BLOCKED** — cannot verify without AWS/Sentry access |
| Unhandled errors + 5xx captured | **Code ready** — verify after DSN + deploy of latest `main` |
| Release tagged with EB label/SHA | **BLOCKED** — deploy of `5f98461` not confirmed live |
| Debug route disabled at launch | **PASS** — `/internal/sentry-debug` → 404 |
| No stack traces in client JSON errors | **PASS** — auth probe |
| No secrets committed | **PASS** |
| Documented in production runbook | **PASS** — [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |

**Blocked proof:** Sentry dashboard access + EB env configuration + redeploy of `main` @ `5f98461` required from deployment owner.
