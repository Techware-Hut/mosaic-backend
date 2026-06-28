# Domain Migration URL Inventory

Updated: 2026-06-28

## Current Architecture Truth

The prior `app.mosaicbizhub.com` canonical-domain plan is superseded. The apex-domain correction has been integrated and promoted; current production generated links, redirects, and credentialed CORS should treat `https://mosaicbizhub.com` as canonical. See [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) for the current production release and soft-launch mode.

| URL | Role | Backend Policy |
| --- | --- | --- |
| `https://mosaicbizhub.com` | Canonical production marketplace frontend | Primary frontend origin for generated links, redirects, and credentialed CORS |
| `https://www.mosaicbizhub.com` | Alias/redirect target for the marketplace | Not a default credentialed app origin |
| `https://app.mosaicbizhub.com` | Transition / historical app origin | Rejected by default for generated links and redirects; allow only with an explicit rollback flag |
| `https://mosaic-biz-frontend-launch.vercel.app` | QA / preview origin | Approved QA origin |
| `https://api.mosaicbizhub.com` | Canonical backend API | API host only; never a frontend redirect target |

## Runtime References

| Area | File | Behavior |
| --- | --- | --- |
| Frontend URL generation | `utils/frontendUrl.js` | Defaults generated links to `https://mosaicbizhub.com`; ignores stale `app.mosaicbizhub.com` env defaults; rejects the app host by default for supplied absolute redirects; approves the app host only when `ALLOW_LEGACY_FRONTEND_ORIGIN=true` or `1`; approves Vercel QA and dev localhost outside production; rejects `www`, API, and arbitrary origins |
| Stripe Connect return and refresh URLs | `lib/connect/connectUrls.js` | Uses the shared frontend URL allowlist and preserves approved full URL overrides |
| Google OAuth redirect state | `controllers/authController.js` | Sanitizes supplied redirects before state creation and again before callback redirect |
| Billing portal return URL | `controllers/billing.controller.js` | Sanitizes user-supplied or configured return URLs to an approved frontend origin or fallback account path |
| Credentialed CORS defaults | `utils/corsOrigins.js` | Defaults to apex plus approved transition/QA origins; dev origins are appended outside production; wildcard origins are filtered out |
| Production smoke probes | `.github/workflows/deploy-eb-production.yml`, `scripts/smoke-backend.ps1`, `scripts/smoke-backend.sh` | Probe apex and approved transition/QA origins for credentialed CORS |

## Redirect Security Evidence

Generated backend URLs may keep their path while moving to an approved frontend origin. User-supplied redirects use `sanitizeFrontendRedirectUrl`, which returns the original URL only when the origin is approved; otherwise it returns a safe apex fallback path. The legacy app host is not approved by default; use `ALLOW_LEGACY_FRONTEND_ORIGIN=true` or `1` only for a documented rollback window.

Covered flows:

- Google OAuth `redirect` query and callback state.
- Stripe Connect `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` and default paths.
- Billing portal `return_url` request body and `BILLING_PORTAL_RETURN_URL`.
- Subscription checkout success/cancel URLs generated from `buildFrontendUrl`.
- Email links generated from `buildFrontendUrl` / `getFrontendBaseUrl`.

## Occurrence Classification

| Pattern | Classification |
| --- | --- |
| `https://mosaicbizhub.com` | Canonical production marketplace frontend |
| `https://www.mosaicbizhub.com` | Redirect-only alias; explicitly rejected by backend URL sanitizer and omitted from default CORS |
| `https://app.mosaicbizhub.com` | Transition / historical app origin; rejected by default; keep only while explicitly approved through `ALLOW_LEGACY_FRONTEND_ORIGIN` |
| `https://mosaic-biz-frontend-launch.vercel.app` | QA / preview origin |
| `https://api.mosaicbizhub.com` | Backend API base URL only |

## Environment Variables

Names only; do not commit values.

| Env var | Production classification |
| --- | --- |
| `FRONTEND_URL` | Apex marketplace origin |
| `CORS_ORIGINS` | Explicit comma-separated origins: apex plus approved transition/QA origins; no wildcard |
| `API_BASE_URL` | API subdomain |
| `COOKIE_DOMAIN` | Audit before changing; production default remains `.mosaicbizhub.com` when unset |
| `CONNECT_RETURN_URL`, `CONNECT_REFRESH_URL` | Optional full overrides; must resolve to an approved frontend origin; leave unset for canonical apex generated defaults |
| `CONNECT_RETURN_PATH`, `CONNECT_REFRESH_PATH` | Optional Connect path overrides on approved frontend origin |
| `BILLING_PORTAL_RETURN_URL` | Optional billing return override; sanitized before use |
| `ALLOW_LEGACY_FRONTEND_ORIGIN` | Optional rollback flag; set only during a documented temporary rollback if backend-generated/sanitized redirects must preserve `https://app.mosaicbizhub.com` |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Release reporting; unchanged by hostname swap |

## Verification Commands

```powershell
npm test
npm run test:contract
rg -n "app\.mosaicbizhub\.com|www\.mosaicbizhub\.com|mosaicbizhub\.com|mosaic-biz-frontend-launch\.vercel\.app|api\.mosaicbizhub\.com" utils controllers lib routes tests scripts .github docs
```
