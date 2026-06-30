# Backend Environment Variables — Names Only

**Evidence date:** 2026-06-19  
**Rule:** Variable **names** only — never commit or document secret values.

**Sources:** [`.env.example`](../../.env.example), codebase `process.env` usage, [`../ENV_VAR_INVENTORY.md`](../ENV_VAR_INVENTORY.md)

**Local dev note:** App loads **`.env` only** via `dotenv.config()` in [`index.js`](../../index.js). `.env.local` is not loaded by the application.

---

## Classification key

| Class | Meaning |
| --- | --- |
| **required-prod** | Production boot or core flows fail without it |
| **required-local** | Needed for local dev of exercised features |
| **optional** | Feature-specific or safe default exists |
| **deprecated** | Legacy name — do not use |

---

## Core runtime

| Variable | Class | Notes |
| --- | --- | --- |
| `PORT` | optional | Default `3001`; EB often `8080` |
| `NODE_ENV` | required-prod | `production` on EB |
| `MONGODB_URI` | required-prod | MongoDB connection string |
| `JWT_SECRET` | required-prod | JWT signing |
| `FRONTEND_URL` | required-prod | CORS fallback, redirects, email links |
| `CORS_ORIGINS` | recommended-prod | Comma-separated browser origins |
| `API_BASE_URL` | required-prod | OAuth callback base |

---

## Auth and OAuth

| Variable | Class | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | required-prod | Required at auth module load |
| `GOOGLE_CLIENT_SECRET` | required-prod | Google OAuth |
| `REQUIRE_PROFILE_COMPLETION` | optional | OAuth profile completion gate |
| `TEMP_COOKIE_NAME` | optional | OAuth temp cookie |
| `TEMP_COOKIE_TTL_SEC` | optional | OAuth temp cookie TTL |

---

## Auth cookies

| Variable | Class | Notes |
| --- | --- | --- |
| `COOKIE_DOMAIN` | optional | Prod default `.mosaicbizhub.com` when unset |
| `COOKIE_SECURE` | optional | Prod default `true` |
| `COOKIE_SAMESITE` | optional | Prod cross-site often `none` |

---

## Stripe

| Variable | Class | Webhook route |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | required-prod | All Stripe API |
| `STRIPE_ORDER_WEBHOOK_SECRET` | required-prod | `POST /api/webhooks/stripe` |
| `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | required-prod | `POST /api/stripe/webhook` |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | required-prod | `POST /api/subscription/webhook` |
| `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | required-prod | `POST /api/vendor-onboarding/webhook/payment` |
| `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | required-prod | `POST /api/stripe/payment/webhook` |
| `PLATFORM_FEE_CENTS` | optional | Connect order fee; default `0` |
| `BILLING_PORTAL_RETURN_URL` | optional | Billing portal |
| `CONNECT_RETURN_PATH` | optional | Default `/partners/connect/return` |
| `CONNECT_REFRESH_PATH` | optional | Default `/partners/connect/refresh` |
| `CONNECT_RETURN_URL` | optional | Full URL override |
| `CONNECT_REFRESH_URL` | optional | Full URL override |

### Deprecated Stripe names

| Variable | Replacement |
| --- | --- |
| `STRIPE_ENDPOINT_SECRET` | Per-route secrets above |
| `STRIPE_WEBHOOK_SECRET` | Per-route secrets above |
| `STRIPE_WEBHOOK_SECRET_TWO` | Per-route secrets above |
| `STRIPE_PUBLIC_KEY` | Frontend `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` only |

---

## AWS S3

| Variable | Class |
| --- | --- |
| `AWS_REGION` | required-prod (upload flows) |
| `AWS_ACCESS_KEY_ID` | required-prod |
| `AWS_SECRET_ACCESS_KEY` | required-prod |
| `AWS_S3_BUCKET` | required-prod |
| `S3_UPLOAD_CORS_ORIGINS` | optional-prod |
| `STORAGE_PROVIDER` | optional (`aws`) |

---

## Email and notifications

| Variable | Class |
| --- | --- |
| `MAIL_USER` | required-prod (email flows) |
| `MAIL_PASSWORD` | required-prod |
| `ADMIN_EMAIL` | required-prod (admin notifications) |
| `SUPPORT_EMAIL` | optional |
| `APP_NAME` | optional |
| `APP_URL` | optional (email links) |

---

## Google (optional beyond OAuth)

| Variable | Class |
| --- | --- |
| `GOOGLE_GEOCODING_API_KEY` | optional |

---

## Cloudinary (legacy)

| Variable | Class |
| --- | --- |
| `CLOUDINARY_CLOUD_NAME` | optional |
| `CLOUDINARY_API_KEY` | optional |
| `CLOUDINARY_API_SECRET` | optional |

---

## PayPal (legacy/alternate)

| Variable | Class |
| --- | --- |
| `PAYPAL_CLIENT_ID` | optional |
| `PAYPAL_CLIENT_SECRET` | optional |

---

## PDF / debug

| Variable | Class |
| --- | --- |
| `PUPPETEER_EXECUTABLE_PATH` | optional |
| `LISTING_DEBUG` | optional |

---

## Sentry (optional)

| Variable | Class |
| --- | --- |
| `SENTRY_DSN` | optional |
| `SENTRY_ENVIRONMENT` | optional |
| `SENTRY_RELEASE` | optional |
| `SENTRY_TRACES_SAMPLE_RATE` | optional |
| `SENTRY_PROFILES_SAMPLE_RATE` | optional |
| `SENTRY_ENABLED` | optional |
| `ENABLE_SENTRY_DEBUG_ROUTE` | optional |

---

## Release identity (recommended for EB production)

| Variable | Class |
| --- | --- |
| `RELEASE_COMMIT_SHA` | recommended |
| `RELEASE_ENVIRONMENT` | recommended |
| `DEPLOYMENT_VERSION_LABEL` | recommended |

See [BACKEND_RELEASE_IDENTITY.md](BACKEND_RELEASE_IDENTITY.md).

---

## CI / GitHub Actions (not app runtime)

Set in workflows only — see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`.github/workflows/deploy-eb-production.yml`](../../.github/workflows/deploy-eb-production.yml):

- `AWS_REGION`, `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`, `PRODUCTION_API_URL` (workflow vars)

---

## Evidence needed

| Item | Owner |
| --- | --- |
| EB production env var audit sign-off (names present, values not in repo) | AWS / release owner |
| Drift between `.env.example` and EB live config | Compare with [`../production-env-checklist.md`](../production-env-checklist.md) |

Full inventory: [`../ENV_VAR_INVENTORY.md`](../ENV_VAR_INVENTORY.md)
