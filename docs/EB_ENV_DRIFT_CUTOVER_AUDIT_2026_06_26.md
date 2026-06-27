# EB Env Drift Cutover Audit

**Date:** 2026-06-26
**Scope:** Names-only launch cutover evidence for backend issues #82 and #83.
**Rule:** Do not paste secret values from EB, Vercel, Stripe, Sentry, or email providers into this document or issue comments.

This audit documents the intended production environment shape after the canonical frontend correction:

- `https://mosaicbizhub.com` is the canonical marketplace frontend.
- `https://app.mosaicbizhub.com` is transition-only.
- `https://www.mosaicbizhub.com` should redirect to apex and should not be a credentialed app origin by default.
- `https://api.mosaicbizhub.com` remains the backend API host.

## Code Status

| Area | Status | Evidence |
| --- | --- | --- |
| Generated backend frontend links | Ready for cutover | `utils/frontendUrl.js` defaults to apex and ignores stale `FRONTEND_URL=https://app.mosaicbizhub.com` for generated defaults |
| Stripe Connect return/refresh builder | Ready for cutover | `tests/connect/connect-urls.test.js` covers apex defaults, safe overrides, and legacy app fallback rejection as default |
| Credentialed CORS defaults | Ready for cutover | `tests/cors/cors-origins.test.js` covers apex, transition app, launch Vercel, and wildcard rejection |
| Cookie domain guardrails | Ready for cutover | `tests/cookie/cookie-options.test.js` covers `.mosaicbizhub.com` and invalid-domain fallback |
| Final-domain runtime proof | Not complete | Requires deployed main, DNS/env cutover, and browser smoke |

## EB Variables To Verify

| Variable | Launch expectation | Action if different |
| --- | --- | --- |
| `FRONTEND_URL` | `https://mosaicbizhub.com` | Change to apex, then deploy or restart EB |
| `CORS_ORIGINS` | Explicit comma-separated allowlist including `https://mosaicbizhub.com` and approved temporary origins only | Add apex; remove `https://www.mosaicbizhub.com` unless intentionally tested; deploy or restart EB |
| `API_BASE_URL` | `https://api.mosaicbizhub.com` | Correct before OAuth smoke |
| `COOKIE_DOMAIN` | Usually `.mosaicbizhub.com`, unless final smoke chooses host-only cookies | Do not change blindly; verify browser cookie behavior first |
| `COOKIE_SECURE` | `true` | Correct before final auth smoke |
| `COOKIE_SAMESITE` | `none` for cross-subdomain browser auth | Correct before final auth smoke |
| `CONNECT_RETURN_PATH` | `/partners/connect/return` | Correct before Stripe Connect smoke |
| `CONNECT_REFRESH_PATH` | `/partners/connect/refresh` | Correct before Stripe Connect smoke |
| `CONNECT_RETURN_URL` | Usually unset in production unless an intentional full override is needed | If set to legacy app, replace with apex or remove and use path-based builder |
| `CONNECT_REFRESH_URL` | Usually unset in production unless an intentional full override is needed | If set to legacy app, replace with apex or remove and use path-based builder |
| `BILLING_PORTAL_RETURN_URL` | Apex frontend return URL for billing flows | Replace legacy app values before billing smoke |
| `SENTRY_DSN` | Set in EB only when backend monitoring is enabled | Do not paste value; verify event after deploy |
| `SENTRY_ENVIRONMENT` | `production` | Correct before backend Sentry proof |
| `SENTRY_RELEASE` | Deployed release identifier or commit-based release | Align with deployed artifact |

## Stripe Connect URL Decision

Preferred launch configuration:

```text
FRONTEND_URL=https://mosaicbizhub.com
CONNECT_RETURN_PATH=/partners/connect/return
CONNECT_REFRESH_PATH=/partners/connect/refresh
```

Use full URL overrides only when QA intentionally targets a non-default frontend origin:

```text
CONNECT_RETURN_URL=https://mosaicbizhub.com/partners/connect/return
CONNECT_REFRESH_URL=https://mosaicbizhub.com/partners/connect/refresh
```

Do not use `https://app.mosaicbizhub.com` as the production Connect return/refresh default after apex cutover.

## Required Human Verification

1. Confirm the EB environment values above in AWS without copying secrets into GitHub.
2. Apply EB env changes and redeploy or restart the environment.
3. Confirm the deployed backend release identity matches the intended `main` SHA.
4. Run backend smoke:

```powershell
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

5. Run a credentialed CORS preflight from `https://mosaicbizhub.com`.
6. Run Stripe Connect onboarding from the final frontend and confirm:
   - onboarding starts
   - return route lands on `https://mosaicbizhub.com/partners/connect/return`
   - refresh route lands on `https://mosaicbizhub.com/partners/connect/refresh`
   - interrupted onboarding can be resumed
7. Verify backend Sentry only after `SENTRY_DSN` and release metadata are set, then disable any debug route used for verification.

## Issue Status

| Issue | Current state |
| --- | --- |
| #82 Stripe Connect return and refresh URL domain alignment | Code and documentation are ready; final Stripe Connect browser smoke remains open |
| #83 EB environment variable drift audit | Names-only expected values are documented here; actual EB console comparison remains open |
| #84 Backend production smoke proof | Still blocked until deployed main, final-domain DNS/env, and runtime smoke are available |
