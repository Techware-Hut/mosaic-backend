# Backend Documentation Evidence Log

**Pack:** Launch readiness as-built documentation control pack  
**Branch:** `docs/backend-as-built-documentation-pack`  
**Evidence date:** 2026-06-19  
**Author:** Cursor agent (documentation/audit only)

---

## Deliverables

| File | Purpose |
| --- | --- |
| [BACKEND_ARCHITECTURE_AS_BUILT.md](BACKEND_ARCHITECTURE_AS_BUILT.md) | Stack, bootstrap, middleware order, mount registry |
| [BACKEND_ROUTE_REGISTRATION.md](BACKEND_ROUTE_REGISTRATION.md) | Registered routes with auth/role/status |
| [API_CONTRACT_AS_BUILT.md](API_CONTRACT_AS_BUILT.md) | Frontend-reconciliation contracts |
| [DATA_MODEL_DICTIONARY.md](DATA_MODEL_DICTIONARY.md) | 38 Mongoose models, key fields |
| [AUTH_CORS_COOKIE_AUDIT.md](AUTH_CORS_COOKIE_AUDIT.md) | Auth, CORS, cookie behavior |
| [STRIPE_PAYMENT_CONNECT_AUDIT.md](STRIPE_PAYMENT_CONNECT_AUDIT.md) | Webhooks, checkout, Connect flows |
| [BACKEND_ENVIRONMENT_VARIABLES_NAMES_ONLY.md](BACKEND_ENVIRONMENT_VARIABLES_NAMES_ONLY.md) | Env var names by class |
| [BACKEND_DEPLOYMENT_RUNBOOK_DRAFT.md](BACKEND_DEPLOYMENT_RUNBOOK_DRAFT.md) | Deploy/smoke draft runbook |
| [BACKEND_DOCUMENTATION_EVIDENCE_LOG.md](BACKEND_DOCUMENTATION_EVIDENCE_LOG.md) | This file |

**Index update:** [../README.md](../README.md) — Launch readiness section added.

---

## Commands run

| Command | Exit code | Result |
| --- | --- | --- |
| `git fetch origin main && git checkout main && git pull origin main` | 0 | Already up to date |
| `git checkout -b docs/backend-as-built-documentation-pack` | 0 | Branch created |
| `npm test` | 0 | **212 pass**, 0 fail, ~2.3s |
| `npm run smoke:backend` | **Not run** | Requires live API URL; skipped for docs-only pack |
| `seed/*`, EB deploy, Stripe live charges | **Not run** | Per task constraints |

### Test summary (2026-06-19)

```
npm test → node --test tests/**/*.test.js
ℹ tests 212
ℹ pass 212
ℹ fail 0
```

---

## Methodology

1. Read authoritative registry [`app.js`](../../app.js) for mount order and middleware
2. Cross-check route files under `routes/` and controllers
3. Cross-reference existing [`../API_SURFACE.md`](../API_SURFACE.md)
4. Mark each finding **verified** (code read), **inferred** (mount only), or **evidence needed**
5. No runtime code changes; no secrets printed

---

## Key route findings

| Finding | Status |
| --- | --- |
| `GET /api/featured-products` is canonical featured endpoint | **verified** |
| `GET /api/products/featured` is NOT registered | **verified absent** |
| `GET /api/business/my` exists (`authenticate` + `isBusinessOwner`) | **verified** |
| Five Stripe webhooks mounted before `express.json()` | **verified** |
| `POST /api/orders/initiate` Connect destination charge flow | **verified** |
| `POST /api/connect/:businessId/account-link` | **verified** |
| Payment success/failure backend routes | **evidence needed** (not in repo) |
| Unmounted dead file `routes/cms/cmsRoutes.js` | **verified** |
| Duplicate mounts: vendor onboarding, CMS, admin business | **verified** |

---

## Key risks and unknowns

| Risk | Detail |
| --- | --- |
| Inconsistent error response shapes | Controllers use mixed `{ message }`, `{ success, errors }`, etc. |
| Product validators commented out | `routes/productRoutes.js` — route-level validation disabled |
| Legacy payment route overlap | `/api/payments/create-payment-intent` vs `/api/orders/initiate` |
| Admin route without router guard | e.g. `GET /api/admin/categories` public — see API_SURFACE |
| No global 404 handler | Unmatched routes fall through to Express default |
| Production env values | Not confirmable from repo alone |

---

## What was NOT tested

- Live Stripe payments or webhook delivery to production
- AWS S3 uploads
- SMTP email delivery
- `npm run smoke:backend` against production or local running server
- Elastic Beanstalk deploy
- Full manual P0–P6 production smoke checklist
- Frontend payment redirect URL behavior

---

## Evidence needed (external)

| Item | Owner |
| --- | --- |
| Production EB env var audit (names present; values in EB only) | AWS / release owner |
| Stripe Dashboard webhook URLs registered for `https://api.mosaicbizhub.com` | Stripe admin |
| Production `CORS_ORIGINS` value confirmation | AWS EB + frontend |
| Payment success/failure page URLs (Vercel) | Frontend team |
| Whether frontend uses legacy `POST /api/payments/create-payment-intent` | Frontend team |
| `GET /api/business/my` exact response JSON for contract tests | Backend + frontend diff |
| Current production deploy SHA / EB version label | Release owner |
| Go/No-Go launch sign-off | Product / release owner |

---

## Recommended next step

1. **Frontend contract diff** — Compare frontend API client calls against [API_CONTRACT_AS_BUILT.md](API_CONTRACT_AS_BUILT.md)
2. **QA smoke** — Run [../production-smoke-checklist.md](../production-smoke-checklist.md) P0–P6 against production with test accounts
3. **Stripe webhook audit** — Confirm Dashboard endpoints match five secret env var names in EB
4. **Close evidence gaps** — Document payment redirect URLs and `/api/business/my` response from live or staging-like test

---

## PR metadata (fill on merge)

| Field | Value |
| --- | --- |
| Branch | `docs/backend-as-built-documentation-pack` |
| Commit SHA | `ea27392` |
| PR link | https://github.com/Techware-Hut/mosaic-backend/pull/94 |
| Deploy | **Not performed** |
| Merge | **Not performed** |
