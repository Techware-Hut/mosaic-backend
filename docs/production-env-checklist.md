# Production Environment Variable Checklist (AWS EB)

Use variable names from [README.md](../README.md) and [SETUP.md](../SETUP.md). **Do not use** legacy [.env.example](../.env.example) names (`STRIPE_ENDPOINT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_TWO`).

Set these in the Elastic Beanstalk environment configuration (or secret manager referenced by EB). Never commit real values to git.

---

## Required to boot

| Variable | Notes |
|----------|-------|
| `MONGODB_URI` | Production MongoDB (`config/Db.js`) |
| `JWT_SECRET` | Auth signing |
| `FRONTEND_URL` | CORS fallback + redirects; required by `authController.js`. Production should be the apex marketplace origin. |
| `CORS_ORIGINS` | Comma-separated explicit browser origins for CORS (recommended in production). When unset, falls back to `FRONTEND_URL` plus default production origins: apex, temporary app, and launch Vercel. No wildcard. See [`utils/corsOrigins.js`](../utils/corsOrigins.js). |
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
| `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` | Optional full URL overrides. Prefer `FRONTEND_URL` + path vars in production; use full overrides only for intentional QA/cutover windows. |

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
| `MAIL_USER` | OTP, order, onboarding mail SMTP login; From fallback |
| `MAIL_PASSWORD` | SMTP auth password/app password |
| `MAIL_HOST` | Optional provider-neutral transactional SMTP host; leave unset for Gmail fallback |
| `MAIL_PORT` | Optional provider-neutral transactional SMTP port |
| `MAIL_SECURE` | Optional provider-neutral transactional SMTP TLS flag |
| `MAIL_FROM` | Optional provider-neutral transactional mail From header |
| `ADMIN_EMAIL` | Admin notifications (vendor onboarding, contact form) — **not** required for auth OTP |
| `SUPPORT_EMAIL` | Optional; email templates |
| `APP_NAME` | Optional branding |
| `APP_URL` | Optional order email links |

**After changing mail env vars on EB:** restart the environment (or redeploy) so Node processes reload `process.env`. Env-only updates do not always reach running instances without restart.

**Readiness probe:** After deploy of `authEmail.configured` on `GET /api/ready`, `authEmail.configured: false` means `MAIL_USER` or `MAIL_PASSWORD` is missing/empty in the running process (names only — no SMTP probe, no secrets).

### Auth OTP email (registration / resend / unverified login)

OTP is sent **by email only** via Nodemailer SMTP (`utils/mailer.js` + `utils/smtpTransport.js`). There is no SMS/mobile OTP channel.

**Email delivery requires `MAIL_USER` and `MAIL_PASSWORD`.** `ADMIN_EMAIL` does not gate registration or forgot-password OTP delivery. Set `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, and `MAIL_FROM` for provider-neutral SMTP; leave `MAIL_HOST` unset to keep Gmail fallback.

**Production inbox smoke (disposable test account only):**

1. Set the SMTP `MAIL_*` env names on Elastic Beanstalk; **restart** the environment.
2. Run spaced probes (≥30s apart to avoid 429 rate limits): `./scripts/auth-email-smoke.ps1 -ApiBaseUrl https://api.mosaicbizhub.com -DisposableDomain <your-disposable-domain>`
3. Optional known-account forgot-password: set session-only `SMOKE_TEST_CUSTOMER_EMAIL` and `SMOKE_TEST_VENDOR_EMAIL` before running the script.
4. `POST /api/users/register` with a disposable email you control — expect **201** and inbox delivery within ~2 minutes.
5. Do **not** paste OTP values or credentials into tickets, Slack, or logs.

**Spaced probe matrix (status codes only in automation):**

| Probe | Route | Expected on success | Mail failure |
| --- | --- | ---: | ---: |
| Customer forgot-password | `POST /api/users/forgot-password` | 200 | 200 generic; verify inbox/logs |
| Vendor forgot-password | `POST /api/users/forgot-password` | 200 | 200 generic; verify inbox/logs |
| Customer register | `POST /api/users/register` | 201 | 502 `OTP_DELIVERY_FAILED` |
| Vendor register | `POST /api/users/register` (`role: business_owner`) | 201 | 502 |
| Resend OTP | `POST /api/users/resend-otp` | 200 | 502 |
| Unknown forgot-password | `POST /api/users/forgot-password` | 200 (generic body) | 200 (no enumeration) |

Wait **≥15 minutes** after a burst of failed probes that returned **429** before re-running auth email smoke from the same IP.

**When SMTP delivery fails**, registration/resend/unverified-login OTP endpoints return **502** with `code: OTP_DELIVERY_FAILED` (account may still be saved; user can retry via `POST /api/users/resend-otp` after mail recovery). Forgot-password remains generic **200** to avoid account enumeration.

**Log signatures for SMTP auth failure (grep EB logs — never log secrets):**

| Signature | Meaning |
|-----------|---------|
| `Auth OTP email delivery failed` | Application caught an auth OTP/password-reset send failure |
| `Resend OTP error:` | Unexpected error in resend handler (non-delivery paths) |
| `Login error:` | Unexpected error in login handler (non-delivery paths) |
| `code=EAUTH` | SMTP authentication rejected |
| `responseCode=535` | SMTP provider rejected auth; inspect provider settings without logging secrets |

Confirm no 6-digit OTP values and no `MAIL_PASSWORD` appear in log lines after auth smoke.

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
| `NEXT_PUBLIC_APP_URL` | `https://mosaicbizhub.com` |
| `NEXT_PUBLIC_CLIENT_BASE_URL` | `https://mosaicbizhub.com` if still required as fallback |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Live publishable key |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Address autocomplete |
| `JWT_SECRET` | Must match backend `JWT_SECRET` for the frontend Next proxy |

See `mosaic-biz-frontend/.env.example` when present.

---

## Observability (Sentry)

Optional production error monitoring. **Set `SENTRY_DSN` in EB only** — never commit the DSN to git.

| Variable | Required | Notes |
|----------|----------|-------|
| `SENTRY_DSN` | Yes (to enable) | From Sentry project settings |
| `SENTRY_ENVIRONMENT` | Recommended | e.g. `production` |
| `SENTRY_RELEASE` | Recommended | Match EB version label, e.g. `mosaic-<git-sha>` |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional | Default `0` (errors only) |
| `SENTRY_PROFILES_SAMPLE_RATE` | Optional | Default `0` |
| `SENTRY_ENABLED` | Optional | Set `false` to disable without removing DSN |
| `ENABLE_SENTRY_DEBUG_ROUTE` | Optional | `true` only during verification; exposes `GET /internal/sentry-debug` |

### Verification after enabling Sentry

1. Set `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, and `SENTRY_RELEASE=mosaic-<deployed-sha>` on EB.
2. Redeploy or restart the EB environment.
3. Temporarily set `ENABLE_SENTRY_DEBUG_ROUTE=true`.
4. `GET https://api.mosaicbizhub.com/internal/sentry-debug` — expect 500; confirm event in Sentry dashboard.
5. Set `ENABLE_SENTRY_DEBUG_ROUTE=false` before sign-off.

See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) § Observability.

---
