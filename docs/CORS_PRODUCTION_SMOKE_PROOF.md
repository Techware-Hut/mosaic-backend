# CORS Production Smoke Proof — Issue #80

**Issue:** [#80 Backend CORS origin allowlist deployment and proof](https://github.com/Techware-Hut/mosaic-backend/issues/80)  
**PR:** [#85 Add CORS_ORIGINS env-driven allowlist](https://github.com/Techware-Hut/mosaic-backend/pull/85)  
**Recorded:** 2026-06-18 16:45:02 UTC  
**Branch:** `fix/backend-cors-origin-allowlist-80`  
**Commit:** `eb35d8c` (`eb35d8c8cf94006ffa60cf3f51e2a8fdfd25f3da`)  
**Deployed backend URL:** `https://api.mosaicbizhub.com`  
**Probe endpoint:** `OPTIONS /api/featured-products`

---

## Release gates

| Gate | Status | Notes |
|------|--------|-------|
| PR #85 merged to `main` | **YES** | Merged @ `5f98461` (2026-06-18) |
| `utils/corsOrigins.js` on `main` | **YES** | Present on `main` |
| EB production deploy of merge commit | **FAIL / UNVERIFIED** | Last GHA deploy `7d01011`; live probes show pre-merge behavior |
| EB `CORS_ORIGINS` configured | **BLOCKED** | AWS CLI unavailable; apex CORS still fails on prod |
| EB `FRONTEND_URL` configured | **BLOCKED** | AWS CLI unavailable |
| Post-deploy live smoke (all 4 origins) | **FAIL** | 3/4 pass; apex still 500 (2026-06-18 18:22 UTC) |

---

## Required EB environment variables

Set on Elastic Beanstalk production **before or with** deploy of PR #85 merge commit:

| Variable | Required value |
|----------|----------------|
| `CORS_ORIGINS` | `https://mosaic-biz-frontend-launch.vercel.app,https://app.mosaicbizhub.com,https://mosaicbizhub.com,https://www.mosaicbizhub.com` |
| `FRONTEND_URL` | `https://app.mosaicbizhub.com` |

**Important:** Legacy fallback (when `CORS_ORIGINS` is unset) does **not** include apex `https://mosaicbizhub.com`. Setting only `FRONTEND_URL` will not fix the apex domain.

No secrets in this document.

---

## Local validation (branch `eb35d8c`)

| Check | Command | Result |
|-------|---------|--------|
| Unit / integration tests | `npm test` | **PASS** — 196/196 (2026-06-18) |
| Syntax check | `node -c app.js` | **PASS** — exit 0 |
| CI (GitHub Actions) | PR #85 Test workflow | **PASS** — SUCCESS |

CORS unit tests: `tests/cors/cors-origins.test.js` (6 tests) — all pass.

---

## Curl commands (copy-paste)

Replace `<ORIGIN>` with each test origin. Run from PowerShell or bash.

### PowerShell

```powershell
curl.exe -s -D - -o NUL -X OPTIONS `
  -H "Origin: <ORIGIN>" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: Content-Type" `
  "https://api.mosaicbizhub.com/api/featured-products"
```

### Bash

```bash
curl -s -D - -o /dev/null -X OPTIONS \
  -H "Origin: <ORIGIN>" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Content-Type" \
  "https://api.mosaicbizhub.com/api/featured-products"
```

### Test origins

1. `https://mosaic-biz-frontend-launch.vercel.app`
2. `https://app.mosaicbizhub.com`
3. `https://mosaicbizhub.com`
4. `https://www.mosaicbizhub.com`
5. `https://evil.example.com` (negative control — must not receive allowlisted ACAO)

### Expected (allowlisted origins)

- HTTP **204**
- `Access-Control-Allow-Origin: <exact Origin header>`
- `Access-Control-Allow-Credentials: true`

### Expected (negative control)

- Must **not** echo an allowlisted `Access-Control-Allow-Origin`
- Current pre-merge behavior: HTTP **500** (CORS rejection via Express error handler)

---

## Pre-merge production baseline (2026-06-18 16:44:55 UTC)

Live API still on pre-PR hardcoded allowlist (`main` `app.js`). Results below are **baseline only** — not full issue #80 acceptance.

| Origin | HTTP | ACAO exact match | ACAO-Credentials `true` | Result |
|--------|------|------------------|-------------------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` | 500 | NO (absent) | NO (absent) | **FAIL** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO (absent) | N/A | **PASS** (rejected) |

**Summary:** 3/4 allowlisted origins pass pre-merge. Apex domain fails because it is not in the current hardcoded production allowlist.

### Actual response headers — launch Vercel (PASS)

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://mosaic-biz-frontend-launch.vercel.app
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: Content-Type
```

### Actual response headers — app (PASS)

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.mosaicbizhub.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: Content-Type
```

### Actual response headers — apex (FAIL)

```
HTTP/1.1 500 Internal Server Error
Content-Type: text/html; charset=utf-8
(no Access-Control-Allow-Origin header)
```

### Actual response headers — www (PASS)

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://www.mosaicbizhub.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: Content-Type
```

### Actual response headers — evil.example.com (negative, PASS)

```
HTTP/1.1 500 Internal Server Error
Content-Type: text/html; charset=utf-8
(no Access-Control-Allow-Origin header)
```

---

## Post-deploy verification (2026-06-18 18:22:36 UTC)

**Recorded by:** post-deploy release verification (`audit/backend-post-deploy-release-verification`)

**Deploy evidence:**

| Signal | Value |
|--------|-------|
| `main` HEAD | `5f98461` |
| Last GHA EB deploy SHA | `7d01011` (2026-06-18T01:13:55Z) — **older than merge commit** |
| `GET /api/health` on prod | **404** — merge commit not confirmed live |
| Apex CORS on prod | **500** — `CORS_ORIGINS` env-driven allowlist not confirmed live |

| Origin | HTTP | ACAO exact | Credentials `true` | Result |
|--------|------|------------|---------------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` | 500 | NO | NO | **FAIL** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO | N/A | **PASS** (rejected) |

**Summary:** 3/4 allowlisted origins pass. Apex failure indicates production is still running pre-`CORS_ORIGINS` behavior despite merge to `main`.

---

## Blockers

1. **Deploy lag:** GHA last deploy `7d01011`; `main` is `5f98461`. Redeploy required.
2. **EB env:** `CORS_ORIGINS` / `FRONTEND_URL` not verified (AWS CLI unavailable); apex failure suggests env not applied or deploy not live.
3. **Issue closure:** Do **not** close #80 until all four allowlisted origins pass and deploy SHA is confirmed.

---

## Next required action (release owner)

1. Set EB env (if not already):
   - `CORS_ORIGINS=https://mosaic-biz-frontend-launch.vercel.app,https://app.mosaicbizhub.com,https://mosaicbizhub.com,https://www.mosaicbizhub.com`
   - `FRONTEND_URL=https://app.mosaicbizhub.com`
2. Deploy `main` @ `5f98461`+ to EB via `workflow_dispatch`
3. Confirm `GET /api/health` → 200 and apex OPTIONS → 204
4. Re-run OPTIONS curls; update this document; close #80 only if 4/4 pass

---

## References

- [`utils/corsOrigins.js`](../utils/corsOrigins.js) — env-driven allowlist on `main`
- [`docs/BACKEND_DEPLOYMENT_PROOF.md`](BACKEND_DEPLOYMENT_PROOF.md) — post-deploy rollup (2026-06-18)
- [`app.js`](../app.js) — `credentials: true` preserved
- [`tests/cors/cors-origins.test.js`](../tests/cors/cors-origins.test.js)
- [`docs/EB_DEPLOYMENT_READINESS_CHECKLIST.md`](EB_DEPLOYMENT_READINESS_CHECKLIST.md)
- [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) — GHA post-deploy CORS probe (launch + app only; manual proof must cover all four origins)
