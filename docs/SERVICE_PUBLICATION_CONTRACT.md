# Service Publication Contract (Model A)

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch:** `fix/backend-service-publication-visibility-contract`  
**Frontend dependency:** [mosaic-biz-frontend-launch PR #186](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/pull/186) / [issue #185](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/185)  
**Related:** [SERVICE_PUBLICATION_VISIBILITY_PROOF.md](SERVICE_PUBLICATION_VISIBILITY_PROOF.md), [MARKETPLACE_VISIBILITY_MATRIX.md](MARKETPLACE_VISIBILITY_MATRIX.md)

No secrets, tokens, or credentials in this document.

---

## Model A (publication owner)

One parent `Service` MongoDB document per business. Bookable line items live in embedded `services[]` children — not separate Service documents.

Publication state is owned by the parent field **`isPublished`** (Boolean, default `false`).

---

## Public eligibility predicate

A service is **publicly eligible** when **all** of the following are true:

```text
service.isPublished === true
AND Business.exists({ _id: service.businessId, isActive: true })
```

**Not** required for public browse:

- `Business.isApproved`
- Vendor onboarding / verification status
- `Service.isDeleted` (field does not exist on Service model)

Owner-facing metadata (`evaluateServicePublication` in `lib/service/serviceContract.js`) additionally validates embedded children and returns stable codes:

| Code | Meaning |
|------|---------|
| `SERVICE_UNPUBLISHED` | `isPublished` is false |
| `INVALID_SERVICE_DATA` | Published but child validation fails |
| `BUSINESS_NOT_PUBLICLY_ELIGIBLE` | Business record missing |
| `BUSINESS_INACTIVE` | `business.isActive !== true` |

When publicly visible, `visibilityReason` is `null` and `isPubliclyVisible` is `true`.

---

## Route contract

### Vendor create / update / delete

| Method | Path | Auth | Ownership |
|--------|------|------|-----------|
| POST | `/api/service/` | `authenticate`, `isBusinessOwner` | `Business.findOne({ _id: businessId, owner: userId })`; one listing per business (409 on duplicate) |
| PUT | `/api/service/:id` | same | `Service.findOne({ _id, ownerId: userId })` — publish/unpublish via `{ isPublished: true/false }` |
| DELETE | `/api/service/delete-service/:id` | same | `Service.findOne({ _id, ownerId: userId })` |
| GET | `/api/service/:id` | same | Owner read + `data.publication` metadata |
| GET | `/api/service/my-services` | same | All owner services + `publicationByServiceId` map |

**Mount:** `app.use('/api/service', serviceRoutes)` in `app.js`.

### Vendor inventory

| Method | Path | Auth | Ownership |
|--------|------|------|-----------|
| GET | `/api/private/services/list?businessId=` | `authenticate`, `isBusinessOwner` | `filters: { businessId, ownerId: req.user._id }` — returns drafts and published by default |
| GET | `/api/private/services/:slug` | same | `{ slug, ownerId: req.user._id }` |

**Mount:** `app.use('/api/private', privateListingRoutes)`.

### Public discovery and detail

| Method | Path | Auth | Visibility gate |
|--------|------|------|-----------------|
| GET | `/api/services/list` | None | `{ isPublished: true, businessId ∈ activeBusinessIds }` |
| GET | `/api/public/services/:id` | None | 404 if unpublished or business inactive — **frontend `/vendor-profile/service-vendor/:id`** |
| GET | `/api/services/:slug` | None | `{ slug, isPublished: true }` + active business |
| GET | `/api/service/business-service/:id` | None | Same publish + active business gates |
| GET | `/api/public/search` | None | Services: `isPublished: true` + active business scope |

**Mount:** `app.use('/api', publicListingRoutes)`.

---

## Request payload (create / update)

### Required for create

| Field | Notes |
|-------|-------|
| `businessId` | Must belong to authenticated vendor |
| `categoryId`, `subcategoryId` | ObjectIds |
| `services[]` | At least one child with `name`, `price`, `durationMinutes` (or parseable `duration` / top-level backfill) |

### Publication

| Field | Behavior |
|-------|----------|
| `isPublished: false` | Draft — private inventory only |
| `isPublished: true` | Publish — requires valid child data; blocked with 400 if invalid |
| Omitted on create | Defaults to `false` |

### Frontend compatibility

When exactly one child has only `name` and top-level `price` + `duration`/`durationMinutes` are present, values backfill that child before validation (`normalizeServicePayload`).

---

## Response shape (owner create / update / read)

```json
{
  "success": true,
  "message": "Service updated successfully",
  "service": { "_id": "...", "isPublished": true, "services": [] },
  "data": {
    "service": { "_id": "...", "isPublished": true, "services": [] },
    "publication": {
      "isPublished": true,
      "isPubliclyVisible": true,
      "visibilityReason": null
    }
  }
}
```

Legacy top-level `service` is preserved for backward compatibility. Frontend PR #186 reads `data.publication` and falls back to public probe when metadata is absent.

---

## HTTP status codes

| Situation | Status |
|-----------|--------|
| Validation failure (child price/duration, publish without valid children) | 400 + `fieldErrors` |
| Unauthenticated vendor route | 401 |
| Wrong business ownership / no subscription | 403 |
| Service not found or not owned | 404 |
| Duplicate POST for same business | 409 + `existingServiceId` |

---

## Middleware order (unchanged)

Stripe webhook paths use `express.raw({ type: 'application/json' })` **before** `express.json`. Service routes are mounted after JSON parsing. Do not reorder when deploying this contract.

---

## Deployment dependency

1. Merge and deploy **backend** to Elastic Beanstalk (manual workflow from `main`).
2. Run post-deploy smoke: `scripts/service-publication-smoke.ps1`
3. Validate **frontend PR #186** preview against deployed API.

Deploy backend **before** frontend manual smoke for issue #185 closure.

---

## Runtime smoke env var names (values in session only)

| Name | Purpose |
|------|---------|
| `SMOKE_TEST_VENDOR_TOKEN` | Bearer token for vendor API calls |
| `SMOKE_TEST_BUSINESS_ID` | Target business ObjectId |
| `SMOKE_TEST_SERVICE_CATEGORY_ID` | Category for create payload |
| `SMOKE_TEST_SERVICE_SUBCATEGORY_ID` | Subcategory for create payload |
| `API_BASE_URL` | Optional; default `https://api.mosaicbizhub.com` |

---

## Rollback procedure

1. Revert merge commit on `main` (no schema migration).
2. Redeploy previous EB application version.
3. Frontend PR #186 will fall back to public probe but may show stale visibility if backend regresses.

---

## Automated test coverage

| File | Scope |
|------|-------|
| `tests/service/service-payload-contract.test.js` | DTO normalization, publish validation, visibility codes |
| `tests/service/service-publication-visibility.test.js` | Controller unit tests |
| `tests/integration/service-publication.integration.test.js` | Full HTTP flow: draft, publish-on-create, unpublish, republish, cross-vendor 404, inactive business, slug ownership, public surfaces |

Commands:

```bash
npm test
npm run test:integration
node --test tests/service/service-*.test.js
```
