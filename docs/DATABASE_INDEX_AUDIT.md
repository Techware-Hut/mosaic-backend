# Database Index Audit (Issue #53)

**Date:** 2026-06-18  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`

---

## Purpose

Document Mongoose schema indexes relevant to public marketplace queries. Identify gaps for Service/Food. Atlas `explain()` analysis marked **blocked** (requires DBA/production access).

---

## Product indexes (implemented)

Source: [`models/Product.js`](../models/Product.js)

```javascript
productSchema.index({ isFeatured: 1, isPublished: 1, isDeleted: 1, createdAt: -1 });
productSchema.index({ businessId: 1, isPublished: 1, isDeleted: 1 });
productSchema.index({ isPublished: 1, isDeleted: 1, createdAt: -1 });
```

| Index | Serves |
| --- | --- |
| Featured compound | `GET /api/featured-products` |
| businessId + publish | Products by business, vendor storefront |
| Publish + createdAt | Ranked feed, default product lists |

Added in prior batch; covered by marketplace list query patterns.

---

## Business indexes (visibility scope)

Source: [`models/Business.js`](../models/Business.js)

| Index | Serves |
| --- | --- |
| `{ isActive: 1, isApproved: 1 }` | Active business filtering |
| `{ tags: 1 }` | Tag search |
| `{ location: '2dsphere' }` | Geo (limited public use — ZIP/text filters primary) |
| `{ owner: 1 }`, `{ subscriptionId: 1 }` | Vendor/admin lookups |

Public lists call `Business.find({ isActive: true })` — `isActive` leading in compound index helps when combined with approval filters.

---

## Service indexes — gaps

Source: [`models/Service.js`](../models/Service.js)

```javascript
serviceSchema.index({ ownerId: 1 });
serviceSchema.index({ categoryId: 1 });
```

| Gap | Public query pattern | Suggested index (deferred) |
| --- | --- | --- |
| No publish compound | `Service.find({ isPublished: true, businessId: { $in: [...] } })` | `{ businessId: 1, isPublished: 1 }` |
| No list sort index | Lists sort by `createdAt` | `{ isPublished: 1, createdAt: -1 }` |

---

## Food indexes — gaps

Source: [`models/Food.js`](../models/Food.js)

**No explicit `.index()` declarations** in schema.

| Gap | Public query pattern | Suggested index (deferred) |
| --- | --- | --- |
| Publish + delete | `isPublished: true, isDeleted: false` | `{ isPublished: 1, isDeleted: 1, createdAt: -1 }` |
| Business scope | `businessId` + publish | `{ businessId: 1, isPublished: 1, isDeleted: 1 }` |

---

## Other marketplace-related indexes

| Model | Indexes | Notes |
| --- | --- | --- |
| `Order` | `{ userId, vendorId, status }`, `{ groupOrderId }` | Checkout — not public browse |
| `Cart` / `CartItem` | userId, businessId, productId | Authenticated |
| `Review` | compound on listing | #35 reviews |

---

## Atlas explain — blocked

| Task | Blocker |
| --- | --- |
| `explain('executionStats')` on prod slow queries | Requires Atlas login + DBA review |
| Index build on Food/Service | Migration + staging validation |

Document only until DBA runs explain on representative queries from [PUBLIC_API_PAGINATION_AUDIT.md](PUBLIC_API_PAGINATION_AUDIT.md) endpoints.

---

## Issue #53 status

**Partial progress** — Product indexes documented and in place; Service/Food gaps listed with suggested compounds. Production explain and index migrations deferred.
