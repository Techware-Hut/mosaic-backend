# Domain Migration URL Inventory

Updated: 2026-06-24

## Current architecture truth

| URL | Role | Backend policy |
| --- | --- | --- |
| `https://mosaicbizhub.com` | Separate community and landing website | Not a marketplace app redirect target and not a default credentialed CORS origin |
| `https://www.mosaicbizhub.com` | Community website alias | Not a marketplace app redirect target and not a default credentialed CORS origin |
| `https://app.mosaicbizhub.com` | Marketplace app hostname after DNS is repointed to Vercel | Primary production frontend origin for generated links, redirects, and credentialed CORS |
| `https://mosaic-biz-frontend-launch.vercel.app` | Rebuilt Next.js frontend on Vercel | Approved transition, fallback, and QA origin |
| `https://api.mosaicbizhub.com` | AWS backend API | Canonical production API host |

`https://app.mosaicbizhub.com` may still point at the legacy frontend until DNS cutover. Backend code now treats it as the intended marketplace app hostname and refuses to treat the root community site as an app fallback.

## Runtime references

| Area | File | Behavior |
| --- | --- | --- |
| Frontend URL generation | `utils/frontendUrl.js` | Defaults to `https://app.mosaicbizhub.com`; approves only app, Vercel launch, and dev localhost origins; disallows root and www community origins |
| Stripe Connect return and refresh URLs | `lib/connect/connectUrls.js` | Uses the shared frontend URL allowlist and preserves approved full URL overrides |
| Google OAuth redirect state | `controllers/authController.js` | Sanitizes supplied redirects before state creation and again before callback redirect |
| Billing portal return URL | `controllers/billing.controller.js` | Sanitizes user-supplied or configured return URLs to an approved app origin or fallback account path |
| Credentialed CORS defaults | `utils/corsOrigins.js` | Defaults to app + Vercel launch only; dev origins are appended outside production |
| Production smoke probes | `.github/workflows/deploy-eb-production.yml`, `scripts/smoke-backend.ps1`, `scripts/smoke-backend.sh` | Probe only approved app origins for credentialed CORS |

## Redirect security evidence

Generated backend URLs may keep their path while moving to an approved frontend origin. User-supplied redirects use `sanitizeFrontendRedirectUrl`, which returns the original URL only when the origin is approved; otherwise it returns a safe app fallback path.

Covered flows:

- Google OAuth `redirect` query and callback state.
- Stripe Connect `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` and default paths.
- Billing portal `return_url` request body and `BILLING_PORTAL_RETURN_URL`.

## Occurrence classification

| Pattern | Classification |
| --- | --- |
| `https://app.mosaicbizhub.com` | Intended production marketplace app host after DNS cutover |
| `https://mosaic-biz-frontend-launch.vercel.app` | Current rebuilt Vercel app origin for transition and QA |
| `https://api.mosaicbizhub.com` | Backend API base URL |
| `https://mosaicbizhub.com` / `https://www.mosaicbizhub.com` | Community site, support email/cookie parent-domain text, historical smoke-proof docs, and explicit disallow tests; not live redirect defaults or default credentialed CORS origins |

## Environment variables

| Env var | Purpose |
| --- | --- |
| `FRONTEND_URL` | Primary backend frontend base URL; set to `https://app.mosaicbizhub.com` in production |
| `CORS_ORIGINS` | Comma-separated credentialed browser origins; production value should include app + Vercel launch only unless a new authenticated app origin is proven |
| `CONNECT_RETURN_URL`, `CONNECT_REFRESH_URL` | Optional full Stripe Connect overrides; must resolve to an approved frontend origin |
| `CONNECT_RETURN_PATH`, `CONNECT_REFRESH_PATH` | Optional Stripe Connect path overrides on the approved frontend base |
| `BILLING_PORTAL_RETURN_URL` | Optional billing portal return override; sanitized before use |
| `API_BASE_URL` | Public backend API URL for OAuth callback generation |
| `COOKIE_DOMAIN` | Optional cookie parent domain, typically `.mosaicbizhub.com` for cross-subdomain app/API cookies |

## Verification commands

```powershell
npm test
npm run test:contract
rg -n "mosaicbizhub\.com|mosaic-biz-frontend-launch\.vercel\.app|api\.mosaicbizhub\.com" utils controllers lib routes tests scripts .env.example .github docs
```
