# Stripe Connect Domain Verification

**Issue:** [#82 Stripe Connect return and refresh URL domain alignment](https://github.com/Techware-Hut/mosaic-backend/issues/82)  
**Branch:** `release/backend-post-merge-production-stabilization`  
**Frontend routes:** `/partners/connect/return`, `/partners/connect/refresh`  
**Evidence date:** 2026-06-22  

No secrets in this document.

---

## Code audit

| Item | Result |
|------|--------|
| Helper location | [`lib/connect/connectUrls.js`](../lib/connect/connectUrls.js) (extracted from controller) |
| Controller | [`controllers/connectController.js`](../controllers/connectController.js) — `createAccountLink`, `getStatus` |
| Route mounts | [`routes/connectRoutes.js`](../routes/connectRoutes.js) — `POST /api/connect/:businessId/account-link`, `GET .../status` |
| Default return path | `/partners/connect/return` |
| Default refresh path | `/partners/connect/refresh` |
| URL construction | `CONNECT_*_URL` override OR `FRONTEND_URL` + `CONNECT_*_PATH` + `?businessId=` |
| Webhook/payout logic touched | **Not Tested** — out of scope; no changes |

Unit tests: [`tests/connect/connect-urls.test.js`](../tests/connect/connect-urls.test.js) — **Passed**

---

## Environment intent matrix

| Environment | `FRONTEND_URL` (expected) | Return URL shape |
|-------------|---------------------------|------------------|
| Production | `https://app.mosaicbizhub.com` | `https://app.mosaicbizhub.com/partners/connect/return?businessId=<id>` |
| QA / launch Vercel | `https://mosaic-biz-frontend-launch.vercel.app` | Same path on launch host (via override or FRONTEND_URL) |

**Note:** Production EB should use `FRONTEND_URL=https://app.mosaicbizhub.com`. Use `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` only when a full override is intentionally required.

---

## Runtime verification

| Step | Result | Notes |
|------|--------|-------|
| Unauth `POST /api/connect/:id/account-link` | **Passed** — 401 | Production smoke P5.1 |
| Authenticated account-link returns Stripe URL | **Blocked** | Requires `SMOKE_TEST_VENDOR_TOKEN` + approved test businessId |
| Return URL base matches EB `FRONTEND_URL` | **Not Tested** | Requires EB safe-value verification (issue #83) |
| Refresh URL base matches intent | **Not Tested** | Same |
| Interrupted onboarding regenerate link | **Not Tested** | Requires live vendor session |
| Connect status recheck | **Not Tested** | Requires vendor token |
| Webhook / payout behavior | **Not Tested** | Out of scope |

---

## PR split decision

Connect **code** aligns with frontend route expectations. No connect controller logic change required for domain alignment.

**Include in #83/#84 PR:** URL helper extraction + unit tests + this doc.  
**Separate #82 PR:** Not required unless EB `FRONTEND_URL` drift is found at runtime (operator env fix only).

---

## Manual verification (post-redeploy)

1. Set session env: `SMOKE_TEST_VENDOR_TOKEN`, test `businessId` (disposable fixture only).
2. `POST https://api.mosaicbizhub.com/api/connect/<businessId>/account-link` with Bearer token.
3. Confirm 200 + Stripe onboarding URL (do not complete onboarding in production without approval).
4. Verify EB `FRONTEND_URL` matches intended frontend host before relying on default URL builder.

---

## Rollback

Revert EB `FRONTEND_URL` / Connect overrides; redeploy previous application version. No schema migration.
