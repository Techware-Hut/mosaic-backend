# CORS Production Smoke Proof (refreshed)

**Issues:** #80 (original), #84 (post-merge refresh)  
**Branch:** `release/backend-post-merge-production-stabilization`  
**Recorded:** 2026-06-22 UTC  
**Production API:** `https://api.mosaicbizhub.com`  
**Probe:** `OPTIONS /api/featured-products`

No secrets in this document.

---

## Allowlist behavior ([`utils/corsOrigins.js`](../utils/corsOrigins.js))

When `CORS_ORIGINS` **is set** in EB, it **replaces** the fallback list (`FRONTEND_URL` + legacy defaults). It is **not merged** with legacy origins.

When `CORS_ORIGINS` is **unset**, fallback includes:

- `FRONTEND_URL`
- `https://app.mosaicbizhub.com`
- `https://www.mosaicbizhub.com`
- `https://mosaic-biz-frontend-launch.vercel.app`

Dev origins are appended only when `NODE_ENV !== 'production'`.

---

## Production preflight results (2026-06-22)

| Origin | HTTP | Access-Control-Allow-Origin | Access-Control-Allow-Credentials | Result |
|--------|------|----------------------------|----------------------------------|--------|
| `https://app.mosaicbizhub.com` | 204 | exact match | `true` | **Passed** |
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | exact match | `true` | **Passed** |

No wildcard `*` origin observed. **Passed**

---

## Unauthenticated auth route (CORS must not 500)

| Route | HTTP | Result |
|-------|------|--------|
| `GET /api/users/auth/check` (no cookie/token) | 401 | **Passed** |

---

## Cookie/session (authenticated)

| Check | Result |
|-------|--------|
| Vendor cookie chain | **Blocked** — `SMOKE_TEST_VENDOR_TOKEN` not in session |
| Customer cookie chain | **Blocked** — `SMOKE_TEST_CUSTOMER_TOKEN` not in session |

See [SMOKE_TEST_TOKENS.md](SMOKE_TEST_TOKENS.md) for session-only setup.

---

## Staging / PR preview origins

Arbitrary Vercel preview URLs are **not** allowlisted unless explicitly added to `CORS_ORIGINS` by operator approval. **Not Tested** for batch #188 preview URLs.

---

## Required EB variables (names only)

| Variable | Recommended production value |
|----------|-------------------------------|
| `CORS_ORIGINS` | Comma-separated explicit browser origins |
| `FRONTEND_URL` | `https://app.mosaicbizhub.com` |

Full list: [production-env-checklist.md](production-env-checklist.md)

---

## Verdict

CORS for approved production + launch origins: **Passed** on current production runtime (`403d68e`). Post-merge redeploy must preserve `CORS_ORIGINS` configuration.
