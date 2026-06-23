# EB Environment Drift Audit

**Issue:** [#83 EB environment variable drift audit](https://github.com/Techware-Hut/mosaic-backend/issues/83)  
**Branch:** `release/backend-post-merge-production-stabilization`  
**EB application:** `mosaic-biz-hub-backend`  
**EB environment:** `mosaic-backend-env`  
**Region:** `us-east-1`  
**Evidence date:** 2026-06-22  

No secret values in this document. Variable **names** only.

---

## Audit method

| Source | Status |
|--------|--------|
| Code `process.env` usage | **Passed** — grep + inventory docs |
| [ENV_VAR_INVENTORY.md](ENV_VAR_INVENTORY.md) | **Passed** |
| [production-env-checklist.md](production-env-checklist.md) | **Passed** |
| AWS CLI EB name inventory | **Blocked** — AWS CLI not available in audit session |
| Runtime inference | **Passed** — partial (see below) |

**Client/Operator Action Required:** Run in AWS session with EB access:

```powershell
aws elasticbeanstalk describe-configuration-settings `
  --application-name mosaic-biz-hub-backend `
  --environment-name mosaic-backend-env `
  --region us-east-1 `
  --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment'].[OptionName,Value]" `
  --output table
```

Redact secret values before sharing; compare **names** to this matrix.

---

## Runtime inference (production API, no secrets)

| Signal | Inference |
|--------|-------------|
| `/api/health` release.environment = `production` | `NODE_ENV=production`, `RELEASE_ENVIRONMENT=production` (or equivalent) |
| release.commit = `403d68e`, deploymentVersion = `mosaic-403d68e` | Release identity vars set; **stale** vs `main` `0af8803` |
| `/api/ready` database connected | `MONGODB_URI` present and valid |
| Public listings 200 | Core app booted; Stripe/email not probed |
| CORS 204 + exact ACAO for app + launch Vercel | `CORS_ORIGINS` likely includes both origins |
| OPTIONS credentials=true | Cookie auth path configured |

---

## Priority drift matrix

| Variable | Used by code | Documented | Inferred prod | Expected safe value | Action | Redeploy | Owner |
|----------|--------------|------------|---------------|---------------------|--------|----------|-------|
| `NODE_ENV` | yes — [`utils/corsOrigins.js`](../utils/corsOrigins.js) | yes | **Inferred yes** | `production` | Verify in EB | restart if changed | release owner |
| `FRONTEND_URL` | yes — auth, Connect | yes | **Not verified** | `https://app.mosaicbizhub.com` | Verify matches production frontend | yes if wrong | release owner |
| `CORS_ORIGINS` | yes — [`utils/corsOrigins.js`](../utils/corsOrigins.js) | yes | **Inferred yes** | `https://mosaic-biz-frontend-launch.vercel.app,https://app.mosaicbizhub.com,https://mosaicbizhub.com,https://www.mosaicbizhub.com` | Verify full list in EB; **replaces fallback when set** | restart | release owner |
| `API_BASE_URL` | yes — OAuth | yes | **Not verified** | `https://api.mosaicbizhub.com` | Verify in EB | yes if wrong | release owner |
| `COOKIE_DOMAIN` | yes — auth cookies | yes | **Not verified** | `.mosaicbizhub.com` | Verify for cross-subdomain cookies | restart | release owner |
| `COOKIE_SECURE` | yes | yes | **Not verified** | `true` | Verify | restart | release owner |
| `COOKIE_SAMESITE` | yes | yes | **Not verified** | `none` (with Secure) | Verify | restart | release owner |
| `CONNECT_RETURN_PATH` | yes — [`lib/connect/connectUrls.js`](../lib/connect/connectUrls.js) | yes | **Inferred default** | `/partners/connect/return` | Verify or rely on default | redeploy only if code default wrong | backend |
| `CONNECT_REFRESH_PATH` | yes | yes | **Inferred default** | `/partners/connect/refresh` | Verify or rely on default | redeploy only | backend |
| `CONNECT_RETURN_URL` | yes | yes | **Not verified** | unset (use FRONTEND_URL + path) | Set only if override needed | restart | release owner |
| `CONNECT_REFRESH_URL` | yes | yes | **Not verified** | unset | Set only if override needed | restart | release owner |
| `RELEASE_COMMIT_SHA` | yes — [`utils/releaseIdentity.js`](../utils/releaseIdentity.js) | yes | **Inferred yes** (403d68e) | Must match deployed Git SHA after redeploy | **Update to `0af8803` post-deploy** | redeploy | release owner |
| `DEPLOYMENT_VERSION_LABEL` | yes | yes | **Inferred yes** (`mosaic-403d68e`) | `mosaic-<full-sha>` | Align on redeploy | redeploy | release owner |
| `RELEASE_ENVIRONMENT` | yes | yes | **Inferred yes** (`production`) | `production` | Verify | restart | release owner |
| `SENTRY_DSN` | yes — [`instrument.js`](../instrument.js) | yes | **Not verified** | set in EB only | Verify present if Sentry required | restart | release owner |
| `SENTRY_ENVIRONMENT` | yes | yes | **Not verified** | `production` | Align with RELEASE_ENVIRONMENT | restart | release owner |
| `SENTRY_RELEASE` | yes | yes | **Not verified** | `mosaic-<sha>` | Align on redeploy | redeploy | release owner |

---

## Stripe (names only — values in EB)

| Variable | Documented | Action |
|----------|------------|--------|
| `STRIPE_SECRET_KEY` | yes | Operator verify present (live key) |
| `STRIPE_ORDER_WEBHOOK_SECRET` | yes | Verify Dashboard endpoint match |
| `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | yes | Verify |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | yes | Verify |
| `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | yes | Verify |
| `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | yes | Verify |
| `PLATFORM_FEE_CENTS` | yes | Verify |
| `BILLING_PORTAL_RETURN_URL` | yes | Verify |

**Deprecated (remove if present):** `STRIPE_ENDPOINT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_TWO`

---

## MongoDB, email, AWS, Google OAuth (names only)

| Group | Variables |
|-------|-----------|
| MongoDB | `MONGODB_URI` |
| Email | `MAIL_USER`, `MAIL_PASSWORD`, `ADMIN_EMAIL`, `SUPPORT_EMAIL`, `APP_NAME`, `APP_URL` |
| AWS S3 | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Auth | `JWT_SECRET` |

All: **Operator Action Required** — confirm names present in EB; do not commit values.

---

## Drift findings summary

| Finding | Severity | Status |
|---------|----------|--------|
| Production commit 51 behind `main` | P0 | **Failed** — redeploy required |
| GHA deploy success but runtime still `403d68e` | P0 | **Failed** — investigate EB version swap |
| Full EB name export | P1 | **Blocked** — AWS CLI unavailable in session |
| CORS allowlist functional for app + launch | P1 | **Passed** (runtime smoke) |
| Connect URL code defaults match frontend routes | P2 | **Passed** (unit tests) |

---

## Manual EB actions after merge + redeploy

1. Set `RELEASE_COMMIT_SHA`, `DEPLOYMENT_VERSION_LABEL`, `SENTRY_RELEASE` to deployed SHA (`mosaic-0af8803…` or full SHA per workflow).
2. Confirm `FRONTEND_URL=https://app.mosaicbizhub.com` for production Connect return URLs.
3. Confirm `CORS_ORIGINS` includes required origins (see [CORS_PRODUCTION_SMOKE_PROOF.md](CORS_PRODUCTION_SMOKE_PROOF.md)).
4. Restart EB environment if env-only changes; full redeploy if code changed.

---

## Rollback

Revert EB application version to `mosaic-403d68e`; realign release identity env vars to match restored label.
