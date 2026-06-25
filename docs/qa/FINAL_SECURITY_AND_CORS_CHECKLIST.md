# Final Security And CORS Checklist

Date: 2026-06-24
Repository: `Techware-Hut/mosaic-backend`
Branch audited: `codex/backend-final-preprod-audit`
Starting staging SHA: `28f9be37c6ae168605ad1d978d32fb013ddfe3af`

This checklist records source/test verification for final-domain backend safety. It does not expose secret values and does not modify environment configuration.

## Domain And Origin Truth

| Check | Evidence | Status |
| --- | --- | --- |
| Apex frontend is canonical | `utils/frontendUrl.js` defaults to `https://mosaicbizhub.com` | Confirmed |
| API remains API host | Mission target is `https://api.mosaicbizhub.com`; `utils/frontendUrl.js` disallows API host as frontend origin | Confirmed |
| Transition app origin remains allowed | `APPROVED_FRONTEND_ORIGINS` includes `https://app.mosaicbizhub.com` | Confirmed |
| Transition Vercel origin remains allowed | `APPROVED_FRONTEND_ORIGINS` and CORS defaults include `https://mosaic-biz-frontend-launch.vercel.app` | Confirmed |
| `www.mosaicbizhub.com` not accepted as app origin | `DISALLOWED_FRONTEND_ORIGINS` includes `https://www.mosaicbizhub.com` | Confirmed |
| Arbitrary redirect hosts rejected | `sanitizeFrontendRedirectUrl` falls back to approved base URL | Confirmed by URL tests |

## CORS

| Check | Evidence | Status |
| --- | --- | --- |
| No wildcard CORS with credentials | `parseCorsOrigins` filters `*` out of `CORS_ORIGINS`; app uses `credentials: true` | Confirmed by CORS tests |
| Apex allowed for credentialed requests | `DEFAULT_CREDENTIAL_ORIGINS` includes `https://mosaicbizhub.com` | Confirmed |
| Transition origins remain temporary allowed | `DEFAULT_CREDENTIAL_ORIGINS` includes app subdomain and launch Vercel origin | Confirmed |
| Dev origins excluded in production | `getAllowedOrigins` appends dev origins only when `NODE_ENV !== 'production'` | Confirmed by CORS tests |
| Login preflight rejects hostile origin | `tests/cors/cors-login-preflight.test.js` passes | Confirmed |

## Cookies

| Check | Evidence | Status |
| --- | --- | --- |
| Production secure default | `utils/cookieHelper.js` uses secure cookies by default when `NODE_ENV=production` | Confirmed |
| SameSite production default | Defaults to `none` when secure, otherwise `lax` | Confirmed |
| Cookie domain validation | Explicit `COOKIE_DOMAIN` must match API host; invalid values fall back safely | Confirmed by cookie helper tests |
| Do not auto-change `COOKIE_DOMAIN` | Runtime cookie proof is still required before changing environment values | Deferred |
| Logout clears all auth cookies | `clearAuthCookies` clears `token`, `user_session`, and `user_gender` | Confirmed by source/tests |

## Redirect And Link Sanitization

| Check | Evidence | Status |
| --- | --- | --- |
| OAuth start redirect sanitization | Google OAuth tests reject hostile redirect query origins | Confirmed |
| OAuth callback state redirect sanitization | Google OAuth tests reject tampered hostile state redirect origins | Confirmed |
| Stripe Connect return URL sanitization | Connect URL tests sanitize unsafe full URL overrides back to approved frontend host | Confirmed |
| Email links use approved frontend URL helpers | Email/logo helpers call `buildFrontendUrl`/`getFrontendLogoUrl` | Confirmed by source review |
| Transition-origin handling | `normalizeFrontendUrl` preserves approved transition origins while replacing unapproved origins | Confirmed by URL tests |

## Stripe Webhooks

| Check | Evidence | Status |
| --- | --- | --- |
| Raw body routes mount before JSON parser | `app.js` mounts Stripe webhook routes before `express.json({ limit: '1mb' })` | Confirmed by source and tests |
| Do not reorder webhook middleware | No middleware order changes made in this pass | Confirmed |
| Distinct signing secrets per webhook | Stripe webhook tests verify endpoint-specific secret env vars | Confirmed |
| Missing/invalid signatures rejected | Stripe webhook signature tests pass | Confirmed |
| Parsed JSON body rejected for canonical order webhook | `tests/stripe/stripe-webhook-routing-signature.test.js` passes | Confirmed |

## Auth And Serialization

| Check | Evidence | Status |
| --- | --- | --- |
| Auth/check response uses safe user serializer | `routes/userRoutes.js` calls `toPublicAuthUser` | Confirmed |
| Login uses safe canonical user fields | Vendor login/session tests pass | Confirmed |
| Password reset invalidates old sessions | Session invalidation tests pass | Confirmed |
| Deleted/blocked users rejected | Auth controller tests cover blocked/deleted states | Confirmed |

## Environment Variables By Name Only

Relevant names observed in `.env.example` and source/test coverage:

- `ADMIN_EMAIL`
- `API_BASE_URL`
- `APP_NAME`
- `APP_URL`
- `AWS_ACCESS_KEY_ID`
- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_SECRET_ACCESS_KEY`
- `BILLING_PORTAL_RETURN_URL`
- `CANONICAL_FRONTEND_URL`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CONNECT_REFRESH_PATH`
- `CONNECT_REFRESH_URL`
- `CONNECT_RETURN_PATH`
- `CONNECT_RETURN_URL`
- `COOKIE_DOMAIN`
- `COOKIE_SAMESITE`
- `COOKIE_SECURE`
- `CORS_ORIGINS`
- `DEPLOYMENT_VERSION_LABEL`
- `ENABLE_SENTRY_DEBUG_ROUTE`
- `FRONTEND_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_GEOCODING_API_KEY`
- `JWT_SECRET`
- `LISTING_DEBUG`
- `MAIL_PASSWORD`
- `MAIL_USER`
- `MONGODB_URI`
- `NODE_ENV`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PLATFORM_FEE_CENTS`
- `PORT`
- `PUBLIC_FRONTEND_URL`
- `PUPPETEER_EXECUTABLE_PATH`
- `RELEASE_COMMIT_SHA`
- `RELEASE_ENVIRONMENT`
- `SENTRY_DSN`
- `SENTRY_ENABLED`
- `SENTRY_ENVIRONMENT`
- `SENTRY_PROFILES_SAMPLE_RATE`
- `SENTRY_RELEASE`
- `SENTRY_TRACES_SAMPLE_RATE`
- `STORAGE_PROVIDER`
- `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET`
- `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET`
- `STRIPE_ORDER_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`
- `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET`
- `SUPPORT_EMAIL`

## Remaining Security Runtime Proof

- Final-domain credentialed CORS in a browser with real cookies.
- Live OAuth callback state behavior on the final frontend host.
- Test-mode Stripe webhook delivery through the deployed API host.
- Test-mode Stripe Connect onboarding return/refresh with final-domain environment variables.
- Production health/ready release identity after promotion.
