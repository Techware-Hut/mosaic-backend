# Deploy Verification Log

Records post-deploy verification for Mosaic Biz Hub backend. For the full release workflow see [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md). For smoke tiers see [production-smoke-checklist.md](production-smoke-checklist.md).

---

## MVP deploy target

- **Branch deployed to EB:** `main` (not `staging` — staging is integration-only)
- **Canonical URL:** `https://api.mosaicbizhub.com`
- **Process:** [DEPLOYMENT.md](../DEPLOYMENT.md)

---

## Verification — 2026-06-07 (launch-readiness doc pass)

| Check | Result | Notes |
|-------|--------|-------|
| `GET https://api.mosaicbizhub.com/` | **PASS** | HTTP 200 — `{"message":"Mosaic Biz Hub API is working 9 feb "}` |
| EB boot logs | Not captured | Requires AWS console / infra owner |
| Mongo connected in logs | Not captured | Requires AWS console |
| Stripe webhook deliveries | Not captured | Requires Stripe Dashboard review |

**Conclusion:** Production API is reachable and returns health JSON. Full S1–S6 smoke and EB log review remain pending for release sign-off.

---

## After each future deploy

1. Record deployed `main` commit SHA.
2. Run Tier 0–S2 minimum from [production-smoke-checklist.md](production-smoke-checklist.md).
3. Update [production-proof-pack-template.md](production-proof-pack-template.md).
4. Confirm no OTP values in EB logs after auth smoke (P0.3).

---

## Staging branch note

The `staging` branch is **not deployed** to a host in MVP workflow. Verification on `staging` is limited to:

- PR review complete
- Local `npm run dev` boot with `.env`
- Integration checklist in [STAGING.md](../STAGING.md)

Runtime webhook and payment proof happens only after `main` → EB deploy.

---

## Integration gate — 2026-06-14 (`staging` @ `28510cf`)

Pre-PR verification before `staging` → `main`. Staging is **8 commits ahead** of `origin/main` (`2dd52c4`).

### Rollback readiness (pre-merge)

| Item | Value |
|------|-------|
| Last known good `main` SHA (current EB baseline) | `2dd52c4` — Merge pull request #8 from DeveloperTWH/staging |
| Staging HEAD (candidate release) | `28510cf` — Add launch readiness and production verification docs |
| EB rollback path | Manual — infra owner per [DEPLOYMENT.md](../DEPLOYMENT.md) |

### STAGING.md integration checklist

| Item | Status |
|------|--------|
| PR reviewed; security-sensitive diffs called out | Pending reviewer (Wave 2 hardening in 8 commits) |
| App boots locally with `.env` | **PASS** — `npm start`, Mongo connected, port 3001 |
| No secrets committed; `.env.example` updated | **PASS** — working tree clean at audit time |
| Docs updated (README, SETUP, DEPLOYMENT, security) | **PASS** — launch docs commit `28510cf` |
| P0 blockers tracked in launch-readiness-report | **PASS** — reviewed; deploy does not close them |

### Automated / local commands executed

| Command | Result |
|---------|--------|
| `npm test` | **57/57 pass** |
| `GET http://localhost:3001/` | **200** — `{"message":"Mosaic Biz Hub API is working 9 feb "}` |
| `node scripts/verify-auth-check-smoke.js` | **PASS** — unauth 401; customer/vendor/admin auth/check 200 with safe keys; frontend pages 200 |
| `.env` boot-critical vars | **PASS** — `PORT=3001`, `API_BASE_URL` port 3001 aligned; all 5 `STRIPE_*_WEBHOOK_SECRET` set |
| `.env.local` | Exists but **not loaded** by app (`dotenv.config()` in `index.js`) |

### Local boot probe evidence

Local boot probe passed:

- `GET http://localhost:3001/` returned **200** with expected health JSON.
- Server process was intentionally stopped after the probe.
- Windows process termination exit code observed: **4294967295** (normal for intentional stop on Windows).

### Release path note

Hosted staging smoke test is **not applicable** for this release — hosted staging is deferred and no staging deploy target exists ([hosted-staging-decision.md](hosted-staging-decision.md)).

Current release path: validate on `staging` branch → merge to `main` → deploy `main` to AWS Elastic Beanstalk → controlled production smoke.

