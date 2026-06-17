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
| GitHub variables | `AWS_REGION=us-east-1`, `EB_APPLICATION_NAME=mosaic-biz-hub-backend`, `EB_ENVIRONMENT_NAME=mosaic-backend-env`, `AWS_ROLE_TO_ASSUME=<IAM role ARN>` |
| Deploy auth | GitHub OIDC → IAM role (see [github-actions-eb-setup.md](github-actions-eb-setup.md)) |
| Setup doc | [github-actions-eb-setup.md](github-actions-eb-setup.md) |
| Local `npm test` | **57/57 pass** (2026-06-16) |

### Production baseline probes (pre-automated-deploy)

Probed before first GitHub Actions deploy:

| Check | Result |
|-------|--------|
| `GET https://api.mosaicbizhub.com/` | **200** — `{"message":"Mosaic Biz Hub API is working 9 feb "}` |
| `GET https://api.mosaicbizhub.com/api/users/auth/check` (unauth) | **401** |

**Pending (infra owner):** Create GitHub OIDC IAM role with environment-scoped trust (`repo:DeveloperTWH/backend:environment:production`); set GitHub variables including `AWS_ROLE_TO_ASSUME`; create `production` GitHub environment with reviewers; run **Deploy to Elastic Beanstalk** via `workflow_dispatch` on `main`. CORS fix (`mosaic-biz-frontend-launch.vercel.app`) is in git @ `5db1a78` but not confirmed live until EB deploy completes.

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

---

## Verification — 2026-06-17 (PR #37 / issue #27 smoke proof)

