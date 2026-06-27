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
| Production | `https://mosaicbizhub.com` | `https://mosaicbizhub.com/partners/connect/return?businessId=<id>` |
| Transition | `https://app.mosaicbizhub.com` | Temporary only until apex smoke passes |
| QA / launch Vercel | `https://mosaic-biz-frontend-launch.vercel.app` | Same path on launch host (via override or FRONTEND_URL) |

**Note:** Production EB should use the apex marketplace origin. Use `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` only when a full override is intentionally required.

Preferred launch configuration:

```text
FRONTEND_URL=https://mosaicbizhub.com
CONNECT_RETURN_PATH=/partners/connect/return
CONNECT_REFRESH_PATH=/partners/connect/refresh
```

Full URL overrides are valid for intentional QA or cutover windows, but they should not point at `https://app.mosaicbizhub.com` after apex launch except during a documented temporary rollback window.

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
5. If `CONNECT_RETURN_URL` / `CONNECT_REFRESH_URL` are set, verify they point to the intended apex or QA host and not an accidental legacy app default.

---

## Rollback

Revert EB `FRONTEND_URL` / Connect overrides; redeploy previous application version. No schema migration.