### Production probes (current `main` on EB — not staging candidate yet)

| Check | Result |
|-------|--------|
| `GET https://api.mosaicbizhub.com/` (P0.1) | **PASS** — HTTP 200 |
| `GET https://api.mosaicbizhub.com/api/users/auth/check` (unauth) | **PASS** — HTTP 401 |
| P0.2 EB boot logs | Not captured — infra owner |
| P1–P6 full manual smoke | **PENDING** — run after `staging` → `main` merge + EB deploy of `28510cf` |
| P4 Stripe webhook deliveries | Not captured — Stripe Dashboard |

**Integration verdict:** **GO** for opening PR `staging` → `main` (automated tests + local boot + auth smoke pass).

**Production deploy verdict:** **NO-GO** for unrestricted launch until post-merge EB deploy smoke (P1–P6) and P0 blocker sign-off.

---

## Post-merge gate — 2026-06-16 (GitHub Actions EB deploy)

GitHub Actions CI/CD added on branch `chore/github-actions-eb-deploy`:

| Item | Value |
|------|-------|
| CI workflow | `.github/workflows/ci.yml` — `npm ci` + `npm test` on PR/push to `staging`/`main` |
| Deploy workflow | `.github/workflows/deploy-eb-production.yml` — test gate + source ZIP + EB deploy + health probes |
| GitHub variables | `AWS_REGION=us-east-1`, `EB_APPLICATION_NAME=mosaic-backend`, `EB_ENVIRONMENT_NAME=Mosaic-backend` |
| Setup doc | [github-actions-eb-setup.md](github-actions-eb-setup.md) |
| Local `npm test` | **57/57 pass** (2026-06-16) |

### Production baseline probes (pre-automated-deploy)

Probed before first GitHub Actions deploy:

| Check | Result |
|-------|--------|
| `GET https://api.mosaicbizhub.com/` | **200** — `{"message":"Mosaic Biz Hub API is working 9 feb "}` |
| `GET https://api.mosaicbizhub.com/api/users/auth/check` (unauth) | **401** |

**Pending (infra owner):** Add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets; create `production` GitHub environment with reviewers; run **Deploy to Elastic Beanstalk** via `workflow_dispatch` on `main`. CORS fix (`mosaic-biz-frontend-launch.vercel.app`) is in git @ `5db1a78` but not confirmed live until EB deploy completes.

---

## Post-merge gate — 2026-06-14 (PR #9 merged)

PR [#9](https://github.com/DeveloperTWH/backend/pull/9) merged to `main` at `2026-06-14T21:38:12Z`.

| Item | Value |
|------|-------|
| Merge commit | `efbf0fb` — Merge pull request #9 from DeveloperTWH/staging |
| `origin/main` HEAD | `2e41cd6` — post-merge evidence docs (docs-only vs `efbf0fb`) |
| Local `main` synced | **PASS** @ `2e41cd6`; `645a282` contained |
| `npm test` on `main` | **57/57 pass** |
| Auto-deploy on merge | **No** — manual EB deploy per [DEPLOYMENT.md](../DEPLOYMENT.md); no CI workflows |
| EB deployed commit | **UNKNOWN** — pending infra owner confirmation |
| Rollback target (documented) | `2dd52c4` |

### Production baseline probes (baseline only — does not prove PR #9 live)

Probed `2026-06-14T21:42:14Z`:

| Check | Result |
|-------|--------|
| `GET https://api.mosaicbizhub.com/` | **200** — `{"message":"Mosaic Biz Hub API is working 9 feb "}` |
| `GET https://api.mosaicbizhub.com/api/users/auth/check` (unauth) | **401** |

**Note:** Health probes confirm production is responding. They do **not** confirm Wave 2 / PR #9 is deployed until infra confirms EB version/commit.

### Controlled production smoke

**BLOCKED** until infra confirms Wave 2 (`efbf0fb` or newer) is live on EB and approves smoke (Q9).

**Provisional safe probes recorded** — see [production-proof-pack-template.md](production-proof-pack-template.md) § Provisional Production Smoke — Commit Unconfirmed (`2026-06-14T21:56:27Z`). Does not prove deployed commit.

Infra confirmation request: see [integration-gate-asana-evidence.md](integration-gate-asana-evidence.md) § Infra owner request (post-merge).
