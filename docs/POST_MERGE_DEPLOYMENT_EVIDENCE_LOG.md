# Post-Merge Deployment Evidence Log

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch:** `release/backend-post-merge-production-stabilization`  
**Frontend batch:** [mosaic-biz-frontend-launch#188](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/188)  
**Evidence date:** 2026-06-22 UTC  
**Issues:** #83 (EB drift), #84 (production smoke)

No secrets, tokens, credentials, or PII in this document.

---

## Git baseline

| Field | Value |
|-------|-------|
| Base branch | `main` |
| Starting SHA (branch base) | `0af88032daad8ee692fec3133453c330f3f19046` |
| Production runtime commit (short) | `403d68e` |
| Commits `main` ahead of production | **51** |
| Production deploy classification | **Stale deployment** |

---

## Phase 1 — Production release identity probes

Recorded: 2026-06-22T14:12:16Z (API timestamps from live responses)

| Endpoint | HTTP | service | release.commit | release.environment | release.deploymentVersion |
|----------|------|---------|------------------|---------------------|---------------------------|
| `GET /` | 200 | — | — | — | — |
| `GET /api/health` | 200 | mosaic-backend | `403d68e` | production | `mosaic-403d68e` |
| `GET /api/ready` | 200 | — | `403d68e` | production | `mosaic-403d68e` |
| `GET /api/build-info` | 200 | mosaic-backend | `403d68e` | production | `mosaic-403d68e` |

Ready probe: `database: connected` — **Passed**

### Comparison to `main`

| Check | Result |
|-------|--------|
| Production commit matches `main` HEAD | **Failed** — prod `403d68e` vs main `0af8803` |
| Release identity fields present | **Passed** — commit, environment, deploymentVersion populated |
| Release payload safe (no secrets) | **Passed** — smoke script forbidden-fragment scan |

Production commit `403d68e` = merge of PR #88 (`chore/backend-smoke-token-harness`). Does **not** include post-merge work: service publication (#108/#112), admin auth matrix (#111), DTO trim (#109), release identity hardening, CORS env-driven allowlist (#85), and 46+ intermediate commits.

### GHA deploy vs runtime mismatch

| Field | Value |
|-------|-------|
| Latest successful GHA deploy | Run [27927401768](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27927401768) @ `6d20585` (2026-06-22) |
| Live `/api/health` commit | `403d68e` |
| Classification | **Unexpected deployment** — workflow reported success but runtime identity did not advance to dispatched SHA |

**Client/Operator Action Required:** Confirm EB environment `mosaic-backend-env` active version label in AWS console; redeploy `main` @ `0af8803` (or later) and realign `RELEASE_COMMIT_SHA`, `DEPLOYMENT_VERSION_LABEL`, `SENTRY_RELEASE`.

---

## Recent merged launch PRs (on `main`, not on production)

| PR | Topic | On prod? |
|----|-------|----------|
| #112 | Service publication verification | No |
| #108 | Service publication Model A contract | No |
| #111 | Admin auth matrix | No |
| #109 | Marketplace DTO media trim | No |
| #85 | CORS_ORIGINS env allowlist | Unknown (CORS probes pass on prod) |
| #88 | Smoke token harness | **Yes** (prod @ 403d68e) |

---

## Required release identity env var names (values in EB only)

`RELEASE_COMMIT_SHA`, `DEPLOYMENT_VERSION_LABEL`, `RELEASE_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`

See [backend/BACKEND_RELEASE_IDENTITY.md](backend/BACKEND_RELEASE_IDENTITY.md).

---

## Launch-readiness (pre-redeploy)

**Not launch-ready** for post-merge frontend #188 validation until production deploy matches `main` and post-deploy smoke confirms release SHA alignment.
