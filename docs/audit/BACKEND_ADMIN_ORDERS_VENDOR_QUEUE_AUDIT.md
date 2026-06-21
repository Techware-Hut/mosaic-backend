# Backend Admin Orders & Vendor Queue Launch Blocker Audit

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch:** `audit/backend-admin-orders-vendor-queue-blockers`  
**Audit commit:** `d3c5a22`  
**Base commit:** `fd59d7fbad6a645327b44656dd3c4000011529f6` (includes PR #101 reconcile fix `d333cbc`)  
**Evidence date:** 2026-06-20  
**Production API:** `https://api.mosaicbizhub.com`  
**Launch frontend:** `https://mosaic-biz-frontend-launch.vercel.app`

No secrets, cookie values, JWTs, OTPs, payment IDs, credentials, or PII in this document.

---

## Executive verdict

| Blocker | Root cause | Owner | Backend P0? |
| --- | --- | --- | --- |
| `/admin/orders` broken | Path contract mismatch — frontend expects `GET /admin/api/orders`; backend only had `GET /api/orders/admin` (prod **404** on wrong path) | backend + frontend | **Yes** — missing alias for established admin prefix pattern |
| Paid vendor not in admin queue | Data-state / flow — payment sets `status=draft`; admin queue filters `status=submitted` only; vendor must call `POST /api/vendor-onboarding/submit` | frontend + vendor flow | **No** — working as designed |

CORS, auth guards, health probes, and full test suite **PASS** on production and locally.

---

## Scope A — Admin orders

### Registered routes (before fix)

| Method | Full path | File | Middleware | Handler |
| --- | --- | --- | --- | --- |
| GET | `/api/orders/admin` | `routes/orderRoutes.js:25` | `authenticate` → `isAdmin` | `getAllOrdersAdmin` |

**Not registered (prod 404 confirmed):**

- `GET /admin/api/orders` — documented in `draft.txt:326` as frontend contract
- `GET /api/admin/orders`

### Auth and response contract

- Unauthenticated → **401** `{ success: false, message: "Authentication required" }`
- Non-admin → **403** `{ message: "Access denied: Admin only" }`
- Admin **200** response shape:

```json
{
  "success": true,
  "message": "Orders fetched successfully",
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 },
  "summary": { "payment": { ... }, "status": { ... } }
}
```

**Note:** Admin list uses `data`, not `orders` (unlike `GET /api/orders/user` and `GET /api/orders/vendor`).

### Production probes (pre-fix)

| Probe | Result |
| --- | --- |
| `GET /` | **200** |
| `GET /api/health` | **200** |
| `GET /api/ready` | **200** (database connected) |
| CORS OPTIONS `/api/orders/admin` from launch Vercel origin | **204**, ACAO echoes origin, `credentials: true` |
| `GET /api/orders/admin` (no auth) | **401** |
| `GET /admin/api/orders` (no auth) | **404** |
| `GET /api/admin/orders` (no auth) | **404** |

### Root cause — admin orders

**Primary:** Frontend assumes `/admin/api/*` pattern (same as `/admin/api/products`), but orders were implemented at `/api/orders/admin` and omitted from `docs/BACKEND_FRONTEND_ROUTE_CONTRACT.md`.

**Secondary:** Response key is `data`, not `orders` — frontend parsing `response.orders` would fail even after path fix.

**Fix applied:** `GET /admin/api/orders` alias → same `getAllOrdersAdmin` handler. Canonical `GET /api/orders/admin` unchanged.

---

## Scope B — Paid vendor missing from admin queue

### Route contracts

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/vendor-onboarding/stage1/payment-status` | `authenticate` + `requireVerifiedVendor` | `getPaymentStatus` |
| POST | `/api/vendor-onboarding/submit` | `authenticate` + `requireVerifiedVendor` | `submitForReview` |
| GET | `/api/vendor-onboarding/pending` | `authenticate` + `isAdmin` | `getPendingApplications` |

Duplicate admin mount: `/admin/vendor-onboard-verify-stage1/pending`.

### Pending queue filter

```javascript
const PENDING_REVIEW_STATUSES = ['submitted'];

VendorOnboarding.find({ status: { $in: PENDING_REVIEW_STATUSES } })
```

- **Implemented filter:** `status === "submitted"` only
- **No** `verificationPayment.status === "paid"` filter in query
- **Effective membership:** paid + submitted (submit requires payment), but payment alone is insufficient

Excluded by design: `draft`, `payment_pending`, `rejected`, `verified`.

### State machine after payment

1. `create-payment` → `payment_pending`
2. Stripe webhook success → `verificationPayment.status = paid`, `status = draft` (not `submitted`)
3. `POST /submit` → `status = submitted` → appears in admin pending queue

### Submit + reconcile

- `POST /submit` allows `draft`, `payment_pending`, `rejected`
- Payment gate: DB `paid` **or** `reconcileVendorVerificationPaymentFromStripe()` (PR #101 on `main`)
- `GET /stage1/payment-status` does **not** reconcile — `canSubmit` may be `false` while submit would succeed

### Production probes

| Probe | Result |
| --- | --- |
| `GET /api/vendor-onboarding/pending` (no auth) | **401** |
| Credentialed vendor/admin state | **SKIPPED** (no smoke tokens in session) |
| Production DB snapshot | **SKIPPED** (no vendor identifier) |

### Root cause — vendor queue

**Most likely:** Vendor paid $24.99 but never called `POST /api/vendor-onboarding/submit`. Application remains `draft`; admin queue correctly empty.

**No backend code change** in this audit — frontend must call submit after payment success.

---

## Fix summary (this branch)

| File | Change |
| --- | --- |
| `routes/admin/adminOrderRoutes.js` | New — `GET /` → `getAllOrdersAdmin` |
| `app.js` | Mount `app.use('/admin/api/orders', adminOrderRoutes)` |
| `tests/launch/backend-launch-contract.test.js` | Assert alias mount + guards |
| `tests/admin/admin-order-routes-guard.test.js` | Static guard tests |
| `docs/BACKEND_FRONTEND_ROUTE_CONTRACT.md` | Admin orders path + `data` response key |
| `docs/backend/BACKEND_ROUTE_REGISTRATION.md` | Register alias route |

---

## Commands run

| Command | Result |
| --- | --- |
| `git checkout -b audit/backend-admin-orders-vendor-queue-blockers` | Created from `main` @ `fd59d7f` |
| `npm test` | **243 pass**, 0 fail |
| `npm run test:contract` | **18 pass**, 0 fail |
| `GET /admin/api/orders` prod (pre-deploy) | **404** — expect **401** after EB deploy |

---

## Known risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| EB may lag `main` — reconcile fix not live | P2 | Confirm EB version label includes `fd59d7f` before vendor submit testing |
| Frontend parses `orders` not `data` | P1 | Documented in contract; coordinate frontend if page still broken after alias deploy |
| `canSubmit: false` after Stripe success | P2 | Frontend should still attempt submit; optional reconcile on payment-status follow-up |
| No admin smoke account | P2 | Set `SMOKE_TEST_ADMIN_TOKEN` for post-deploy credentialed proof |

---

## What was not tested

- Credentialed `GET /api/orders/admin` or alias with admin JWT/cookie
- Credentialed `GET /api/vendor-onboarding/pending` with admin session
- Specific vendor application production state
- Live $24.99 Stripe charge E2E
- MongoDB read-only snapshot against production Atlas
- EB deployed commit SHA confirmation

---

## Rollback

Revert `app.use('/admin/api/orders', ...)` mount and `routes/admin/adminOrderRoutes.js`. Canonical `GET /api/orders/admin` unaffected — zero payment impact.
