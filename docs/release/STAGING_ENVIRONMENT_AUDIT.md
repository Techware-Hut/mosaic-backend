# Staging Environment Audit

Date: July 7, 2026

Backend reference: `Techware-Hut/mosaic-backend` `staging` at `b838239b481f9f68be6f0c80ac527069a5d78964`.

Frontend reference: `Digital-Builders-757/mosaic-biz-frontend-launch` `develop` at `8163a3b39fd6b84813f476863a7243c719b23f7e`.

No secret values are included in this audit.

## Executive Summary

Mosaic Biz Hub does **not** currently have a complete, isolated staging environment for July 6 integrated UAT. The project has staging-like pieces: a backend `staging` branch with CI, a frontend `develop` branch with CI/build checks, Vercel preview/launch URLs, and production health/readiness probes. Those pieces are useful, but they are not the same as a true staging environment.

The clearest evidence is in the backend deploy workflow: `.github/workflows/deploy-eb-production.yml` deploys to Elastic Beanstalk only from `main` or manual dispatch, uses GitHub environment `production`, and probes `https://api.mosaicbizhub.com`. The backend `staging` branch runs CI but has no separate deployment workflow or separate API host in the repository.

Production promotion should remain blocked until either a minimum viable staging stack is provisioned or the team explicitly chooses controlled production UAT with written safeguards.

## Does Real Staging Exist?

**No.**

Current state is **partial**:

| Layer | Current state | Classification |
| --- | --- | --- |
| Backend code branch | `staging` branch exists and runs CI. | Partial |
| Backend deployed API | No committed staging API host or staging EB deploy workflow found. Production API exists at `https://api.mosaicbizhub.com`. | Missing |
| Frontend branch | `develop` branch exists and runs build/unit tests. | Partial |
| Frontend preview | Vercel preview/launch URLs are referenced and supported by CORS. | Partial |
| Data store | No separate staging MongoDB configuration found in repo. | Missing |
| Stripe | No separate staging Stripe test-mode environment found in repo. | Missing |
| Email | No separate staging email sandbox/restricted-recipient setup found in repo. | Missing |
| Uploads | No separate staging S3 bucket or prefix is configured in repo. | Missing |

Do not assume `staging` branch equals a staging environment. In this repo, `staging` is currently an integration branch, not proof of a deployed staging stack.

## Files Inspected

Frontend:

- `.github/workflows/build.yml`
- `.github/workflows/enforce-develop-to-main.yml`
- `next.config.ts`
- `package.json`
- `.env.example` names only
- `lib/api/httpClient.ts`
- `lib/api.ts`
- `lib/url/appUrl.ts`
- `lib/api/featured-products.ts`
- Source scans across `app`, `components`, `lib`, `hooks`, and `utils`

