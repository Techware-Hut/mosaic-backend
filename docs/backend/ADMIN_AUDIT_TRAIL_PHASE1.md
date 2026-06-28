# Admin audit trail — Phase 1

**Issue:** #169 (Wave 7) · **Parent:** #162  
**Branch:** `feat/backend-admin-audit-trail-phase1`

**Current backend issue:** #153

## Scope

Immutable MongoDB audit events for launch-critical admin/moderation actions. No changes to business approval authority or payment behavior.

## Pre-audit findings

No existing `AuditLog`, `ActionLog`, or admin activity model was found. Request IDs were partially used (`x-request-id` in vendor onboarding emails only). Phase 1 adds global `requestIdMiddleware` and centralized audit storage.

## Action registry

| Action code | Trigger |
|-------------|---------|
| `vendor.application.verify_item` | `POST .../verify` — document/channel verification |
| `vendor.application.finalize_approved` | `POST .../finalize` — approved |
| `vendor.application.finalize_rejected` | `POST .../finalize` — rejected |
| `vendor.application.finalize_failed` | Finalize blocked (not found / wrong status) |
| `user.block` / `user.unblock` | `PUT /admin/users/:id/block` |
| `user.soft_delete` | `DELETE /admin/users/:id` |
| `business.approve` / `business.disapprove` | `POST /admin/api/business/approve/:id` |
| `business.activate` / `business.deactivate` | `PATCH /admin/api/business/status/:id` |
| `product.feature` / `product.unfeature` | `PATCH /admin/api/products/:id/featured` |
| `category.create` / `update` / `delete` | Product category admin CRUD |
| `category_request.approve` / `reject` | Category request moderation |
| `subscription_plan.create` / `update` | Subscription plan admin mutations |

**Not in scope (absent in codebase):** admin order overrides, admin refund actions.

## Schema (`AdminAuditEvent`)

| Field | Description |
|-------|-------------|
| `eventId` | UUID (unique) |
| `createdAt` | Timestamp (immutable; no `updatedAt`) |
| `actorUserId` | Admin user ObjectId |
| `actorRole` | e.g. `admin` |
| `actionCode` | Registry code |
| `targetType` | e.g. `user`, `business` |
| `targetId` | String ID |
| `changeSummary` | Sanitized `{ fields, before, after }` |
| `requestId` | From `X-Request-Id` or generated |
| `outcome` | `success` \| `failure` |
| `note` | Optional reason (max 500 chars stored) |

Records are **insert-only**. Mongoose pre-hooks block update/delete mutations.

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/admin/api/audit-events` | admin | Paginated list (filtered) |
| `GET` | `/admin/api/audit-events/:eventId` | admin | Single event |

No create/update/delete HTTP APIs for audit records.

## Redaction policy (`utils/audit/redaction.js`)

**Never persisted:** passwords, OTPs, tokens, cookies, Stripe keys, bank/routing data, EIN/tax IDs, document URLs/content, raw request bodies, credentials.

Field names matching sensitive patterns are excluded from `changeSummary.fields`; values are replaced with `[REDACTED]`. Long strings truncated to 120 chars.

## Failure behavior

**Decision:** Audit write failure does **not** block the primary admin action.

Rationale: Blocking could leave admins retrying destructive toggles (double block/unblock). On storage failure the service logs `[admin-audit] storage failure`, emits Sentry alert when enabled, and returns `{ recorded: false }`.

Failed **authorization** or validation paths record `outcome: failure` when the handler reaches an explicit audit call before returning 4xx.

## Retention (decision still needed)

- No TTL index or archival job in Phase 1.
- Recommend: 24-month hot retention in MongoDB, then cold archive — **client/legal decision pending**.

## Rollback

1. Revert branch — admin actions continue without audit side effects.
2. `AdminAuditEvent` collection can remain (read-only) or be dropped without affecting core flows.
3. Remove `requestIdMiddleware` from `app.js` if rollback must strip response header (optional).

## Risks

- Audit calls add one Mongo insert per sensitive action (latency under load).
- `updateUserByAdmin` is not yet audited (broad body merge — needs field allowlist before audit).
- Service/food category CRUD not wired in Phase 1 (product category + category requests + subscription plans covered).

## Verification

```bash
npm test
npm run test:contract
npm run test:integration
```
