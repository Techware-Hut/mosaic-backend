# Authentication & JWT Documentation

> **Mosaic Biz Hub — Backend Auth Reference**  
> Last reviewed: 2026-06-08  
> Scope: Wave 2 – Normalise JWT payload shape across all auth flows

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Roles & Access Levels](#2-user-roles--access-levels)
3. [Auth Flows](#3-auth-flows)
   - [3.1 Standard Registration + OTP Verification](#31-standard-registration--otp-verification)
   - [3.2 Standard Login](#32-standard-login)
   - [3.3 Google OAuth (Web Redirect Flow)](#33-google-oauth-web-redirect-flow)
   - [3.4 Google OAuth — Profile Completion (Optional)](#34-google-oauth--profile-completion-optional)
   - [3.5 Forgot Password / Reset Password](#35-forgot-password--reset-password)
   - [3.6 Logout](#36-logout)
4. [JWT Payload Shape](#4-jwt-payload-shape)
5. [Cookie Strategy](#5-cookie-strategy)
6. [Middleware Chain](#6-middleware-chain)
   - [authenticate.js](#authenticatejs)
   - [isAdmin.js](#isadminjs)
   - [isBusinessOwner.js](#isbusinessownerjs)
   - [isBusinessOwnerOrAdmin.js](#isbusinessowneroradminjs)
   - [isCustomer.js](#iscustomerjs)
   - [requireVerifiedVendor.js](#requireverifiedvendorjs)
7. [Protected Route Map](#7-protected-route-map)
8. [Token Lifecycle](#8-token-lifecycle)
9. [Security Controls](#9-security-controls)
10. [Acceptance Criteria Checklist](#10-acceptance-criteria-checklist)

---

## 1. Overview

Mosaic Biz Hub uses **stateless JWT authentication** delivered via:

- **HTTP-only cookies** (`token`) — primary transport for web clients.
- **Authorization: Bearer \<token\>** header — supported for API / mobile clients.

Tokens are verified in the central `authenticate` middleware before any protected controller runs. After verification the full Mongoose `User` document is attached to `req.user`, so all downstream code works directly against the database record — **no business logic should read claim fields off the raw JWT**.

---

## 2. User Roles & Access Levels

| Role             | Description                              | Can access               |
|------------------|------------------------------------------|--------------------------| 
| `customer`       | Registered buyer / end-user              | Customer routes, orders, wishlist, cart |
| `business_owner` | Vendor / merchant registered on platform | Vendor onboarding, product/service/food management |
| `admin`          | Platform administrator                   | Admin panel, user management, category management, vendor verification |

Roles are stored in the `User` model (`role` field) and mirrored inside the JWT payload **for informational purposes only**. All authoritative role checks happen against `req.user.role` (from the DB), never against a raw claim.

---

## 3. Auth Flows

### 3.1 Standard Registration + OTP Verification

```
Client                         Server
  │                               │
  │  POST /api/users/register     │
  │  { name, email, password,     │
  │    mobile, role?, gender?,    │
  │    minorityType? }            │
  │──────────────────────────────►│
  │                               │  1. Validate inputs (express-validator)
  │                               │  2. Check duplicate email / mobile
  │                               │  3. bcrypt.hash(password, 12)
  │                               │  4. Generate 6-digit OTP → bcrypt.hash(otp, 10)
  │                               │  5. Save User (isOtpVerified: false)
  │                               │  6. Send OTP email
  │                               │  7. Set cookie: otpPending=true (10 min)
  │◄──────────────────────────────│
  │  201 { success: true }        │
  │                               │
  │  POST /api/users/verify-otp   │
  │  { email, otp }               │
  │──────────────────────────────►│
  │                               │  1. Find user by email
  │                               │  2. Check isBlocked / isDeleted
  │                               │  3. Check OTP expiry (10 min window)
  │                               │  4. bcrypt.compare(otp, user.otp)
  │                               │  5. Set user.isOtpVerified = true
  │                               │  6. Clear otp / otpExpiry fields
  │                               │  7. Send welcome email
  │                               │  ┌─────────────────────────────────────┐
  │                               │  │ jwt.sign(                           │
  │                               │  │   { userId: user._id, role },       │
  │                               │  │   JWT_SECRET,                       │
  │                               │  │   { expiresIn: '7d' }               │
  │                               │  │ )                                   │
  │                               │  └─────────────────────────────────────┘
  │                               │  8. setAuthCookies (token, user_session, user_gender)
  │                               │  9. clearCookie(otpPending)
  │◄──────────────────────────────│
  │  200 { token, user: {...} }   │
```

**Token produced:** `{ userId, role }` — 7-day expiry.

---

### 3.2 Standard Login

```
Client                         Server
  │                               │
  │  POST /api/users/login        │
  │  { email, password }          │
  │──────────────────────────────►│
  │                               │  1. Validate inputs
  │                               │  2. Find user by email (must have passwordHash)
  │                               │  3. Check isBlocked / isDeleted
  │                               │  4. bcrypt.compare(password, user.passwordHash)
  │                               │  5. If isOtpVerified === false:
  │                               │     → Generate new OTP, send email
  │                               │     → Set cookie: otpPending=true
  │                               │     → Return 403 { otpPending: true }
  │                               │  6. If verified:
  │                               │  ┌─────────────────────────────────────┐
  │                               │  │ jwt.sign(                           │
  │                               │  │   { userId: user._id, role },       │
  │                               │  │   JWT_SECRET,                       │
  │                               │  │   { expiresIn: '7d' }               │
  │                               │  │ )                                   │
  │                               │  └─────────────────────────────────────┘
  │                               │  7. setAuthCookies (token, user_session, user_gender)
  │◄──────────────────────────────│
  │  200 { token, user: {...} }   │
```

**Token produced:** `{ userId, role }` — 7-day expiry.

---

### 3.3 Google OAuth (Web Redirect Flow)

```
Client                         Server                      Google
  │                               │                            │
  │  GET /api/auth/google         │                            │
  │  ?redirect=<url>              │                            │
  │──────────────────────────────►│                            │
  │                               │  Build state (base64 JSON) │
  │◄──────────────────────────────│                            │
  │  302 → accounts.google.com    │                            │
  │                               │                            │
  │  [User consents at Google]    │                            │
  │                               │◄───────────────────────────│
  │  GET /api/auth/google/callback│  code + state              │
  │──────────────────────────────►│                            │
  │                               │  1. oauth.getToken(code)   │
  │                               │  2. oauth.verifyIdToken()  │
  │                               │  3. Extract: sub(googleId),│
  │                               │     email, name, picture   │
  │                               │  4. Upsert User by          │
  │                               │     googleId OR email       │
  │                               │  5. Check isBlocked/Deleted │
  │                               │  6. If REQUIRE_PROFILE_COMPLETION=true
  │                               │     & missing mobile/minority:
  │                               │  ┌──────────────────────────────────────┐
  │                               │  │ temp JWT: { sub: user._id,           │
  │                               │  │   email, role } — 15 min             │
  │                               │  └──────────────────────────────────────┘
  │                               │     → Set cookie: mbh_tmp
  │                               │     → Redirect /complete-profile
  │                               │  7. Else → mintSessionJWT(user):
  │                               │  ┌──────────────────────────────────────┐
  │                               │  │ jwt.sign(                            │
  │                               │  │   { sub: user._id, role },           │
  │                               │  │   JWT_SECRET,                        │
  │                               │  │   { expiresIn: '7d' }                │
  │                               │  │ )                                    │
  │                               │  └──────────────────────────────────────┘
  │                               │  8. setAuthCookies
  │◄──────────────────────────────│
  │  302 → redirect URL           │
```

**Token produced:** `{ sub, role }` — 7-day expiry.  
**Temp token produced (if profile completion needed):** `{ sub, email, role }` — 15-minute expiry.

---

### 3.4 Google OAuth — Profile Completion (Optional)

Only triggered when env `REQUIRE_PROFILE_COMPLETION=true` and user is missing `mobile` or `minorityType`.

```
Client                         Server
  │                               │
  │  POST /api/auth/google/complete
  │  Body: { mobile, minorityType? }
  │  Cookie: mbh_tmp              │
  │──────────────────────────────►│
  │                               │  1. Read cookie mbh_tmp
  │                               │  2. jwt.verify(tmpToken, JWT_SECRET)
  │                               │  3. Look up user by decoded.sub
  │                               │  4. Update user.mobile, user.minorityType
  │                               │  5. clearCookie(mbh_tmp)
  │                               │  6. mintSessionJWT → { sub, role } 7d
  │                               │  7. setAuthCookies
  │◄──────────────────────────────│
  │  200 { success, user }        │
```

---

### 3.5 Forgot Password / Reset Password

> This flow does **not** issue a JWT. It uses OTP stored on the user document.

```
Client                         Server
  │                               │
  │  POST /api/users/forgot-password
  │  { email }                    │
  │──────────────────────────────►│
  │                               │  1. Find user by email
  │                               │  2. Must have passwordHash (local account)
  │                               │  3. Generate 6-digit reset OTP
  │                               │  4. Store bcrypt hash in resetPasswordOtp
  │                               │  5. Store resetPasswordOtpExpiry (10 min)
  │                               │  6. Send password reset email
  │◄──────────────────────────────│
  │  200 { success: true, msg }   │
  │                               │
  │  POST /api/users/reset-password
  │  { email, otp, newPassword }  │
  │──────────────────────────────►│
  │                               │  1. Find user by email
  │                               │  2. Check resetPasswordOtpExpiry
  │                               │  3. bcrypt.compare(otp, resetPasswordOtp)
  │                               │  4. bcrypt.hash(newPassword, 12)
  │                               │  5. Clear resetPasswordOtp fields
  │◄──────────────────────────────│
  │  200 { success: true }        │
```

No JWT is issued during this flow. After password reset the user must re-login through [3.2 Standard Login](#32-standard-login).

---

### 3.6 Logout

Both local and Google logout call the same cookie-clearing logic.

| Endpoint                  | Controller          |
|---------------------------|---------------------|
| `POST /api/users/logout`  | `userController.logout` |
| (implicit via authController) | `authController.logout` |

**Cookies cleared:**
- `token` (httpOnly)
- `user_session` (non-httpOnly)
- `user_gender` (non-httpOnly)
- `otpPending` (on local logout)
- `mbh_tmp` (Google temp token, on OAuth logout)

---

## 4. JWT Payload Shape

All session tokens across every auth flow share the following canonical structure:

```json
{
  "sub": "<MongoDB ObjectId as string>",
  "role": "customer | business_owner | admin",
  "sessionVersion": 0,
  "iat": "<issued-at — auto-added by jsonwebtoken>",
  "exp": "<expiry — auto-added by jsonwebtoken>"
}
```

`sessionVersion` increments on password reset so older session JWTs are rejected by `authenticate.js` before the user re-logs in.

### Token Lifetimes

| Token Type         | Cookie / Header | Lifetime | Produced by                         |
|--------------------|-----------------|----------|-------------------------------------|
| Session token      | `token`         | 7 days   | Standard login, OTP verify          |
| Google session     | `token`         | 7 days   | Google OAuth callback               |
| Temp profile token | `mbh_tmp`       | 15 min   | Google OAuth (profile completion)   |

### Why `sub`

- `sub` (subject) is the **IANA-registered JWT claim** for the principal identity of a token ([RFC 7519 §4.1.2](https://datatracker.ietf.org/doc/html/rfc7519#section-4.1.2)).
- Google's own `idToken` uses `sub` — aligning avoids a second mental model.
- The `authController.mintSessionJWT` helper uses `sub`, so the Google OAuth flow is already correct.

### How `authenticate.js` reads the token

```js
// middlewares/authenticate.js — Line 20
const userId = decoded.userId || decoded.sub;
```

The middleware accepts `decoded.sub` (canonical) and still accepts legacy `decoded.userId` tokens issued before the Wave 2 migration. Both resolve to the same MongoDB `_id` used to fetch `req.user`.

---

## 5. Cookie Strategy

Cookies are managed centrally by [`utils/cookieHelper.js`](../utils/cookieHelper.js).

### Cookies Set on Successful Auth

| Cookie Name    | Value                   | httpOnly | Purpose                                    | Cleared on logout |
|----------------|-------------------------|----------|--------------------------------------------|-------------------|
| `token`        | JWT string              | ✅ Yes   | Auth token — read by `authenticate.js`     | ✅ Yes             |
| `user_session` | `"true"`                | ❌ No    | Frontend visibility flag (logged-in state) | ✅ Yes             |
| `user_gender`  | `user.gender \|\| ""`   | ❌ No    | UI personalisation hint                    | ✅ Yes             |
| `otpPending`   | `"true"`                | ✅ Yes   | Signals OTP step required                  | Cleared post-OTP  |
| `mbh_tmp`      | Temp JWT                | ✅ Yes   | Google profile-completion gate             | Cleared post-completion |

### Cookie Security Settings

| Setting      | Production            | Development   |
|--------------|-----------------------|---------------|
| `secure`     | `true` (env override) | `false`       |
| `sameSite`   | `"none"` (cross-site) | `"lax"`       |
| `domain`     | `.mosaicbizhub.com`   | `undefined`   |
| `path`       | `/`                   | `/`           |

---

## 6. Middleware Chain

### `authenticate.js`

**File:** [`middlewares/authenticate.js`](../middlewares/authenticate.js)  
**Used by:** All protected routes

**What it does:**
1. Reads token from `Authorization: Bearer <token>` header, or from `req.cookies.token`.
2. Calls `jwt.verify(token, JWT_SECRET)`.
3. Extracts user ID via `decoded.userId || decoded.sub`.
4. Fetches the full `User` document from MongoDB.
5. Attaches it to `req.user`.
6. Calls `next()` or returns `401`.

**Failure modes:**
- No token → `401 Authentication required`
- No user identifier in decoded payload → `401 Invalid authentication token`
- User not found in DB → `401 Authenticated user not found`
- Invalid/expired token (jwt.verify throws) → `401 Invalid or expired authentication token`

---

### `isAdmin.js`

**File:** [`middlewares/isAdmin.js`](../middlewares/isAdmin.js)  
**Always used after `authenticate`**

```js
if (req.user.role !== 'admin') → 403
```

---

### `isBusinessOwner.js`

**File:** [`middlewares/isBusinessOwner.js`](../middlewares/isBusinessOwner.js)  
**Always used after `authenticate`**

```js
if (req.user.role !== 'business_owner') → 403
```

---

### `isBusinessOwnerOrAdmin.js`

**File:** [`middlewares/isBusinessOwnerOrAdmin.js`](../middlewares/isBusinessOwnerOrAdmin.js)  
**Always used after `authenticate`**

```js
if (req.user.role !== 'business_owner' && req.user.role !== 'admin') → 403
```

---

### `isCustomer.js`

**File:** [`middlewares/isCustomer.js`](../middlewares/isCustomer.js)  
**Always used after `authenticate`**

```js
if (req.user.role !== 'customer') → 403
```

---

### `requireVerifiedVendor.js`

**File:** [`middlewares/requireVerifiedVendor.js`](../middlewares/requireVerifiedVendor.js)  
**Always used after `authenticate`**

Checks **two** conditions:
1. `req.user.role === 'business_owner'`
2. `req.user.isOtpVerified === true`

This is the strictest vendor guard — it ensures only fully email-verified vendors can access onboarding and business management endpoints.

---

## 7. Protected Route Map

### User / Auth Endpoints

| Method | Path                          | Auth            | Role Guard       |
|--------|-------------------------------|-----------------|------------------|
| POST   | `/api/users/register`         | ❌ Public        | —                |
| POST   | `/api/users/login`            | ❌ Public        | —                |
| POST   | `/api/users/logout`           | ❌ Public (clears cookies) | —      |
| POST   | `/api/users/verify-otp`       | ❌ Public        | —                |
| POST   | `/api/users/resend-otp`       | ❌ Public        | —                |
| POST   | `/api/users/forgot-password`  | ❌ Public        | —                |
| POST   | `/api/users/reset-password`   | ❌ Public        | —                |
| GET    | `/api/users/auth/check`       | ✅ `authenticate` | —               |
| GET    | `/api/auth/google`            | ❌ Public        | —                |
| GET    | `/api/auth/google/callback`   | ❌ Public (handled internally) | — |
| POST   | `/api/auth/google/complete`   | ✅ `mbh_tmp` cookie | —             |

### Admin Endpoints

| Method  | Path                             | Auth             | Role Guard  |
|---------|----------------------------------|------------------|-------------|
| GET     | `/admin/users/`                  | ✅ `authenticate` | `isAdmin`   |
| GET     | `/admin/users/:id`               | ✅ `authenticate` | `isAdmin`   |
| PUT     | `/admin/users/:id`               | ✅ `authenticate` | `isAdmin`   |
| DELETE  | `/admin/users/:id`               | ✅ `authenticate` | `isAdmin`   |
| PUT     | `/admin/users/:id/block`         | ✅ `authenticate` | `isAdmin`   |
| POST    | `/admin/users/admins`            | ✅ `authenticate` | `isAdmin`   |
| GET     | `/admin/faqs`, `/admin/api/blogs`, etc. | ✅ `authenticate` | `isAdmin` |

### Vendor / Business Owner Endpoints

| Method | Path                                        | Auth             | Role Guard                 |
|--------|---------------------------------------------|------------------|----------------------------|
| POST   | `/api/vendor-onboarding/draft`              | ✅ `authenticate` | `requireVerifiedVendor`    |
| GET    | `/api/vendor-onboarding/draft`              | ✅ `authenticate` | `requireVerifiedVendor`    |
| POST   | `/api/vendor-onboarding/submit`             | ✅ `authenticate` | `requireVerifiedVendor`    |
| GET    | `/api/vendor-onboarding/onboarding-data`    | ✅ `authenticate` | `requireVerifiedVendor`    |
| PUT    | `/api/vendor-onboarding/business-profile`   | ✅ `authenticate` | `requireStage1Verified` (via `requireVerifiedVendor.create`) |
| PATCH  | `/api/vendor-onboarding/business-profile`   | ✅ `authenticate` | `requireStage1Verified` (via `requireVerifiedVendor.create`) |
| GET    | `/api/vendor-onboarding/stage1/upload-url`  | ✅ `authenticate` | `requireVerifiedVendor`    |
| POST   | `/api/vendor-onboarding/stage1/create-payment` | ✅ `authenticate` | `requireVerifiedVendor` |

### Admin-only Vendor Verification Endpoints

| Method | Path                                              | Auth             | Role Guard |
|--------|---------------------------------------------------|------------------|------------|
| GET    | `/api/vendor-onboarding/pending`                  | ✅ `authenticate` | `isAdmin`  |
| GET    | `/api/vendor-onboarding/:applicationId`           | ✅ `authenticate` | `isAdmin`  |
| POST   | `/api/vendor-onboarding/:applicationId/verify`    | ✅ `authenticate` | `isAdmin`  |
| POST   | `/api/vendor-onboarding/:applicationId/finalize`  | ✅ `authenticate` | `isAdmin`  |

---

## 8. Token Lifecycle

```
┌────────────────────────────────────────────────────────────────────┐
│                       TOKEN LIFECYCLE                              │
│                                                                    │
│  Register   → [OTP email]                                         │
│  verify-otp → JWT issued (7d) → cookies set → user is logged in   │
│                                                                    │
│  Login      → JWT issued (7d) → cookies set → user is logged in   │
│                                                                    │
│  Google     → code exchange → JWT issued (7d) → cookies set       │
│  (no OTP)     [optional: temp 15min JWT if profile incomplete]     │
│                                                                    │
│  Forgot PW  → OTP stored on User doc (no JWT)                     │
│  Reset PW   → OTP validated → password updated → no JWT           │
│             → User must re-login                                   │
│                                                                    │
│  Logout     → cookies cleared → token effectively invalidated      │
│             → (no server-side blacklist; token still valid         │
│               until expiry if captured elsewhere)                  │
└────────────────────────────────────────────────────────────────────┘
```

> **Note on token invalidation:** The system is stateless — there is no token blacklist or refresh-token mechanism. A logged-out token remains cryptographically valid until its `exp` claim passes. This is acceptable for MVP.

---

## 9. Security Controls

| Control                        | Implementation                                                          |
|--------------------------------|-------------------------------------------------------------------------|
| Password hashing               | `bcrypt.hash(password, 12)` (cost factor 12)                            |
| OTP hashing                    | `bcrypt.hash(otp, 10)`                                                  |
| OTP expiry                     | 10-minute window for registration + password reset OTPs                 |
| Rate limiting                  | express-rate-limit on register (5/15min), login (15/15min), OTP (10/15min) |
| Input sanitisation             | `express-mongo-sanitize` (NoSQL injection), `xss-clean` (XSS)          |
| Account checks                 | `isBlocked` and `isDeleted` checked in every flow before token issue    |
| Cookie flags                   | `httpOnly`, `secure` (prod), `sameSite` (configured per environment)    |
| CORS                           | Allowlist-based, credentials: true                                      |
| Google token verification      | `OAuth2Client.verifyIdToken()` with audience validation                 |
| Role enforcement               | Always via `req.user.role` (from DB), never from raw JWT claim          |

---

## 10. Acceptance Criteria Checklist

Use this checklist to confirm Wave 2 is complete after code changes are applied.

- [x] **One canonical JWT payload shape** — session tokens use `{ sub, role, sessionVersion }` in both `buildSessionToken` and `mintSessionJWT`.
- [x] **`authenticate.js` accepts `sub`** — legacy `decoded.userId` fallback retained for older tokens until they expire.
- [x] **Safe public user JSON** — [`utils/toPublicAuthUser.js`](../utils/toPublicAuthUser.js) used by login, OTP verify, auth/check, and Google profile completion.
- [x] **Standard login still works** — POST `/api/users/login` returns a valid token, sets cookies, and protected routes recognise the user.
- [x] **OTP verify still works** — POST `/api/users/verify-otp` returns a valid token after registration.
- [x] **Google OAuth login still works** — redirect flow completes and the session cookie is accepted by `authenticate.js`.
- [x] **Profile completion still works** — `mbh_tmp` cookie is verified and user is updated.
- [x] **Invalid tokens fail safely** — tampered, expired, or stale `sessionVersion` tokens return `401`, not `500`.
- [x] **All session tokens expire at 7 days** — both local and Google OAuth use the same TTL.
- [ ] **Remove legacy `userId` JWT fallback** — delete `|| decoded.userId` in `authenticate.js` after all outstanding tokens expire (post-migration cleanup).
- [ ] **Admin user list field redaction** — `GET /admin/users` still returns hashed OTP/reset metadata (admin-only hardening).