Backend:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-eb-production.yml`
- `.github/workflows/enforce-staging-to-main.yml`
- `.env.example` names only
- `package.json`
- `app.js`
- `config/Db.js`
- `utils/corsOrigins.js`
- `utils/cookieHelper.js`
- `utils/frontendUrl.js`
- `routes/healthRoutes.js`
- `docs/hosted-staging-decision.md`
- Source/docs scans for staging hosts, EB config, and environment names

## Frontend Environment Findings

There is no committed `vercel.json`. The repository relies on Vercel project settings plus GitHub Actions build validation.

`.github/workflows/build.yml` runs on pull requests to `main` and `develop`, plus pushes to `develop` and `main`. It installs dependencies, runs `npm run build`, and runs `npm run test:unit`. `.github/workflows/enforce-develop-to-main.yml` only allows `develop` to promote to `main`.

API base URL behavior:

| Runtime | Behavior found |
| --- | --- |
| Production | Most API clients use `NEXT_PUBLIC_API_BASE_URL`. `lib/api.ts` still has a fallback to the production API host if the env var is missing. |
| Preview | Preview can point at any backend if Vercel sets `NEXT_PUBLIC_API_BASE_URL` for that deployment. Repository code supports this, but no committed staging backend URL was found. |
| Development | Local development can use `.env.example` names and localhost-style values. |
| Staging | No dedicated staging frontend URL or staging API base URL is committed. |

Credential behavior:

- `lib/api/httpClient.ts` defaults `credentials` to `include`.
- `lib/api.ts` creates an Axios client with `withCredentials: true`.
- Many page-level calls also use `credentials: "include"` or `withCredentials: true`.

Frontend staging classification: **partial**. The frontend can be configured to talk to a non-production backend, but a real frontend staging environment is not proven without a deployed staging backend URL and Vercel environment configuration.

## Backend Environment Findings

Backend CI exists for `main` and `staging` in `.github/workflows/ci.yml`. The CI workflow runs:

- `npm test`
- `npm run test:contract`
- `npm run test:integration`

Backend deployment is production-only in committed workflow configuration. `.github/workflows/deploy-eb-production.yml`:

- runs on `push` to `main` and `workflow_dispatch`;
- uses GitHub environment `production`;
- deploys to Elastic Beanstalk using `EB_APPLICATION_NAME` and `EB_ENVIRONMENT_NAME`;
- sets `PRODUCTION_API_URL` to the production API host;
- runs post-deploy probes against production paths.

No `.elasticbeanstalk`, `.ebextensions`, `Procfile`, or `Dockerrun*` deployment configuration was found in the canonical backend worktree during this audit. Deployment is controlled by GitHub Actions.

Health/readiness routes exist:

- `GET /api/health`
- `GET /api/ready`
- `GET /api/build-info`

Production health/readiness probes returned HTTP 200 during this audit, but that proves production availability, not staging availability.

Backend staging classification: **missing** as a deployed environment. The `staging` branch is real; a separate hosted staging API is not proven.

## Env Var Names Needed

Names only. Values must stay out of docs and chat.

### Frontend / Vercel

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLIENT_BASE_URL`
- `NEXT_PUBLIC_AUTH_DEBUG`
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY`
- `NEXT_PUBLIC_RANKED_PATH`
- `NEXT_PUBLIC_RELEASE_COMMIT_SHA`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_STRIPE_MODE`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID`
- `NEXT_PUBLIC_VERCEL_ENV`
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF`
- `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`
- `NODE_ENV`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_RELEASE`
- `VERCEL_DEPLOYMENT_ID`
- `VERCEL_ENV`
- `VERCEL_GIT_COMMIT_REF`
- `VERCEL_GIT_COMMIT_SHA`

### Backend / AWS

Core/runtime:

- `PORT`
- `NODE_ENV`
- `MONGODB_URI`
- `FRONTEND_URL`
- `API_BASE_URL`
- `CORS_ORIGINS`

Auth/cookies/OAuth:

- `JWT_SECRET`
- `COOKIE_DOMAIN`
- `COOKIE_SECURE`
- `COOKIE_SAMESITE`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Stripe/payment/Connect:

- `STRIPE_SECRET_KEY`
- `STRIPE_ORDER_WEBHOOK_SECRET`
- `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET`
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`
- `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET`
- `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET`
- `CONNECT_RETURN_PATH`
- `CONNECT_REFRESH_PATH`
- `CONNECT_RETURN_URL`
- `CONNECT_REFRESH_URL`
- `BILLING_PORTAL_RETURN_URL`
- `PLATFORM_FEE_CENTS`

Email:

- `MAIL_USER`
- `MAIL_PASSWORD`
- `MAIL_HOST`
- `MAIL_PORT`
- `MAIL_SECURE`
- `MAIL_FROM`
- `ADMIN_EMAIL`
- `SUPPORT_EMAIL`
- `APP_NAME`
- `APP_URL`

Uploads/storage:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `S3_UPLOAD_CORS_ORIGINS`
- `STORAGE_PROVIDER`

Observability/deploy:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `SENTRY_TRACES_SAMPLE_RATE`
- `SENTRY_PROFILES_SAMPLE_RATE`
- `SENTRY_ENABLED`
- `ENABLE_SENTRY_DEBUG_ROUTE`
- `AWS_ROLE_TO_ASSUME`
- `EB_APPLICATION_NAME`
- `EB_ENVIRONMENT_NAME`

## CORS And Cookie Requirements

For true staging, CORS and cookies must be configured as their own environment, not borrowed from production.

Required decisions:

- Choose a staging frontend origin.
- Choose a staging backend API origin.
- Set backend `CORS_ORIGINS` to include the staging frontend origin and no wildcard.
- Set frontend `NEXT_PUBLIC_API_BASE_URL` to the staging backend API origin.
- Set backend `FRONTEND_URL` and link-generation env names to the staging frontend origin.
- Decide whether cookies should use a parent domain or host-only cookies.
- If the staging API is not under `mosaicbizhub.com`, do not use the production cookie domain.
- Keep `COOKIE_SECURE` true for HTTPS staging.
- Use `COOKIE_SAMESITE=none` only when cross-site cookie behavior is required and secure cookies are enabled.

