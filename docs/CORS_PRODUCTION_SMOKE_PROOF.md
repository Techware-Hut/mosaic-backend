# CORS Production Smoke Proof — Issue #80

**Issue:** [#80 Backend CORS origin allowlist deployment and proof](https://github.com/Techware-Hut/mosaic-backend/issues/80)  
**PR:** [#85 Add CORS_ORIGINS env-driven allowlist](https://github.com/Techware-Hut/mosaic-backend/pull/85)  
**Recorded:** 2026-06-18 19:10:36 UTC (final verification — issue #80 closed)  
**Branch:** `audit/backend-final-cors-proof-80`  
**Commit:** `4c77bf6` (docs); EB runtime @ `afa56ca`  
**Deployed backend URL:** `https://api.mosaicbizhub.com`  
**Probe endpoint:** `OPTIONS /api/featured-products`

---

## Release gates

| Gate | Status | Notes |
|------|--------|-------|
| PR #85 merged to `main` | **YES** | Merged @ `5f98461` (2026-06-18) |
| `utils/corsOrigins.js` on `main` | **YES** | Present on `main` |
| EB production deploy of merge commit | **PASS** | GHA run 27781345087 @ `afa56ca` (2026-06-18) |
| `GET /api/health` on prod | **PASS** | 200 — deploy confirmed live |
| EB `CORS_ORIGINS` configured | **PASS** | Release owner applied env on `mosaic-backend-env`; apex CORS 204 confirmed |
| EB `FRONTEND_URL` configured | **PASS** | Applied with CORS env update (2026-06-18) |
| Post-deploy live smoke (all 4 origins) | **PASS** | 4/4 allowlisted origins return 204 (2026-06-18 19:10 UTC) |

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

## Post-deploy verification (2026-06-18 — full smoke re-run)

**Deployed commit:** `afa56ca` via GHA [27781345087](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27781345087)  
**Probe endpoint:** `OPTIONS /api/featured-products`

| Origin | HTTP | ACAO exact | Credentials `true` | Result |
|--------|------|------------|---------------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` | 500 | NO | NO | **FAIL** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO | N/A | **PASS** (rejected) |

**Summary:** 3/4 allowlisted origins pass. Apex fails because EB `CORS_ORIGINS` is unset — [`LEGACY_DEFAULT_ORIGINS`](../utils/corsOrigins.js) excludes apex. **Do not close #80** until apex returns 204.

---

## Post-env verification attempt (2026-06-18 18:53:34 UTC)

**Agent action:** Confirmed deployed SHA `afa56ca` contains CORS code; diff `afa56ca..4c77bf6` is docs-only (no redeploy required). AWS CLI unavailable — EB env update not applied by agent. Live re-probe before/after handoff:

| Origin | HTTP | ACAO exact | Credentials `true` | Result |
|--------|------|------------|---------------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` | 500 | NO | NO | **FAIL** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO | N/A | **PASS** (rejected) |

**Summary:** 3/4 — apex still **FAIL 500**. EB `CORS_ORIGINS` remains unset (inferred). **Do not close #80.**

### Actual response headers — apex (FAIL, 2026-06-18 18:53 UTC)

```
HTTP/1.1 500 Internal Server Error
Content-Type: text/html; charset=utf-8
Content-Length: 148
(no Access-Control-Allow-Origin header)
```

---

## Post-deploy verification (2026-06-18 18:22 UTC) — superseded

Historical pre-unblock audit (deploy lag, health 404). See full re-run section above.

---

## Final verification (2026-06-18 19:10:36 UTC) — issue #80 acceptance

**EB env update:** Release owner applied `CORS_ORIGINS` and `FRONTEND_URL` on `mosaic-backend-env`. No code redeploy required (EB runtime remains `afa56ca`).

| Origin | HTTP | ACAO exact | Credentials `true` | Result |
|--------|------|------------|---------------------|--------|
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | YES | YES | **PASS** |
| `https://app.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://www.mosaicbizhub.com` | 204 | YES | YES | **PASS** |
| `https://evil.example.com` (negative) | 500 | NO | N/A | **PASS** (rejected) |

**Summary:** **4/4 PASS** — all allowlisted origins return 204 with exact ACAO + credentials. Issue #80 acceptance criteria met.

### Actual response headers — apex (PASS)

```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://mosaicbizhub.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: Content-Type
```

---

## Blockers — resolved

1. ~~**EB env:** Set `CORS_ORIGINS` with all four launch origins~~ — **DONE** (release owner, 2026-06-18).
2. ~~**Issue closure:** Close #80 when 4/4 pass~~ — **DONE** (2026-06-18 19:10 UTC).

---

## References

- [`utils/corsOrigins.js`](../utils/corsOrigins.js) — env-driven allowlist on `main`
- [`docs/BACKEND_DEPLOYMENT_PROOF.md`](BACKEND_DEPLOYMENT_PROOF.md) — post-deploy rollup (2026-06-18)
- [`app.js`](../app.js) — `credentials: true` preserved
- [`tests/cors/cors-origins.test.js`](../tests/cors/cors-origins.test.js)
- [`docs/EB_DEPLOYMENT_READINESS_CHECKLIST.md`](EB_DEPLOYMENT_READINESS_CHECKLIST.md)
- [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) — GHA post-deploy CORS probe (launch + app only; manual proof must cover all four origins)
