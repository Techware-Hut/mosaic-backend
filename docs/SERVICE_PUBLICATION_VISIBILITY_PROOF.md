# Service Publication & Public Visibility — Backend Proof

**Repo:** [Techware-Hut/mosaic-backend](https://github.com/Techware-Hut/mosaic-backend)  
**Branch:** `fix/backend-service-publication-visibility-contract`  
**Cross-repo:** [Digital-Builders-757/mosaic-biz-frontend-launch#185](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/185) · [PR #186](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/pull/186)  
**Canonical contract:** [SERVICE_PUBLICATION_CONTRACT.md](SERVICE_PUBLICATION_CONTRACT.md)  
**Evidence date:** 2026-06-22  

No secrets, JWTs, tokens, credentials, or PII in this document.

---

## Executive verdict

**Model A status:** Partially existed before PR #108; core contract corrected on `main` via [PR #108](https://github.com/Techware-Hut/mosaic-backend/pull/108) (merge `7944491`). This branch adds verification gaps: private slug ownership, extended integration tests, and contract documentation for frontend PR #186.

**Root cause (pre-#108):** Multi-factor contract and visibility bug — not a single missing flag.

1. `createService` ignored vendor-supplied parent `title`/`description` and did not normalize frontend `{ name }`-only child payloads.
2. `isPublished` defaults to `false`, so drafts never appear on `GET /api/services/list` until published.
3. `GET /api/public/services/:id` and `GET /api/service/business-service/:id` omitted the `isPublished` gate used by list/slug/search.

**This branch additionally fixes:** `GET /api/private/services/:slug` no longer returns another vendor's service (adds `ownerId` filter).

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

## Files changed (this branch)

| File | Change |
|------|--------|
| `controllers/privateListing.js` | Private slug route scoped to `ownerId` |
| `tests/integration/service-publication.integration.test.js` | Extended 12-scenario HTTP proof |
| `docs/SERVICE_PUBLICATION_CONTRACT.md` | Canonical route contract (new) |
| `docs/SERVICE_PUBLICATION_VISIBILITY_PROOF.md` | Updated proof + PR references |

Prior PR #108 also introduced: `lib/service/serviceContract.js`, `serviceController.js`, `publicListing.js`, unit tests, smoke script.

---

## Commands run

| Command | Result |
|---------|--------|
| `npm test` | Run at PR time — see PR body |
| `npm run test:integration` | **34 pass**, 0 fail (includes 6 service-publication tests) |
| `node --test tests/service/service-*.test.js` | Run at PR time |
| `node --check` on modified controllers + contract lib | **PASS** |

---

## Integration proof (in-memory Mongo)

`tests/integration/service-publication.integration.test.js` proves:

1. Draft → private list + my-services include service; public list/detail/slug/business-service exclude.
2. Publish → all public surfaces return service.
3. Unpublish → all public surfaces 404.
4. Republish → public surfaces visible again; still one document.
5. Create with `isPublished: true` → immediately public.
6. Cross-vendor PUT/DELETE → 404.
7. Inactive business + published → owner `BUSINESS_INACTIVE`; public 404.
8. Private slug → owner 200; other vendor 404.
9. Duplicate POST → **409**.

---

## Runtime smoke (live API)

Script: `scripts/service-publication-smoke.ps1`

Requires env (not configured in local session):

- `SMOKE_TEST_VENDOR_TOKEN`
- `SMOKE_TEST_BUSINESS_ID`
- `SMOKE_TEST_SERVICE_CATEGORY_ID`
- `SMOKE_TEST_SERVICE_SUBCATEGORY_ID`

**Status:** BLOCKED — env-owned credentials not provided in this session. Integration tests provide equivalent proof locally.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Clients relied on unpublished public ID reads | Matches visibility matrix; intentional |
| Duplicate POST returns 409 | Document: use PUT to publish/update |
| Private slug fix returns 404 for cross-owner reads | Intentional security fix |

## Rollback

Revert branch commits. No schema migration required.

## Not tested

- Live production API with disposable vendor credentials
- Frontend E2E in mosaic-biz-frontend-launch
- S3/Cloudinary upload during service create
- Booking/review flows after visibility fix

---

## PR history

| PR | Status |
|----|--------|
| [#108](https://github.com/Techware-Hut/mosaic-backend/pull/108) | **Merged** — core Model A contract |
| Verification branch PR | Opened from `fix/backend-service-publication-visibility-contract` — see current PR link in release notes |

---

## Deploy verdict

**Safe to deploy for frontend PR #186 validation** — after PR review merge, provided CI passes and post-deploy smoke (steps D/E/G in smoke matrix) confirms public visibility on the target API. Unit/integration tests alone do not replace runtime public visibility verification.
