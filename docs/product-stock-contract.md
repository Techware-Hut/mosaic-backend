# Product Stock Contract

Status: release-readiness sweep for vendor inventory, July 3, 2026.

This document records the backend contract used by the vendor inventory dashboard and paid-order inventory decrement.

## Source of Truth

- `ProductVariant.stock` is the authoritative stock field for vendor product inventory.
- Legacy callers may still send stock inside the first `sizes[]` row. Product create/update paths normalize that fallback into top-level variant stock for backward compatibility.
- Product-level stock values are derived summaries only. The backend now exposes aggregate stock metadata so frontend screens do not have to infer inventory state from stale nested size data.
- Negative stock is invalid for vendor stock edits. Checkout atomically reserves
  available `ProductVariant.stock` before returning a PaymentIntent client
  secret, so concurrent non-backorder buyers cannot oversell the final unit.
- Payment success finalizes the existing reservation without decrementing a
  second time. Failed/cancelled PaymentIntents release the reservation exactly
  once; the retryable failed intent is cancelled before stock is released.
- A failed event that loses the Stripe cancellation race to `succeeded` is
  reconciled through the existing success path. Stale failed/canceled events
  cannot overwrite an order that is already paid or inventory-finalized.
- Multi-line reserve, legacy paid-time decrement, release, and paid-order
  restore run in MongoDB transactions so a failure on any line rolls the whole
  inventory mutation back.
- Automated abandoned-reservation expiry is disabled by default until product
  approves a TTL. The current operational proposal is 30 minutes. When enabled,
  the worker cancels the PaymentIntent before releasing stock; if Stripe already
  reports a successful payment, it finalizes the reservation instead. Enable it
  explicitly with `ENABLE_INVENTORY_RESERVATION_EXPIRY=true`; the proposed TTL,
  schedule, and batch size are configurable with
  `INVENTORY_RESERVATION_TTL_MINUTES`, `INVENTORY_RESERVATION_EXPIRY_CRON`, and
  `INVENTORY_RESERVATION_EXPIRY_BATCH_LIMIT`.
- Cancel-before-release favors inventory integrity and stale-client-secret
  safety over retrying the same PaymentIntent. The shopper may need to restart
  checkout; changing that tradeoff requires written product approval.

## Route Matrix

| Purpose | Method | Route | Auth | Request contract | Response contract |
| --- | --- | --- | --- | --- | --- |
| Vendor product inventory | GET | `/api/private/products/list` | `authenticate`, `isBusinessOwner` | Query supports `businessId`, pagination, filters, and `outOfStock=true` | Grouped product rows with `variants[]`, `totalStock`, `stockStatus`, `stockSummary`, and `lowStockThreshold` |
| Vendor products by business | GET | `/api/product/business/:businessId` | `authenticate`, `isBusinessOwner` | Path `businessId` owned by current vendor | Products with `variants[]`, `variantCount`, `totalStock`, `stockStatus`, `stockSummary`, and `lowStockThreshold` |
| Create product with variants | POST | `/api/product/` | `authenticate`, `isBusinessOwner` | Variants may send top-level `sku`, `stock`, `price`, `salePrice`, `attributes`; legacy `sizes[0]` fallback is accepted | Product and variant records using normalized top-level stock |
| Add variants | POST | `/api/product/add-variants/:productId` | `authenticate`, `isBusinessOwner` | Same normalized variant payload as product create | Created variants using normalized top-level stock |
| Get variant | GET | `/api/product/get-variant/:productId/:variantId` | `authenticate`, `isBusinessOwner` | Product and variant ids must belong to current vendor | Variant record, preserving existing fields |
| Edit variant | PUT | `/api/product/update-variant/:productId/:variantId` | `authenticate`, `isBusinessOwner` | Same normalized variant payload; owner is checked before save | Updated variant record, preserving existing fields |
| Quick stock update | PATCH | `/api/product/update-variantstock/:variantId` | `authenticate`, `isBusinessOwner` | `{ "operation": "set" | "increment" | "decrement", "stock": number }` | `{ success, message, stock }` with updated numeric stock |

## Stock Status Rules

The current backend response uses these normalized statuses:

| Status | Rule |
| --- | --- |
| `out_of_stock` | Total derived stock is `0` |
| `low_stock` | Total derived stock is greater than `0` and less than or equal to `lowStockThreshold` |
| `in_stock` | Total derived stock is greater than `lowStockThreshold` |

The current `lowStockThreshold` is `5`.

## Failure Behavior

- Invalid stock values return a client error instead of silently saving malformed inventory.
- Vendor ownership is checked before variant edits and stock updates.
- The private product list can filter stock issue rows with `outOfStock=true`.
- Existing response fields remain in place for backward compatibility.

## Verification

Automated coverage includes:

- zero-stock, low-stock, and in-stock status derivation
- quick stock set/increment/decrement
- decrement rejection below zero
- top-level stock normalization
- legacy `sizes[0]` stock fallback
- vendor private product list stock metadata
- concurrent final-unit reservation and legacy paid-time fallback
- multi-line rollback on reservation/release failure
- webhook/retrieve replay and idempotent paid-order restoration
- stale failed/canceled delivery after success and cancellation-lost-to-success
  reconciliation

Manual release smoke should still verify:

1. A vendor can create a product variant with stock.
2. The inventory page displays that stock.
3. The vendor can set stock to `0` and see the row as out of stock.
4. The vendor can increase stock and see the row leave the out-of-stock filter.
5. The public product detail/cart behavior remains unchanged except for existing backend stock validation.

## Limitations

- This contract covers product inventory only. Service and food listing availability are separate flows.
- Paid checkout reserves `ProductVariant.stock` once via
  `inventoryReservedAt`, then converts that marker to
  `inventoryDecrementedAt` when Stripe reports payment success. Duplicate
  webhook/poll reconciliation is idempotent, and vendor order accept does not
  decrement again.
- `inventoryAdjustments` records the exact on-hand amount changed so releasing
  a partial/zero-stock backorder cannot manufacture stock.
- The inventory mutation path requires MongoDB transaction support (a replica
  set or sharded cluster). Production capability was proven read-only against a
  three-member `ReplicaSetWithPrimary`, including a committed snapshot
  transaction and exact live-data correlation. See
  [`inventory-reservation-operations.md`](inventory-reservation-operations.md).
- Guest cart merge and cart add/update prefer top-level `ProductVariant.stock` over legacy nested `sizes[].stock`.
- Public cart and paid checkout behavior should be smoke-tested on staging with approved test accounts after inventory changes.

## Rollback Safety

Do not revert the reservation-aware code while orders still have
`inventoryReservedAt` set. The pre-hotfix payment-success path does not
understand reservations and would decrement those orders a second time.

Before rollback, stop or gate new checkout initiation, reconcile every active
reservation against its Stripe PaymentIntent, finalize succeeded intents,
cancel retryable intents before releasing their stock, and verify there are no
remaining reservation markers. Code rollback is safe only after that drain;
the schema additions themselves can remain because they are backward
compatible.

The abandoned-reservation procedure, Stripe decision matrix, rolling-deploy
checkout gate, per-instance version requirement, and legacy-stock audit are in
[`inventory-reservation-operations.md`](inventory-reservation-operations.md).
