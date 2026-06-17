# Wave 2 Auth Verification — Asana Sign-Off Evidence

**Date:** 2026-06-08  
**Branch:** `staging`  
**Verifier:** automated + smoke script

---

## Automated tests

```bash
npm test
```

**Result:** **14/14 pass** (2026-06-08)

```
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

| Test file | Coverage |
|-----------|----------|
| `tests/auth/auth-check-payload.test.js` | `toPublicAuthUser`, auth/check whitelist, `sub` JWT claim |
| `tests/auth/password-reset-session-invalidation.test.js` | sessionVersion bump, stale JWT 401 |
| `tests/auth/password-reset-abuse-protection.test.js` | forgot generic response, reset OTP abuse |
| `tests/auth/google-oauth-security.test.js` | OAuth rate limits, temp cookie TTL |
| `tests/admin/vendorOnboardVerifyStage1.pending-applications.test.js` | admin pending apps |

---

## Smoke script

```bash
node scripts/verify-auth-check-smoke.js
```

**Result:** **PASS** (2026-06-08)

| Check | Result |
|-------|--------|
| Unauthenticated auth/check | 401 PASS |
| Customer auth/check | 200 PASS — keys: id, name, email, role, gender, mobile, isOtpVerified |
| Vendor auth/check | 200 PASS — role=business_owner |
| Admin auth/check | 200 PASS — role=admin |
| `/admin` page | HTTP 200 |
| `/partners/products` page | HTTP 200 |
| `/checkout/address?type=cart` page | HTTP 200 |

---

## Asana tasks — mark **Complete**

| Task | Evidence |
|------|----------|
| auth/check sensitive data leak | `toPublicAuthUser` via [`utils/toPublicAuthUser.js`](../utils/toPublicAuthUser.js) + [`routes/userRoutes.js`](../routes/userRoutes.js) |
| OTP values removed from logs | No `console.log` OTP in [`controllers/userController.js`](../controllers/userController.js) |
| Password reset session invalidation | `sessionVersion++` + authenticate rejection — tests pass |
| Forgot-password enumeration protection | Generic response — test pass |
| Reset OTP abuse protection | Max attempts + expiry cleanup — tests pass |
| Google OAuth rate limiting | [`routes/authRoutes.js`](../routes/authRoutes.js) — test pass |
| Google profile-completion cookie TTL | test pass |

---

## Wave 2 code changes applied

1. Shared [`utils/toPublicAuthUser.js`](../utils/toPublicAuthUser.js) — login, verify-otp, auth/check, Google complete
2. `buildSessionToken` migrated to `{ sub, role, sessionVersion }` (matches Google OAuth)
3. [`docs/auth.md`](../auth.md) §4/§10 updated for `sessionVersion` and checklist status

---

## Remaining open (post Wave 2)

- Remove legacy `decoded.userId` fallback in `authenticate.js` after token expiry window
- Admin `GET /admin/users` field redaction (hashed OTP/reset metadata)
