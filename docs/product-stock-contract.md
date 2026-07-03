# Product Stock Contract

Status: release-readiness sweep for vendor inventory, July 3, 2026.

This document records the backend contract used by the vendor inventory dashboard. It is intentionally scoped to product variant stock and does not change checkout, Stripe, payouts, subscriptions, or webhook behavior.

## Source of Truth

- `ProductVariant.stock` is the authoritative stock field for vendor product inventory.
- Legacy callers may still send stock inside the first `sizes[]` row. Product create/update paths normalize that fallback into top-level variant stock for backward compatibility.
- Product-level stock values are derived summaries only. The backend now exposes aggregate stock metadata so frontend screens do not have to infer inventory state from stale nested size data.
- Negative stock is invalid. Stock decrement operations that would go below zero are rejected.

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

Manual release smoke should still verify:

1. A vendor can create a product variant with stock.
2. The inventory page displays that stock.
3. The vendor can set stock to `0` and see the row as out of stock.
4. The vendor can increase stock and see the row leave the out-of-stock filter.
5. The public product detail/cart behavior remains unchanged except for existing backend stock validation.

## Limitations

- This contract covers product inventory only. Service and food listing availability are separate flows.
- This pass does not alter checkout stock reservation, Stripe payment, payout, subscription, or webhook logic.
- Public cart and paid checkout behavior require separate staging smoke with approved test accounts.
