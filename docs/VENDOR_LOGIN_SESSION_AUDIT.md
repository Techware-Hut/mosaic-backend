# Vendor Login Session Audit

**Issue context:** Verified vendor OTP succeeds; separate login from production frontend (`https://app.mosaicbizhub.com`) does not keep session.  
**Tracking:** [#81 Backend auth cookie and credentialed request verification](https://github.com/Techware-Hut/mosaic-backend/issues/81)  
**Branch:** `fix/backend-vendor-login-session-cookie-smoke`  
**Recorded:** 2026-06-18

No secrets, JWTs, cookies, OTPs, passwords, or real user data in this document.

---

## Root cause summary

**Backend login/session/cookie code does not treat vendors differently from customers.**

| Layer | Finding |
|-------|---------|
| `POST /api/users/login` | Same handler for all roles; gates are `isDeleted`, `isBlocked`, `isOtpVerified`, password only |
| JWT + cookies | Same `buildSessionToken` + `setAuthCookies` as customer OTP verify |
| `GET /api/users/auth/check` | No role or vendor onboarding gate |
| Vendor routes | `isBusinessOwner` / `requireVerifiedVendor` apply **after** auth succeeds |

**Verdict:** The reported failure on **separate login after OTP verification** is **not explained by vendor-specific backend login logic**. Credentialed production proof (2026-06-18) confirms the backend login/cookie chain works for a verified `business_owner` test account. **Ownership passes to frontend** ([#142](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/142), [#143](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/143), [#144](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/144)).

Most likely frontend causes:

1. Vendor login path not sending `credentials: 'include'`.
2. Session role check expecting `vendor` instead of `business_owner`.
3. Treating `GET /api/vendor-onboarding/onboarding-data` **404** (normal for fresh vendors) as logout.

---

## Code audit evidence

| File | Relevant behavior |
|------|-------------------|
| [`controllers/userController.js`](../controllers/userController.js) | `loginUser` lines 350–414 — no `role === 'business_owner'` branch |
| [`utils/cookieHelper.js`](../utils/cookieHelper.js) | `setAuthCookies` — `token`, `user_session`, `user_gender` |
| [`middlewares/authenticate.js`](../middlewares/authenticate.js) | Bearer or `cookies.token`; sessionVersion check only |
| [`middlewares/requireVerifiedVendor.js`](../middlewares/requireVerifiedVendor.js) | Used on onboarding routes, not login/auth/check |
| [`controllers/vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js) | `getOnboardingData` → **404** when no onboarding doc (expected pre-draft) |

Unit tests added:

- [`tests/auth/vendor-login-session.test.js`](../tests/auth/vendor-login-session.test.js) — verified vendor login 200 + cookies; unverified/blocked/deleted paths
- [`tests/auth/cookie-helper-prod-options.test.js`](../tests/auth/cookie-helper-prod-options.test.js) — prod cookie flag defaults and empty-domain guard

`npm test`: **212/212 PASS** (includes new tests).

---

## Production repro (redacted)

Script: [`scripts/vendor-login-session-proof.ps1`](../scripts/vendor-login-session-proof.ps1)

```powershell
./scripts/vendor-login-session-proof.ps1 -ApiBaseUrl https://api.mosaicbizhub.com -FrontendOrigin https://app.mosaicbizhub.com
```

### Public / unauth probes (2026-06-18)

| Probe | HTTP | Result |
|-------|------|--------|
| CORS preflight `OPTIONS /api/users/login` from `https://app.mosaicbizhub.com` | 204 | **PASS** — ACAO exact origin, `Access-Control-Allow-Credentials: true` |
| `GET /api/users/auth/check` (no cookie) | 401 | **PASS** — `{"success":false,"message":"Authentication required"}` |

### Credentialed vendor login chain (2026-06-18)

Run with session-only env vars (`SMOKE_TEST_VENDOR_EMAIL`, `SMOKE_TEST_VENDOR_PASSWORD`) — never commit credentials.

| Probe | HTTP | Result |
|-------|------|--------|
| `POST /api/users/login` (verified vendor) | 200 | **PASS** — `success: true`, `user.role: business_owner`, `user.isOtpVerified: true` |
| `Set-Cookie` attributes | — | **PASS** — `token` (HttpOnly, Secure, SameSite=None, Domain=.mosaicbizhub.com, Path=/), `user_session`, `user_gender` |
| Cookie `GET /api/users/auth/check` | 200 | **PASS** — `loggedIn: true`, `user.role: business_owner` |
| Cookie `GET /api/business/my` | 200 | **PASS** |
| Cookie `GET /api/vendor-onboarding/onboarding-data` | 404 | **PASS** — expected for fresh vendor (no onboarding draft); **not an auth failure** |

Cookie values and JWT bodies redacted in script output. Re-run:

```powershell
$env:SMOKE_TEST_VENDOR_EMAIL = '<session-only>'
$env:SMOKE_TEST_VENDOR_PASSWORD = '<session-only>'
./scripts/vendor-login-session-proof.ps1 -ApiBaseUrl https://api.mosaicbizhub.com -FrontendOrigin https://app.mosaicbizhub.com
```

---

## Backend change in this branch

[`utils/cookieHelper.js`](../utils/cookieHelper.js) — defensive hardening only:

- Omit `domain` when `COOKIE_DOMAIN` is empty/whitespace (avoids invalid `domain=` on EB misconfig)
- Normalize `COOKIE_SAMESITE` to lowercase (`None` → `none`)

No change to login vendor logic, CORS, or Stripe paths.

---

## Frontend handoff (credentialed prod proof **PASS**)

Backend cookie/session chain verified against production API. Verify on `https://app.mosaicbizhub.com`:

1. Vendor login uses `POST /api/users/login` with `credentials: 'include'`.
2. Session role check uses **`business_owner`**, not `vendor`.
3. `GET /api/vendor-onboarding/onboarding-data` **404** routes to onboarding wizard, not logout.
4. `GET /api/users/auth/check` uses same credentialed fetch as customer dashboard.

---

## References

- [`docs/AUTH_FLOW.md`](AUTH_FLOW.md)
- [`docs/BACKEND_FRONTEND_ROUTE_CONTRACT.md`](BACKEND_FRONTEND_ROUTE_CONTRACT.md)
- [`docs/BACKEND_PRODUCTION_SMOKE_PROOF.md`](BACKEND_PRODUCTION_SMOKE_PROOF.md) — vendor login session section
- [`docs/production-env-checklist.md`](production-env-checklist.md) — `COOKIE_*` env names