## Stripe Test-Mode Requirements

True staging must use Stripe test mode only:

- separate `STRIPE_SECRET_KEY` test-mode value;
- separate frontend `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` test-mode value;
- separate webhook endpoints for every backend webhook route;
- separate webhook secrets for all five webhook env names;
- separate Connect onboarding/testing accounts;
- no live charges, live payouts, or production webhook destinations.

The current repository supports separate values by environment name, but no deployed staging Stripe setup was verified.

## Email And Upload Requirements

Email:

- Use a staging sender or restricted-recipient provider setup.
- Avoid emailing real customers.
- Confirm `MAIL_FROM` if using provider-neutral SMTP such as Resend SMTP.
- Confirm tracking email behavior with safe orders and redacted logs.

Uploads:

- Use a staging S3 bucket or staging-only prefix.
- Apply S3 CORS for staging frontend origins if using direct browser presigned uploads.
- Keep signed upload URLs out of screenshots and reports.
- Use safe JPEG/PDF fixtures with no private data.

## Data And Third-Party Service Requirements

Safe staging requires separate or isolated:

| Area | Required setup | Decision needed |
| --- | --- | --- |
| MongoDB | Separate staging database or cluster with non-production data. | Who provisions and seeds it? |
| Stripe | Test-mode keys, test-mode webhooks, Connect test accounts. | Who owns Stripe test setup? |
| Email | Sandbox sender or restricted recipients. | Which provider/sender is approved? |
| S3 | Staging bucket or staging prefix with safe IAM permissions. | Separate bucket vs prefix? |
| Test accounts | Admin, customer, product vendor, service vendor, food/restaurant vendor. | Who creates and stores credentials? |
| CORS/cookies | Matching staging frontend/backend origins and cookie settings. | Which exact staging domains are approved? |

## UAT Feasibility Table

| # | July 6 checklist item | True staging | Frontend preview only | Production only / without setup |
| --- | --- | --- | --- | --- |
| 1 | Image upload limit message | Testable end to end with staging account and upload storage. | UI copy can be inspected; real upload needs backend/storage. | Testable only with controlled production data. |
| 2 | Service offering count/display | Testable with seeded service vendor data. | Only if preview points to a real backend with data. | Testable with production test vendor. |
| 3 | Edit image gallery | Testable with staging product data and uploads. | Not enough without writable backend/storage. | Testable with production test listing. |
| 4 | Service feature editing | Testable with staging service vendor. | Not enough without writable backend. | Testable with production test vendor. |
| 5 | Service/restaurant payout messaging | Testable with staging vendor types and Stripe test state. | UI can be inspected if backed by data; Connect state needs backend. | Testable only with careful production account state. |
| 6 | Product description display | Testable with staging seeded product. | Partly testable with public/prod data or local fixture. | Testable on production public product. |
| 7 | Local shipping | Testable with staging vendor/customer addresses. | Not enough without cart/backend pricing state. | Testable with production test accounts. |
| 8 | Cart quantity decrease | Testable with staging customer cart. | Not enough without backend cart persistence. | Testable with production test cart. |
| 9 | Coupon cart-value logic | Testable with staging coupon and cart data. | Not enough without backend coupon validation. | Testable with production-safe coupon. |
| 10 | Cart vs checkout total match | Testable with staging cart/order initiation. | Not enough without backend pricing/order flow. | Testable with production test cart/order. |
| 11 | Shipment tracking email | Testable with staging email sandbox/restricted recipients. | Not testable from frontend preview alone. | Testable only with production-safe order and email evidence. |
| 12 | PDF upload | Testable with staging S3/API upload setup. | Not enough without backend/storage. | Testable only with safe production upload. |
| 13 | Admin application filters/profile review | Testable with staging admin and vendor applications. | Not enough without backend/admin data. | Testable with production test admin/application. |
| 14 | Approve/reject/request-changes/finalize | Testable with staging application lifecycle. | Not enough without backend/admin state. | Testable with production test application only. |
| 15 | Restaurant/service Stripe Connect messaging | Testable with staging vendor types and Stripe test mode. | Messaging can be inspected only if state is available. | Testable only with production-safe accounts; avoid live payout mutations. |

