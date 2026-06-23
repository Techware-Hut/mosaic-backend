# Backend Release Identity and Sentry Tagging

**Issue:** [#171 — Backend release identity](https://github.com/Techware-Hut/mosaic-backend/issues/171)  
**Related:** Frontend #171, epic #162, backend Sentry review #18

---

## Purpose

Tie the running API, Git commit, Elastic Beanstalk version label, smoke proof, rollback target, and Sentry events to one **safe, non-secret release identity**.

---

## Environment variable names (values set in EB / CI only)

| Variable | Role |
| --- | --- |
| `RELEASE_COMMIT_SHA` | Canonical deployed Git commit (7–40 hex chars) |
| `RELEASE_ENVIRONMENT` | Runtime environment label (`production`, `staging`, `development`, …) |
| `DEPLOYMENT_VERSION_LABEL` | Elastic Beanstalk version label (e.g. `mosaic-<sha>`) |
| `SENTRY_RELEASE` | Sentry release string; defaults to deployment label when unset |
| `SENTRY_ENVIRONMENT` | Legacy Sentry env fallback when `RELEASE_ENVIRONMENT` unset |
| `SENTRY_DSN` | Sentry project DSN (never exposed in API responses) |
| `SENTRY_ENABLED` | Optional disable switch |

**Recommended EB production set (names only):**

- `RELEASE_COMMIT_SHA=<deployed-git-sha>`
- `RELEASE_ENVIRONMENT=production`
- `DEPLOYMENT_VERSION_LABEL=mosaic-<deployed-git-sha>`
- `SENTRY_RELEASE=mosaic-<deployed-git-sha>`
- `SENTRY_ENVIRONMENT=production`

Deploy workflow already publishes EB version label `mosaic-${{ github.sha }}`. Align the four release variables to that label after each deploy.

---

## Public API surfaces

Existing consumers remain compatible. New metadata is additive.

### `GET /api/health`

```json
{
  "status": "ok",
  "service": "mosaic-backend",
  "timestamp": "2026-06-21T12:00:00.000Z",
  "uptime": 123.45,
  "release": {
    "commit": "80df570",
    "environment": "production",
    "deploymentVersion": "mosaic-80df57008f33c03df8c0a590efa8d573813ff070"
  }
}
```

### `GET /api/ready`

Same `release` object added alongside existing `status` / `database` fields.

### `GET /api/build-info`

Dedicated QA/ops endpoint:

```json
{
  "service": "mosaic-backend",
  "timestamp": "2026-06-21T12:00:00.000Z",
  "release": {
    "commit": "80df570",
    "environment": "production",
    "deploymentVersion": "mosaic-80df57008f33c03df8c0a590efa8d573813ff070"
  }
}
```

When release variables are unset locally, `commit` and `deploymentVersion` fall back to `unknown` / `mosaic-unknown`.

---

## Sentry tagging

Configured in [`instrument.js`](../../instrument.js) via [`utils/releaseIdentity.js`](../../utils/releaseIdentity.js):

- `release` → `SENTRY_RELEASE` or deployment label
- `environment` → `RELEASE_ENVIRONMENT` → `SENTRY_ENVIRONMENT` → `NODE_ENV`
- Tags: `deployment_version`, `commit_sha`, `environment`
- HTTP 5xx capture adds the same release tags

PII scrubbing in `beforeSend` is unchanged.

---

## Smoke verification

```bash
npm run smoke:backend
```

Checks:

- `P0.5` — `/api/health` includes safe `release` object
- `P0.6` — `/api/build-info` includes safe `release` object

Local example:

```bash
RELEASE_COMMIT_SHA=80df570 RELEASE_ENVIRONMENT=development DEPLOYMENT_VERSION_LABEL=mosaic-80df570 npm start
API_BASE_URL=http://127.0.0.1:3001 npm run smoke:backend
```

---

## Rollback notes

1. Roll back EB to prior version label (e.g. `mosaic-<previous-sha>`).
2. Update **all four** release variables to the rolled-back SHA/label.
3. Confirm `/api/health` → `release.deploymentVersion` matches the active EB label.
4. Confirm Sentry events group under the rolled-back `release` string.

---

## Source files

| File | Role |
| --- | --- |
| `utils/releaseIdentity.js` | Canonical release resolution + public payload |
| `routes/healthRoutes.js` | Health/readiness/build-info responses |
| `instrument.js` | Sentry release/environment/tags |
| `middlewares/sentryHttpCapture.js` | Release tags on 5xx events |
| `index.js` | Startup `[release]` log line |
