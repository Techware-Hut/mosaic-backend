# Production Environment Variable Checklist (AWS EB)

Use variable names from [README.md](../README.md) and [SETUP.md](../SETUP.md). **Do not use** legacy [.env.example](../.env.example) names (`STRIPE_ENDPOINT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_TWO`).

Set these in the Elastic Beanstalk environment configuration (or secret manager referenced by EB). Never commit real values to git.

---

## Required to boot

| Variable | Notes |
|----------|-------|
| `MONGODB_URI` | Production MongoDB (`config/Db.js`) |
| `JWT_SECRET` | Auth signing |
| `FRONTEND_URL` | CORS + redirects; required by `authController.js` |
| `GOOGLE_CLIENT_ID` | Module load throws if missing (`authController.js`) |
| `GOOGLE_CLIENT_SECRET` | Same |
| `API_BASE_URL` | Public production API base for OAuth callback (e.g. `https://api.mosaicbizhub.com`) |
| `NODE_ENV` | Set `production` on EB |
| `PORT` | Match EB platform (often `8080`) |

---

## Auth and cookies

| Variable | Notes |
|----------|-------|
| `COOKIE_DOMAIN` | Typically `.mosaicbizhub.com` in production |
| `COOKIE_SECURE` | `true` on HTTPS |
| `COOKIE_SAMESITE` | `none` when cross-site cookies needed |
| `REQUIRE_PROFILE_COMPLETION` | Optional (default `false`) |
| `TEMP_COOKIE_NAME` / `TEMP_COOKIE_TTL_SEC` | Optional OAuth profile completion |

---

## Stripe payments and webhooks (production live mode)

| Variable | Route |
|----------|-------|
| `STRIPE_SECRET_KEY` | All Stripe API calls (live key in production) |
| `STRIPE_ORDER_WEBHOOK_SECRET` | `POST /api/webhooks/stripe` |
| `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | `POST /api/stripe/webhook` |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | `POST /api/subscription/webhook` |
| `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | `POST /api/vendor-onboarding/webhook/payment` |
| `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | `POST /api/stripe/payment/webhook` |
| `PLATFORM_FEE_CENTS` | Order Connect fees |
| `BILLING_PORTAL_RETURN_URL` | Billing portal return |
| `CONNECT_RETURN_PATH` / `CONNECT_REFRESH_PATH` | Connect onboarding paths |
| `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` | Optional full URL overrides |

Webhook URL registration: [stripe-webhook-registration.md](stripe-webhook-registration.md)

---

## Uploads (S3)

| Variable |
|----------|
| `AWS_REGION` |
| `AWS_ACCESS_KEY_ID` |
| `AWS_SECRET_ACCESS_KEY` |
| `AWS_S3_BUCKET` |

---

## Email and notifications

| Variable | Required for |
|----------|--------------|
| `MAIL_USER` | OTP, order, onboarding mail |
| `MAIL_PASSWORD` | SMTP auth |
| `ADMIN_EMAIL` | Admin notifications |
| `SUPPORT_EMAIL` | Optional; email templates |
| `APP_NAME` | Optional branding |
| `APP_URL` | Optional order email links |

---

## Optional / future

`GOOGLE_GEOCODING_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PUPPETEER_EXECUTABLE_PATH`, `LISTING_DEBUG`, `CLOUDINARY_*`, `STORAGE_PROVIDER`

Note: Backend code does **not** read `STRIPE_PUBLIC_KEY` (frontend uses `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).

---

## Verification after setting env

1. Redeploy or restart EB environment.
2. Confirm boot logs: Mongo connected, no `Missing env` crash, no Stripe init errors.
3. `GET https://api.mosaicbizhub.com/` returns 200 JSON.
4. Stripe Dashboard → each webhook endpoint shows recent successful test delivery (after registration).

---

## Frontend production env (Vercel or host)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.mosaicbizhub.com/` |
| `NEXT_PUBLIC_CLIENT_BASE_URL` | `https://app.mosaicbizhub.com` (or current app host) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Live publishable key |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Address autocomplete |
| `JWT_SECRET` | Must match backend `JWT_SECRET` for middleware |

See `mosaic-biz-frontend/.env.example` when present.

---

## Observability (optional but recommended)

Set in Elastic Beanstalk only — **not** in GitHub Actions variables.

| Variable | Notes |
|----------|-------|
| `SENTRY_DSN` | Sentry project DSN; when unset, Sentry is disabled |
| `SENTRY_ENVIRONMENT` | e.g. `production` |
| `SENTRY_RELEASE` | e.g. `mosaic-<git-sha>` for deploy correlation |

After first deploy with `SENTRY_DSN`, verify a test event appears in the Sentry project dashboard. The SDK scrubs OTP, passwords, tokens, and webhook secrets from payloads ([`instrument.js`](../instrument.js)).
