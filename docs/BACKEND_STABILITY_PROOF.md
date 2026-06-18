# Backend Stability Proof Pack

**Branch:** `sprint/backend-stability-roadmap-cleanup`  
**Date:** 2026-06-18  
**Production API checked:** `https://api.mosaicbizhub.com` (pre-deploy baseline SHA `7d01011`)

---

## Files changed

| File | Change |
| --- | --- |
| [controllers/featuredProducts.controller.js](../controllers/featuredProducts.controller.js) | Active-business filter, pagination clamp, empty-state handling |
| [controllers/publicListing.js](../controllers/publicListing.js) | Search default business scope, list pagination caps |
| [controllers/productListingController.js](../controllers/productListingController.js) | Ranked `isPublished: true` filter |
| [models/Product.js](../models/Product.js) | Compound indexes for public listing queries |
| [app.js](../app.js) | Mount `mongo-sanitize` and `xss-clean` after JSON parser |
| [tests/marketplace/featured-products-response.test.js](../tests/marketplace/featured-products-response.test.js) | Visibility + limit cap tests |
| [tests/marketplace/public-search-filters.test.js](../tests/marketplace/public-search-filters.test.js) | Default business scope test |
| [tests/marketplace/ranked-products-visibility.test.js](../tests/marketplace/ranked-products-visibility.test.js) | New ranked visibility test |
| [docs/BACKEND_STABILITY_AGENT_PROMPT.md](BACKEND_STABILITY_AGENT_PROMPT.md) | Reusable stabilization prompt |
| [docs/BACKEND_STABILITY_ROADMAP_AUDIT.md](BACKEND_STABILITY_ROADMAP_AUDIT.md) | Audit snapshot |
| [docs/BACKEND_ROADMAP_ISSUES.md](BACKEND_ROADMAP_ISSUES.md) | Prioritized issue plan |
| [docs/AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) | Link to agent prompt; test count update |
| [docs/README.md](README.md) | Index links for new docs |

---

## Commands run

| Command | Result |
| --- | --- |
| `npm test` | **178/178 pass** |
| `npm run lint` | **Not defined** in package.json |
| `npm run build` | **Not defined** in package.json |
| `npm run typecheck` | **Not defined** in package.json |
| `node scripts/verify-auth-check-smoke.js` | **Skipped** (requires live credentials; not required for this sprint) |

Exact test command:

```powershell
npm test
```

---

## Test results summary

- **Before sprint:** 173 tests on `main`
- **After sprint:** **178 tests** (+5 new marketplace tests)
- **Failures:** None
- **Pre-existing failures:** None introduced

New tests cover:

- Featured products active-business query scope
- Featured products empty state when no active businesses
- Featured products limit cap at 50
- Public search default active-business scope
- Ranked products require `isPublished: true`

---

## Manual endpoint checks (production, read-only GET)

Checked against live API **before** this branch is deployed (baseline behavior; fixes apply after EB deploy).

| Endpoint | HTTP status |
| --- | --- |
| `GET /` | 200 |
| `GET /api/featured-products?page=1&limit=12` | 200 |
| `GET /api/products/list?page=1&limit=10` | 200 |
| `GET /api/public/search?keyword=test` | 200 |
| `GET /api/ranked?page=1&pageSize=24` | 200 |
| `GET /api/categories` | 200 |

---

## Database indexes added

Added to [models/Product.js](../models/Product.js) (Mongoose schema):

```javascript
productSchema.index({ isFeatured: 1, isPublished: 1, isDeleted: 1, createdAt: -1 });
productSchema.index({ businessId: 1, isPublished: 1, isDeleted: 1 });
productSchema.index({ isPublished: 1, isDeleted: 1, createdAt: -1 });
```

**Note:** Mongoose builds indexes on connect when `autoIndex` is enabled (default in dev). Production Atlas may require a one-time index build after deploy. No SQL migration files — MongoDB/Mongoose only.

---

## Security middleware

- `express-mongo-sanitize` and `xss-clean` mounted in [app.js](../app.js) **after** `express.json()` and **after** Stripe webhook raw-body routes (webhook signature verification unchanged).

---

## Environment variables (no values)

No new env vars required for this sprint. Related observability vars (unchanged, for reference):

| Variable | Purpose |
| --- | --- |
| `SENTRY_DSN` | Enable Sentry (#18 — on `main`, EB deploy pending) |
| `SENTRY_ENABLED` | Opt-out toggle |
| `MAIL_USER` / `MAIL_PASSWORD` | Vendor email delivery |
| `MONGODB_URI` | Database connection |

---

## Intentionally deferred

| Item | Reason | Tracked |
| --- | --- | --- |
| #41 payment route hardening | Out of scope; separate security PR | #41 |
| #43 order email timing | Verify only; no checkout changes | #43 |
| Global error response pass | Large refactor | #46 |
| DTO consolidation | Large refactor | #45 |
| Service/Food model indexes | Lower traffic than products in audit | #53 |
| `getVisibleBusinessIds()` caching | Performance follow-up | #44 |
| Dedicated `/api/health` | Separate issue | #69 |
| Sentry prod verification | Requires EB deploy of #18 | #18 |

---

## Remaining risks after merge

1. Fixes are **not live** until EB deploy from `main`
2. Index build on production MongoDB should be confirmed post-deploy
3. #41 unauthenticated payment routes remain until separate PR
4. Full tiered smoke (#27) still needs `SMOKE_TEST_*` accounts

---

## Related docs

- [BACKEND_STABILITY_ROADMAP_AUDIT.md](BACKEND_STABILITY_ROADMAP_AUDIT.md)
- [BACKEND_ROADMAP_ISSUES.md](BACKEND_ROADMAP_ISSUES.md)
- [BACKEND_STABILITY_AGENT_PROMPT.md](BACKEND_STABILITY_AGENT_PROMPT.md)