## Decision Matrix

| Option | What it tests well | What it does not test | Risk | Cost/time | Rollback | Recommended use |
| --- | --- | --- | --- | --- | --- | --- |
| A: Create proper staging now | Full integrated UAT, backend branch behavior, safe data mutations, Stripe test mode, email/upload proof. | Requires infra setup before testers begin. | Lowest release risk after setup. | Medium/high initial cost. | Destroy or disable staging resources; no production rollback needed. | Recommended for release-quality UAT before production promotion. |
| B: Use Vercel preview frontend against production backend | Frontend rendering and some UI behavior against real API shape. | Does not test backend `staging`; mutates production data; cannot safely validate email, upload, payment, or admin flows without production safeguards. | Medium/high. | Low setup if Vercel env already exists. | Revert frontend preview or stop using preview; production data changes may need cleanup. | Use only for read-only checks or very narrow smoke, not full July 6 UAT. |
| C: Controlled production UAT | Real infrastructure, real CORS/cookies, real email/upload behavior. | Does not provide pre-production safety; failures impact production data/users unless isolated. | Highest. | Low infra cost, high coordination cost. | Revert deployed PRs, disable test accounts/coupons, clean test data. | Acceptable only with written approval, dedicated test accounts, test data, no secret exposure, and a rollback owner. |

## Recommendation

Recommended next step: create a minimum viable staging environment before production promotion.

If time does not allow that, controlled production UAT can be acceptable only if Lionel and Bryan approve it in writing and the safeguards below are followed. Vercel preview against production backend is not enough for the July 6 checklist because most items require backend state, uploads, emails, admin lifecycle, or Stripe/Connect state.

## Minimum Viable Staging Plan

1. Provision a separate backend environment:
   - AWS EB app/environment or equivalent;
   - staging API domain with TLS;
   - deploy backend `staging` branch SHA.
2. Provision separate data/services:
   - staging MongoDB database/cluster;
   - Stripe test-mode keys and five webhook endpoints;
   - staging S3 bucket or prefix;
   - restricted email sender/recipients.
3. Configure frontend staging/preview:
   - Vercel environment using `NEXT_PUBLIC_API_BASE_URL` pointed at staging API;
   - staging frontend URL documented;
   - Stripe publishable test key configured.
4. Configure backend staging env names:
   - core, CORS, cookies, auth, Stripe, email, S3, and frontend URLs from the names-only inventory.
5. Create safe UAT accounts:
   - admin;
   - customer;
   - product vendor;
   - service vendor;
   - restaurant/food vendor.
6. Smoke the environment:
   - `GET /api/health`;
   - `GET /api/ready`;
   - CORS preflight from staging frontend to staging backend;
   - `GET /api/featured-products`;
   - login/session cookie round trip;
   - upload proof;
   - Stripe test webhook proof.
7. Run the July 6 UAT checklist and attach redacted evidence.

## Production UAT Safeguards

If production UAT is chosen:

- Require written Lionel technical approval and Bryan business approval.
- Use dedicated UAT accounts only.
- Use test products/services/coupons clearly marked as UAT.
- Avoid live payment/payout mutations unless separately approved.
- If payment must be tested, define the exact amount, refund plan, and owner before testing.
- Do not expose passwords, tokens, API keys, Stripe keys, AWS keys, DSNs, or signed upload URLs.
- Redact customer emails, addresses, phone numbers, order ids, and private names.
- Keep a rollback plan ready for each merged PR.
- Capture evidence against `docs/uat/JULY_6_UAT_TESTER_HANDOFF.md`.
- Stop testing immediately on any production-impacting regression.

## What Was Not Verified

- Vercel project environment variable values.
- AWS EB console configuration or existence of any out-of-repo staging environment.
- MongoDB Atlas databases or data separation.
- Stripe Dashboard test-mode webhook endpoint configuration.
- Resend/SMTP provider sender or recipient restrictions.
- S3 bucket CORS settings in AWS.
- Authenticated UAT flows, because no test credentials were used.
- Any deployment.

## Guardrails Confirmed

- No code changes were made by this audit.
- No deploy was performed.
- No merge was performed.
- `GET /api/featured-products` remains the canonical featured-products route.
- `/api/products/featured` was not introduced by this audit.
- Backend contract tests still guard the featured route and Stripe webhook raw-body order.
