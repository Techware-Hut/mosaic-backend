# Backup, Rollback, and Database Restore Runbook

**Issue:** [#75 Backup, rollback, and database restore runbook](https://github.com/Techware-Hut/mosaic-backend/issues/75)  
**Related:** [#20](https://github.com/Techware-Hut/mosaic-backend/issues/20) (EB code rollback — closed)

Documentation only — no restore performed during authoring.

---

## 1. Code deploy rollback (Elastic Beanstalk)

### When to rollback

- Bad commit deployed to production
- Post-deploy smoke fails (`scripts/smoke-backend.ps1`)
- Startup crash or Mongo connection failure in EB logs

### Steps

1. Stop further merges to `main` until root cause identified.
2. AWS Console → Elastic Beanstalk → `mosaic-backend-env` (confirm name in console).
3. Application versions → select **last known-good** version label (e.g. `mosaic-<previous-sha>`).
4. Deploy that version to the environment.
5. Verify:
   - `GET https://api.mosaicbizhub.com/` → 200
   - `GET https://api.mosaicbizhub.com/api/health` → 200
   - `GET https://api.mosaicbizhub.com/api/ready` → 200, database connected
   - Run `./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com`
6. If failure was env-related, restore previous EB environment configuration snapshot.
7. Log rollback in [deploy-verification.md](deploy-verification.md).

See also [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) § Rollback.

---

## 2. EB runtime concerns

| Concern | Action |
| --- | --- |
| App won't boot | Check EB logs for missing env vars — [production-env-checklist.md](production-env-checklist.md) |
| Wrong commit live | Compare EB version label `mosaic-<sha>` to expected `main` HEAD |
| Sentry boot issue | Set `SENTRY_ENABLED=false` or remove `SENTRY_DSN`; restart env |
| Stripe webhook failures | Verify webhook secrets match Stripe Dashboard — [stripe-webhook-registration.md](stripe-webhook-registration.md) |
| CORS regression | Check `FRONTEND_URL` and allowlist in [app.js](../app.js) |

---

## 3. Database backup and restore assumptions

| Item | Assumption | Owner |
| --- | --- | --- |
| **Provider** | MongoDB Atlas (production cluster in `MONGODB_URI`) | DBA / DevOps |
| **Backups** | Atlas continuous backup / snapshots per Atlas project policy | Atlas admin |
| **Restore scope** | Full cluster or collection restore via Atlas UI/CLI — **not automated in app repo** | DBA |
| **App role** | Backend reads `MONGODB_URI` only; no in-app backup jobs | Backend team |
| **RPO/RTO** | Defined by Atlas tier — document in Atlas console, not in git | Infra owner |

### Restore procedure (high level — Atlas owner executes)

1. Identify incident time and target recovery point.
2. Atlas → Backup → restore to new cluster or point-in-time.
3. Update `MONGODB_URI` on EB **only** after restore cluster is validated (separate change window).
4. Run smoke P0–P1 against restored data environment before cutover.
5. Record restore event with approvers — never commit connection strings.

---

## 4. What this runbook does not cover

- Frontend Vercel rollback (separate repo/process)
- Stripe dispute/charge reversal
- Manual data fixes in MongoDB without backup

---

## 5. Evidence for launch sign-off

- [ ] Deployment owner confirms EB version label process
- [ ] Atlas backup policy enabled (screenshot redacted — Atlas console)
- [ ] Rollback drill or documented last successful rollback path

No secrets in evidence attachments.
