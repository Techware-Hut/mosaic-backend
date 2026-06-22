# Service Publication & Public Visibility — Backend Proof

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch:** `fix/backend-service-publication-visibility-contract`  
**Cross-repo:** [Digital-Builders-757/mosaic-biz-frontend-launch#185](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/185)  
**Evidence date:** 2026-06-22  

No secrets, JWTs, tokens, credentials, or PII in this document.

---

## Executive verdict

**Root cause:** Multi-factor contract and visibility bug — not a single missing flag.

1. `createService` ignored vendor-supplied parent `title`/`description` and did not normalize frontend `{ name }`-only child payloads.
2. `isPublished` defaults to `false`, so drafts never appear on `GET /api/services/list` until published.
3. `GET /api/public/services/:id` and `GET /api/service/business-service/:id` omitted the `isPublished` gate used by list/slug/search.

**Fix:** Canonical parent+child DTO in `lib/service/serviceContract.js`, aligned create/update validation, publication metadata on owner responses, consistent public visibility gates.

---

## Product contract (locked)

**Model A:** One parent `Service` document per business with embedded bookable `services[]` children.

---

## Canonical service DTO

### Parent fields (persisted)

| Field | Source |
|-------|--------|
| `title`, `description` | Request body |
| `categoryId`, `subcategoryId`, `businessId` | Request body |
| `isPublished` | Request body (default `false`) |
| `price` | Derived `min(services[].price)` |
| `duration` | `''` when children exist |
| `slug` | Auto from `title` |

### Child fields (`services[]`)

| Field | Required |
|-------|----------|
| `name` | yes |
| `price` | yes (`>= 0`) |
| `durationMinutes` | yes (or parseable `duration` alias) |

### Frontend compatibility

When exactly one child has only `name` and top-level `price` + `duration`/`durationMinutes` are present, values backfill that child before validation.

### Owner publication block (additive)

```json
{
  "success": true,
  "data": {
    "service": {},
    "publication": {
      "isPublished": true,
      "isPubliclyVisible": true,
      "visibilityReason": null
    }
  }
}
```

Stable `visibilityReason` codes: `SERVICE_UNPUBLISHED`, `BUSINESS_INACTIVE`, `BUSINESS_NOT_PUBLICLY_ELIGIBLE`, `INVALID_SERVICE_DATA`.

---

## Before / after payload example

**Frontend payload:**

```json
{
  "title": "Hair Styling",
  "description": "Full salon menu",
  "price": 45,
  "duration": "60",
  "services": [{ "name": "Basic Cut" }]
}
```

**Before:** `title: "Service"`, empty description, `isPublished: false`, often 400 on missing child duration.

**After:** Parent title/description preserved; child gets `price: 45`, `durationMinutes: 60`; publish via `PUT /api/service/:id`.

---

## Files changed

| File | Change |
|------|--------|
| `lib/service/serviceContract.js` | New DTO + publication helpers |
| `controllers/serviceController.js` | Create/update/read contract + duplicate guard |
| `controllers/publicListing.js` | Public ID/slug visibility gates |
| `controllers/privateListing.js` | `ownerId` + `categoryId` filter fixes |
| `tests/service/service-payload-contract.test.js` | Unit tests |
| `tests/service/service-publication-visibility.test.js` | Controller visibility tests |
| `tests/integration/service-publication.integration.test.js` | End-to-end proof |
| `tests/integration/helpers/factories.js` | Service seed helpers |
| `scripts/service-publication-smoke.ps1` | Runtime smoke script |

---

## Commands run

| Command | Result |
|---------|--------|
| `npm test` | **302 pass**, 0 fail |
| `npm run test:integration` | **28 pass**, 0 fail |
| `node --test tests/service/service-*.test.js` | **13 pass**, 0 fail |
| `node --check` on modified controllers + contract lib | **PASS** |

---

## Integration proof (in-memory Mongo)

`tests/integration/service-publication.integration.test.js` proves:

1. Draft created with frontend-shaped payload → private list includes service, public list excludes it, public detail 404.
2. `PUT` publish same `_id` → `GET /api/services/list` and `GET /api/public/services/:id` both return the service.
3. Unpublish → public list and detail 404.
4. Republish → still one document (`Service.countDocuments === 1`).
5. Retry `POST /api/service/` → **409** with `existingServiceId`.

---

## Runtime smoke (live API)

Script: `scripts/service-publication-smoke.ps1`

Requires env (not configured in local session):

- `SMOKE_TEST_VENDOR_TOKEN`
- `SMOKE_TEST_BUSINESS_ID`
- `SMOKE_TEST_SERVICE_CATEGORY_ID`
- `SMOKE_TEST_SERVICE_SUBCATEGORY_ID`

**Status:** BLOCKED — env-owned credentials not provided in this session. Integration test provides equivalent proof locally.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Clients relied on unpublished public ID reads | Matches visibility matrix; intentional |
| Duplicate POST now returns 409 | Document: use PUT to publish/update |
| Additive response shape | Legacy `service`/`message` keys preserved |

## Rollback

Revert branch commits. No schema migration required.

## Not tested

- Live production API with disposable vendor credentials
- Frontend E2E in mosaic-biz-frontend-launch
- S3/Cloudinary upload during service create
- Booking/review flows after visibility fix

---

## PR

Open after commit/push: `fix/backend-service-publication-visibility-contract` → `main`.