Post-merge controlled deploy and MVP smoke proof pack after [PR #37](https://github.com/Techware-Hut/mosaic-backend/pull/37) (marketplace DTO, closes #28).

### Deploy record

| Field | Value |
|-------|-------|
| Merge commit | `7201f97dd59db953f7d469f2de4f686fb7f39217` |
| GHA deploy run | [27717414160](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27717414160) — **success** |
| EB version label | `mosaic-7201f97dd59db953f7d469f2de4f686fb7f39217` |
| EB application / environment | `mosaic-biz-hub-backend` / `mosaic-backend-env` |
| API base | `https://api.mosaicbizhub.com` |

Workflow post-deploy probes in GHA: health **200**, unauth auth/check **401**.

### Smoke summary

Full matrix: [MVP_BACKEND_SMOKE_PROOF_PACK.md](MVP_BACKEND_SMOKE_PROOF_PACK.md) § Production smoke results — 2026-06-17.

| Area | Result |
|------|--------|
| Health + auth probe | **PASS** |
| Marketplace list + detail routes (12 endpoints) | **PASS** |
| CORS (launch Vercel origin) | **PASS** |
| Marketplace DTO fields (`displayPrice`, etc.) | **PASS** on products/services/food/detail |
| Featured card fields | **SKIP** — empty featured feed in prod DB |

### Conclusion

**Deploy Go** for MVP public browse/auth/CORS on `7201f97`. Safe for frontend production integration testing. Issue #27 evidence complete. Next: issue #29 (search/filter) per sprint plan.

---

## Verification — 2026-06-17 (PR #38 / issue #29 search/filter)

Post-merge controlled deploy and production smoke after [PR #38](https://github.com/Techware-Hut/mosaic-backend/pull/38) (search/filter readiness, issue #29).

### Deploy record

| Field | Value |
|-------|-------|
| Merge commit | `9f66c079a80ec204e5c041cad3cc8799a266a1c8` |
| GHA deploy run | [27720127626](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27720127626) — **success** |
| EB version label | `mosaic-9f66c079a80ec204e5c041cad3cc8799a266a1c8` |
| EB application / environment | `mosaic-biz-hub-backend` / `mosaic-backend-env` |
| API base | `https://api.mosaicbizhub.com` |

Workflow post-deploy probes in GHA: health **200**, unauth auth/check **401**.

### Smoke summary

Full matrix: [MVP_BACKEND_SEARCH_FILTER_READINESS.md](MVP_BACKEND_SEARCH_FILTER_READINESS.md) § Production deployment.

| Area | Result |
|------|--------|
| Keyword search | **PASS** — `GET /api/public/search?keyword=test&limit=5` → 200 |
| ZIP exact + listingType | **PASS** — empty result safe, no crash |
| Tag + verified filter | **PASS** — empty result safe |
| Geo unsupported (lat/lng/radius) | **PASS** — `filters.unsupported` populated; no `distanceMiles` |
| Products list tag + zip | **PASS** — 200; DTO backward compat on non-empty list |
| CORS (launch Vercel origin) | **PASS** — OPTIONS 204; GET 200; ACAO exact match |

### Conclusion

**Deploy Go** for issue #29 search/filter on `9f66c07`. Supported filters return 200 with safe empty sets. Geo/radius honestly reported as unsupported. CORS unchanged. Backend **safe to proceed to issue #30** (vendor onboarding email — do not start until scheduled).

---

## Verification — 2026-06-17 (PR #39 / issue #30 vendor onboarding email)

Post-merge controlled deploy and production smoke after [PR #39](https://github.com/Techware-Hut/mosaic-backend/pull/39) (vendor onboarding validation + email flow, issue #30).

### Deploy record

| Field | Value |
|-------|-------|
| Merge commit | `6cdf587f0f3178a13634686bbfc12db8daee4ae4` |
| GHA deploy run | [27722069277](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27722069277) — **success** |
| EB version label | `mosaic-6cdf587f0f3178a13634686bbfc12db8daee4ae4` |
| EB application / environment | `mosaic-biz-hub-backend` / `mosaic-backend-env` |
| API base | `https://api.mosaicbizhub.com` |

Workflow post-deploy probes in GHA: health **200**, unauth auth/check **401**.

### Smoke summary

Full matrix: [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) § Production deployment.

| Area | Result |
|------|--------|
| Unauth onboarding routes (draft/submit/pending/finalize) | **PASS** — 401 |
| Vendor → admin route guards | **PASS** — 403 |
| Admin pending queue | **PASS** — 200 |
| Finalize non-submitted guard | **PASS** — 400 + `currentStatus` |
| Submit validation / submit email flags | **PENDING** — no disposable smoke vendor |
| Finalize approve/reject + email flags | **SKIP** — real pending application only |
| CORS (launch Vercel origin) | **PASS** — OPTIONS 204; ACAO exact match |
| Search/filter regression canary | **PASS** — geo `filters.unsupported` |

### Conclusion

**Deploy Go** for issue #30 validation guards and auth boundaries on `6cdf587`. Authenticated submit/finalize email proof **PENDING** until dedicated `SMOKE_TEST_*` accounts exist. Issue #31 merged and deployed — see section below.

---

## Verification — 2026-06-17 (PR #40 / issue #31 vendor self-service)

Post-merge controlled deploy and production smoke after [PR #40](https://github.com/Techware-Hut/mosaic-backend/pull/40) (vendor self-service APIs, issue #31).

### Deploy record

| Field | Value |
|-------|-------|
| Merge commit | `213423163964db9f32505ecb500d034b40fc583e` |
| GHA deploy run | [27723981617](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27723981617) — **success** |
| EB version label | `mosaic-213423163964db9f32505ecb500d034b40fc583e` |
| EB application / environment | `mosaic-biz-hub-backend` / `mosaic-backend-env` |
| API base | `https://api.mosaicbizhub.com` |

Workflow post-deploy probes in GHA: health **200**, unauth auth/check **401**.

Pre-merge tests: **123/123** (`npm test`).

### Smoke summary

Full matrix: [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md) § Manual smoke after merge/deploy.

| Area | Result |
|------|--------|
| Health + auth probe (GHA) | **PASS** — 200 / 401 |
| Onboarding unauth submit | **PASS** — 401 (#30 regression) |
| Search/filter geo canary | **PASS** — `filters.unsupported` populated |
| Product create tier limit | **PENDING** — no disposable smoke vendor |
| Variant add tier limit | **PENDING** — no disposable smoke vendor |
| Stock PATCH validation (negative/unknown op) | **PENDING** — requires vendor token + variant ID |
| Vendor order list (vendorId from token) | **PENDING** — requires vendor token |

### Conclusion

**Deploy Go** for issue #31 vendor self-service APIs on `2134231`. Auth boundaries and search canary **PASS**. Tier-limit, stock, and vendor-order flows **PENDING** until dedicated `SMOKE_TEST_*` accounts exist. **Next scheduled issue:** #32 Stripe Connect runtime — do not start until scheduled. Program snapshot: [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md).
