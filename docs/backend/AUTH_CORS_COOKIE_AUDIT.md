# Auth, CORS, and Cookie Audit — As-Built

**Evidence date:** 2026-06-19  
**Sources:** [`middlewares/authenticate.js`](../../middlewares/authenticate.js), [`utils/cookieHelper.js`](../../utils/cookieHelper.js), [`utils/corsOrigins.js`](../../utils/corsOrigins.js), role middleware, [`routes/userRoutes.js`](../../routes/userRoutes.js)

**Rule:** Environment variable **names** only — no values.

---

## Authentication

### Token transport

| Mechanism | Source | Priority |
| --- | --- | --- |
| Bearer header | `Authorization: Bearer <token>` | Checked first |
| Cookie | httpOnly `token` cookie | Fallback |

Implementation: [`middlewares/authenticate.js`](../../middlewares/authenticate.js)

### JWT validation flow

1. Extract token from Bearer or cookie
2. `jwt.verify(token, JWT_SECRET)` — env var name: `JWT_SECRET`
3. Resolve `userId` from `decoded.userId` or `decoded.sub`
4. Load full `User` from MongoDB
5. Compare `decoded.sessionVersion` with `user.sessionVersion`
6. Set `req.user` (full Mongoose document) and call `next()`

### Session invalidation

- `User.sessionVersion` incremented on password reset
- Mismatch → 401 `{ success: false, message: "Session expired..." }` + cookies cleared if cookie token used

### Roles (checked on `req.user.role`, not JWT claims alone)

| Middleware | File | Allows |
| --- | --- | --- |
| `authenticate` | `authenticate.js` | Any valid user |
| `isAdmin` | `isAdmin.js` | `role === 'admin'` |
| `isCustomer` | `isCustomer.js` | `role === 'customer'` |
| `isBusinessOwner` | `isBusinessOwner.js` | `role === 'business_owner'` |
| `isBusinessOwnerOrAdmin` | `isBusinessOwnerOrAdmin.js` | owner or admin |
| `requireVerifiedVendor` | `requireVerifiedVendor.js` | OTP verified, not blocked/deleted |
| `requireStage1VerifiedVendor` | factory on same | + onboarding status `verified` |

### No global auth

Protection is **per-route** or `router.use(authenticate, isAdmin)` inside admin routers. Public routes have no middleware.

### Rate limiting (auth routes)

Applied in [`routes/userRoutes.js`](../../routes/userRoutes.js) via `express-rate-limit`:

| Route | Limiter | Max / 15 min |
| --- | --- | --- |
| `/register` | `registerLimiter` | 5 |
| `/login` | `loginLimiter` | 15 |
| `/verify-otp` | `otpVerifyLimiter` | 10 |
| `/resend-otp` | `otpResendLimiter` | 5 |
| `/forgot-password` | `forgotPasswordLimiter` | 5 |
| `/reset-password` | `resetPasswordLimiter` | 10 |

OAuth rate limits on `/api/auth/google*` in [`routes/authRoutes.js`](../../routes/authRoutes.js).

### Auth response DTO

[`utils/toPublicAuthUser.js`](../../utils/toPublicAuthUser.js) whitelists: `id`, `name`, `email`, `role`, `gender`, `mobile`, `isOtpVerified`.

`GET /api/users/auth/check` returns `{ loggedIn: true, user: toPublicAuthUser(...) }`.

---

## Cookies

Source: [`utils/cookieHelper.js`](../../utils/cookieHelper.js)

### Auth cookies set on login/verify

| Cookie | httpOnly | Purpose |
| --- | --- | --- |
| `token` | yes | JWT |
| `user_session` | no | Client flag `"true"` |
| `user_gender` | no | Display helper |

### Environment-driven cookie flags

| Env var name | Local default | Production behavior |
| --- | --- | --- |
| `COOKIE_DOMAIN` | undefined (no domain attr) | defaults to `.mosaicbizhub.com` when `NODE_ENV=production` and unset |
| `COOKIE_SECURE` | `false` in `.env.example` | defaults `true` in production |
| `COOKIE_SAMESITE` | `lax` in `.env.example` | defaults `none` when secure (cross-site) |

Empty `COOKIE_DOMAIN=""` explicitly omits domain attribute.

### Google OAuth temporary cookie

Optional env: `REQUIRE_PROFILE_COMPLETION`, `TEMP_COOKIE_NAME`, `TEMP_COOKIE_TTL_SEC` — see [`controllers/authController.js`](../../controllers/authController.js).

---

## CORS

Source: [`app.js`](../../app.js) + [`utils/corsOrigins.js`](../../utils/corsOrigins.js)

### Configuration

```javascript
cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);  // mobile/curl
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
})
```

### Allowlist construction (`getAllowedOrigins`)

1. If `CORS_ORIGINS` set → parse comma-separated list
2. Else → `[FRONTEND_URL, ...LEGACY_DEFAULT_ORIGINS]`
3. If `NODE_ENV !== 'production'` → append `DEV_ORIGINS` (localhost, Expo dev URLs)
4. Dedupe with `Set`

### Legacy default origins (hardcoded when `CORS_ORIGINS` unset)

- `https://app.mosaicbizhub.com`
- `https://www.mosaicbizhub.com`
- `https://mosaic-biz-frontend-launch.vercel.app`

### Dev-only origins (non-production)

- `http://localhost:3000`, `http://localhost:8081`, Expo URLs, etc.

### Required env var names for CORS

| Name | Role |
| --- | --- |
| `CORS_ORIGINS` | Explicit production allowlist (recommended) |
| `FRONTEND_URL` | Fallback origin + OAuth redirects |
| `NODE_ENV` | Controls dev origin append |

---

## Security notes (as-built)

| Finding | Status |
| --- | --- |
| Per-route auth (no global gate) | verified — some admin list routes may lack router-level guard (see API_SURFACE audit notes) |
| JWT in httpOnly cookie + Bearer | verified |
| `sessionVersion` invalidation | verified |
| CORS credentials enabled | verified |
| mongoSanitize + xss-clean on body/params | verified in `app.js` |
| Express 5 read-only `req.query` — query not sanitized | verified |

---

## Evidence needed

| Item | Owner |
| --- | --- |
| Production `CORS_ORIGINS` value confirmation (names only in docs; value in EB console) | AWS / release owner |
| Whether all Vercel preview URLs are in prod allowlist | Frontend / infra |
| Cookie behavior on cross-subdomain prod (`app.mosaicbizhub.com` → `api.mosaicbizhub.com`) | QA smoke P1 |

Deep dive: [`../AUTH_FLOW.md`](../AUTH_FLOW.md)
