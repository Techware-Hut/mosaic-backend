# Backend Environment Variable Inventory

**Issue:** [#64 Environment variable inventory and configuration drift audit](https://github.com/Techware-Hut/mosaic-backend/issues/64)  
**Date:** 2026-06-18  
**Rule:** Names only — never commit or print secret values.

Sources compared: [`.env.example`](../.env.example), [README.md](../README.md), [production-env-checklist.md](production-env-checklist.md), codebase `process.env` usage.

---

## Classification key

| Class | Meaning |
| --- | --- |
| **Required-prod** | EB production boot or core flows fail without it |
| **Required-local** | Needed for local dev of exercised features |
| **Optional** | Feature-specific or has safe default |
| **CI** | Set in GitHub Actions only (OIDC/AWS, not app env) |
| **Deprecated** | Documented legacy name — do not use |
| **Unknown** | Referenced inconsistently — verify before use |

---

## Core runtime

| Variable | Class | Local | CI test job | EB prod | Notes |
| --- | --- | --- | --- | --- | --- |
| `PORT` | Optional | Yes | No | Yes | Default `3001` local; EB often `8080` |
| `NODE_ENV` | Required-prod | Optional | No | Yes | `production` on EB |
| `MONGODB_URI` | Required-prod | Yes | No | Yes | Atlas connection string |
| `JWT_SECRET` | Required-prod | Yes | No | Yes | Auth signing |
| `FRONTEND_URL` | Required-prod | Yes | No | Yes | CORS fallback + redirects |
| `CORS_ORIGINS` | Recommended-prod | Optional | No | Yes | Comma-separated CORS allowlist; explicit domains only |
| `API_BASE_URL` | Required-prod | Yes | No | Yes | OAuth callback base |
| `GOOGLE_CLIENT_ID` | Required-prod | Yes | No | Yes | Auth module load |
| `GOOGLE_CLIENT_SECRET` | Required-prod | Yes | No | Yes | OAuth |

---

## Auth cookies

| Variable | Class | Local | EB prod |
| --- | --- | --- | --- |
| `COOKIE_DOMAIN` | Optional | No | Yes (`.mosaicbizhub.com`) |
| `COOKIE_SECURE` | Optional | No | Yes (`true`) |
| `COOKIE_SAMESITE` | Optional | No | Yes (`none` cross-site) |
| `REQUIRE_PROFILE_COMPLETION` | Optional | Optional | Optional |
| `TEMP_COOKIE_NAME` | Optional | Optional | Optional |
| `TEMP_COOKIE_TTL_SEC` | Optional | Optional | Optional |

---

## Stripe

| Variable | Class | EB prod | Webhook route |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Required-prod | Yes | All Stripe API |
| `STRIPE_ORDER_WEBHOOK_SECRET` | Required-prod | Yes | `POST /api/webhooks/stripe` |
| `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | Required-prod | Yes | `POST /api/stripe/webhook` |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Required-prod | Yes | `POST /api/subscription/webhook` |
| `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | Required-prod | Yes | `POST /api/vendor-onboarding/webhook/payment` |
| `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | Required-prod | Yes | `POST /api/stripe/payment/webhook` |
| `PLATFORM_FEE_CENTS` | Optional | Yes | Connect order fees |
| `BILLING_PORTAL_RETURN_URL` | Optional | Yes | Billing portal |
| `CONNECT_RETURN_PATH` | Optional | Yes | Connect onboarding |
| `CONNECT_REFRESH_PATH` | Optional | Yes | Connect onboarding |
| `CONNECT_RETURN_URL` | Optional | Optional | Full URL override |
| `CONNECT_REFRESH_URL` | Optional | Optional | Full URL override |

### Deprecated (do not use)

| Variable | Replacement |
| --- | --- |
| `STRIPE_ENDPOINT_SECRET` | Per-route secrets above |
| `STRIPE_WEBHOOK_SECRET` | Per-route secrets above |
| `STRIPE_WEBHOOK_SECRET_TWO` | Per-route secrets above |
| `STRIPE_PUBLIC_KEY` | Frontend `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` only |

---

## AWS S3

| Variable | Class | EB prod |
| --- | --- | --- |
| `AWS_REGION` | Required-local uploads | Yes |
| `AWS_ACCESS_KEY_ID` | Required-local uploads | Yes |
| `AWS_SECRET_ACCESS_KEY` | Required-local uploads | Yes |
| `AWS_S3_BUCKET` | Required-local uploads | Yes |

---

## Email

| Variable | Class | EB prod |
| --- | --- | --- |
| `MAIL_USER` | Required-prod mail | Yes |
| `MAIL_PASSWORD` | Required-prod mail | Yes |
| `MAIL_HOST` | Optional auth SMTP provider | Yes for provider-neutral auth mail |
| `MAIL_PORT` | Optional auth SMTP provider | Yes for provider-neutral auth mail |
| `MAIL_SECURE` | Optional auth SMTP provider | Yes for provider-neutral auth mail |
| `MAIL_FROM` | Optional auth SMTP From header | Yes for provider-neutral auth mail |
| `ADMIN_EMAIL` | Optional | Yes |
| `SUPPORT_EMAIL` | Optional | Optional |
| `APP_NAME` | Optional | Optional |
| `APP_URL` | Optional | Optional |

---

## Observability (Sentry)

| Variable | Class | EB prod |
| --- | --- | --- |
| `SENTRY_DSN` | Optional | Yes (to enable) |
| `SENTRY_ENVIRONMENT` | Optional | Yes |
| `SENTRY_RELEASE` | Optional | Yes (`mosaic-<sha>`) |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | Yes (default `0`) |
| `SENTRY_PROFILES_SAMPLE_RATE` | Optional | Yes (default `0`) |
| `SENTRY_ENABLED` | Optional | Yes |
| `ENABLE_SENTRY_DEBUG_ROUTE` | Optional | Verify only — disable at launch |

---

## Optional / future

| Variable | Notes |
| --- | --- |
| `GOOGLE_GEOCODING_API_KEY` | Geolocation — not MVP |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Not in active payment path |
| `PUPPETEER_EXECUTABLE_PATH` | PDF generation |
| `LISTING_DEBUG` | Debug logging |
| `CLOUDINARY_*` | Legacy upload path |
| `STORAGE_PROVIDER` | Upload backend selector |

---

## CI / GitHub Actions (not app `.env`)

| Variable / var | Where | Purpose |
| --- | --- | --- |
| `AWS_ROLE_TO_ASSUME` | GHA vars | OIDC deploy |
| `AWS_REGION` | GHA env | EB region |
| `EB_APPLICATION_NAME` | GHA env | EB app |
| `EB_ENVIRONMENT_NAME` | GHA env | EB env |
| `PRODUCTION_API_URL` | GHA env | Post-deploy probes |

---

## Drift notes

| Drift | Detail |
| --- | --- |
| `.env.local` | Not loaded by app (`index.js` uses `dotenv.config()` only) — use `.env` for local |
| Hosted staging | No staging EB env — [hosted-staging-decision.md](hosted-staging-decision.md) |
| `.env.example` vs checklist | Aligned on Stripe secret names; example uses commented Sentry placeholders |
| Frontend env | `NEXT_PUBLIC_*` on Vercel — see [production-env-checklist.md](production-env-checklist.md) § Frontend |

No production env changes were made during this audit.
