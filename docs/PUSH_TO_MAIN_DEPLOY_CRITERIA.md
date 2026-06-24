# Push-to-Main Deploy Re-Enable Criteria

**Issue:** [#23 Define criteria for re-enabling push-to-main deployment](https://github.com/Techware-Hut/mosaic-backend/issues/23)  
**Workflow:** [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml)  
**Current state:** `push:` to `main` is **enabled** — deploy runs automatically on push/merge to `main`. Manual `workflow_dispatch` also available.

---

## Prerequisites checklist

All must be true before uncommenting `push: branches: [main]` in the deploy workflow.

| # | Criterion | Owner | Evidence |
| --- | --- | --- | --- |
| 1 | **3 consecutive successful manual EB deploys** from `main` with no rollback | Deployment owner | GHA run URLs + EB version labels |
| 2 | **Post-deploy probes pass** — `/`, `/api/health`, `/api/ready`, auth 401, CORS | GHA deploy workflow | Workflow logs |
| 3 | **`npm test` green** on `main` before each deploy | CI | GHA test job |
| 4 | **IAM OIDC policy tightened** (#19) — least privilege for EB deploy role | DevOps | AWS IAM policy review |
| 5 | **Rollback documented** | Release owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [BACKUP_ROLLBACK_RUNBOOK.md](BACKUP_ROLLBACK_RUNBOOK.md) |
| 6 | **Smoke harness in use** (#63) | QA | `./scripts/smoke-backend.ps1` post-deploy |
| 7 | **Sentry verified on EB** (#18) | DevOps | [SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md) |
| 8 | **Full smoke proof started** (#27) | QA | [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) P0–P1 minimum |

---

## Sign-off owners

| Role | Responsibility |
| --- | --- |
| **Deployment owner** | EB deploy, version labels, env vars |
| **Backend lead** | Code readiness, test count, merge approval |
| **Release owner** | Smoke sign-off, Go/No-Go |

Both deployment owner and backend lead must approve re-enabling push-to-main in writing (ticket comment or release record).

---

## How to re-enable

1. Complete prerequisites table above.
2. Open PR that uncomments in `.github/workflows/deploy-eb-production.yml`:

```yaml
on:
  workflow_dispatch:
  push:
    branches:
      - main
```

3. PR description must link:
   - Last 3 successful manual deploy SHAs
   - Rollback procedure
   - Smoke evidence for most recent deploy
4. Merge only after backend lead + deployment owner approval.

---

## Rollback before disable

If push-to-main causes a bad deploy:

1. Re-comment `push:` or revert the enablement PR immediately.
2. Follow [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) § Rollback.
3. Document incident in [deploy-verification.md](deploy-verification.md).

---

## Related issues

- #19 — IAM tighten (prerequisite)
- #21 — CORS GHA smoke (addressed in deploy workflow)
- #20 — EB rollback doc (closed; superseded in part by [BACKUP_ROLLBACK_RUNBOOK.md](BACKUP_ROLLBACK_RUNBOOK.md))
