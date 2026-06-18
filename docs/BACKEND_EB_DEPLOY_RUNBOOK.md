# Backend Elastic Beanstalk Deploy Runbook

**Batch:** C in [`BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md`](BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md)  
**Workflow:** [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml)  
**Production API:** `https://api.mosaicbizhub.com`  
**EB environment:** `mosaic-backend-env` (app: `mosaic-biz-hub-backend`, region: `us-east-1`)

No secrets in this document.

---

## Auto-deploy status

Push-to-`main` deploy is **disabled**. The workflow triggers **only** on `workflow_dispatch`:

```yaml
on:
  workflow_dispatch:
  # push:
  #   branches:
  #     - main
```

**Every merge to `main` requires a manual deploy** until push deploy is re-enabled.

---

## Manual deploy (release owner)

### 1. Pre-deploy checks

```powershell
git checkout main
git pull origin main
npm test
```

Confirm the commit SHA you intend to deploy.

### 2. Trigger GitHub Actions deploy

```powershell
gh workflow run deploy-eb-production.yml --repo Techware-Hut/mosaic-backend --ref main
gh run watch --repo Techware-Hut/mosaic-backend
```

Or: GitHub → Actions → **Deploy to Elastic Beanstalk** → Run workflow → Branch `main`.

### 3. Workflow steps (automated)

1. `npm ci` + `npm test` (196 tests)
2. Zip deploy bundle (excludes `tests/`, `docs/`, `.github/`)
3. Deploy to EB version label `mosaic-<sha>`
4. Post-deploy probes: `/`, `/api/users/auth/check` (401), `/api/health`, `/api/ready`, CORS (2 origins only)

### 4. Post-deploy manual verification

GHA CORS probe checks **two** origins only (launch Vercel + app). After deploy, verify **all four** launch origins:

```powershell
$origins = @(
  'https://mosaic-biz-frontend-launch.vercel.app',
  'https://app.mosaicbizhub.com',
  'https://mosaicbizhub.com',
  'https://www.mosaicbizhub.com'
)
foreach ($o in $origins) {
  curl.exe -s -D - -o NUL -X OPTIONS `
    -H "Origin: $o" `
    -H "Access-Control-Request-Method: GET" `
    "https://api.mosaicbizhub.com/api/featured-products"
}
```

Expected: **204** + exact `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`.

Full smoke:

```powershell
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

Expected: **PASS=11 FAIL=0** (BLOCKED=3 without auth tokens).

---

## EB environment configuration

### CORS (required for all four launch origins)

AWS Console → Elastic Beanstalk → `mosaic-backend-env` → Configuration → Software → Environment properties:

```
CORS_ORIGINS=https://mosaic-biz-frontend-launch.vercel.app,https://app.mosaicbizhub.com,https://mosaicbizhub.com,https://www.mosaicbizhub.com
FRONTEND_URL=https://app.mosaicbizhub.com
```

Apply configuration (EB restarts instances). No code redeploy required for env-only changes if CORS code is already deployed.

Proof: [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md) (issue #80 closed).

### Other env names (names only)

See [`docs/ENV_VAR_INVENTORY.md`](ENV_VAR_INVENTORY.md) for Stripe, Sentry, mail, and database variables.

---

## Rollback

If a deploy causes production issues:

1. AWS Console → Elastic Beanstalk → `mosaic-backend-env` → **Application versions**
2. Select the previous known-good version (e.g. `mosaic-afa56ca...`)
3. **Deploy** to `mosaic-backend-env`
4. Wait for environment health **Green**
5. Re-run health + smoke probes

Alternatively, re-run workflow against a known-good commit:

```powershell
gh workflow run deploy-eb-production.yml --repo Techware-Hut/mosaic-backend --ref <known-good-sha>
```

---

## Sentry production checks (Batch B)

| Check | Command / action | Expected | Owner |
|-------|------------------|----------|-------|
| Debug route disabled | `curl -s -o /dev/null -w "%{http_code}" https://api.mosaicbizhub.com/internal/sentry-debug` | **404** | Anyone |
| Unauth 401 bodies | Smoke script P2.1 | No stack trace | Anyone |
| EB `SENTRY_*` env set | AWS Console → env properties | Names present (values not logged) | Release owner |
| Dashboard event | Trigger safe error in staging OR one-time debug route with approval | Event in Sentry project | Release owner |

Do **not** set `ENABLE_SENTRY_DEBUG_ROUTE=true` in production unless explicitly approved for a short verification window. Disable immediately after.

Full Sentry doc: [`docs/SENTRY_EB_DEPLOY_VERIFICATION.md`](SENTRY_EB_DEPLOY_VERIFICATION.md)

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `/api/health` 404 after merge | Deploy not run (push disabled) | Manual `workflow_dispatch` |
| Apex CORS 500 | `CORS_ORIGINS` unset or missing apex | Set EB env; apply config |
| CORS 500 after env change | Instances not restarted | Apply config; wait for Green |
| Deploy workflow fails CORS | Wrong origin in probe | Check EB `CORS_ORIGINS`; manual 4-origin probe |
| Auth smoke BLOCKED | No test tokens | See [`docs/SMOKE_TEST_TOKENS.md`](SMOKE_TEST_TOKENS.md) |

---

## References

- [`docs/BACKEND_DEPLOYMENT_PROOF.md`](BACKEND_DEPLOYMENT_PROOF.md)
- [`docs/EB_DEPLOYMENT_READINESS_CHECKLIST.md`](EB_DEPLOYMENT_READINESS_CHECKLIST.md)
- [`docs/PRODUCTION_RUNBOOK.md`](PRODUCTION_RUNBOOK.md)
