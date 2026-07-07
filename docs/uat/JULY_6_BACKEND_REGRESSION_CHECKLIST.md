# July 6 Backend Regression Checklist

> **Conformance audit update (2026-07-07):** test counts below are stale; at production `main` (`ad9ddd14`) the suites pass 529 unit / 74 integration / 20 contract. Current tester steps: [`docs/uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md`](JULY_6_PRODUCTION_UAT_CHECKLIST.md).

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

Define safe backend verification for the July 6 UAT audit and the next implementation branches. This checklist does not require production credentials and does not print environment variable values.

## Source Of Truth Assumptions

- Run commands from the backend repo root.
- Do not run `smoke:backend` unless a local server is already running and configured for safe smoke credentials.
- Do not modify Stripe webhook registration or middleware order while running this checklist.

## Files Inspected

`package.json`, `scripts/run-unit-tests.js`, backend route/controller/test files listed in the route and gap audit docs.

## Safe Commands

| Command | When to run | Expected result |
| --- | --- | --- |
| `npm test` | Every backend docs or code PR before push | Unit/contract suite exits 0. |
| `npm run test:integration` | When available before push | Integration suite exits 0 or documented environment skip. |
| `npm run test:contract` | When route contract changed | Contract suite exits 0. |
| `npm run smoke:backend` | Only when local server is already running | Smoke passes without production credentials. |
| `git status --short --branch` | Before staging and after commit | Only intended docs or code changes are present. |

## Verification Results For This Branch

| Command | Result | Notes |
| --- | --- | --- |
| `npm test` | Passed | 522 tests passed. |
| `npm run test:integration` | Passed | 72 integration tests passed. Provider failures in output are expected stub assertions and did not fail the suite. |
| `npm run test:contract` | Passed | 20 launch contract tests passed, including canonical `GET /api/featured-products` and Stripe raw-body mount order. |
| `npm run smoke:backend` | Not run | This docs-only pass did not start a local backend server, so smoke was skipped per audit instructions. |

## Manual Smoke Checklist

| Flow | Steps | Expected result | Evidence |
| --- | --- | --- | --- |
| Cart quantity | Add product, reduce quantity, remove item. | Backend returns updated cart and totals. | Screenshot plus response log without secrets. |
| Coupon under minimum | Apply coupon below `minOrderAmount`. | Backend rejects with safe message. | Screenshot plus response status. |
| Coupon valid | Apply coupon at or above minimum. | Backend returns discount and discounted subtotal. | Screenshot plus response status. |
| Checkout total | Initiate order using cart total. | Backend recomputes and accepts only matching total. | Order id/test result. |
| Local shipping | Vendor and customer same state, local rate enabled. | Local speed visible and accepted after contract fix. | Screenshot and response. |
| Service features | Create service with features, edit it, fetch detail. | Features persist. | API response and UI screenshot. |
| PDF upload | Upload PDF and JPEG vendor docs. | Both succeed and S3 object content type is safe. | Upload response and admin view screenshot. |
| Shipment email | Ship accepted order with tracking URL. | Customer email includes tracking link; lifecycle log records sent/skipped/failed. | Email provider evidence and DB-safe log excerpt. |
| Admin statuses | Query submitted, rejected, verified applications. | Admin can filter and open details. | Screenshots. |

## Regression Assertions

- `GET /api/featured-products` remains registered.
- `/api/products/featured` is not introduced as the new featured product route.
- Cart and order totals come from backend calculations, not frontend-only math.
- Coupon validation uses backend subtotal basis unless product approves a different rule.
- Stripe webhook routes remain before JSON body parsing in `app.js`.
- No `.env` values are committed or printed in evidence.

## Acceptance Criteria

- All safe commands either pass or have a documented unrelated/environment reason.
- Every P0/P1 fix PR includes at least one automated test or a clear explanation for manual-only verification.
- Hosted smoke evidence is attached for email and upload issues before launch signoff.

## Evidence Needed

- Command logs from this branch.
- Hosted runtime PDF upload and shipment email proof.
- Fresh admin application review smoke after status API work.

## Open Decisions

- Whether local delivery is state-based or zone-based.
- Whether service/food vendors can publish without Connect.
- Whether finalize means live approval or pre-approval readiness.

## Next Recommended Work Order

1. Run this checklist on the documentation PR.
2. Re-run the relevant sections on each implementation PR.
3. Add UAT screenshots to the frontend evidence directory and backend smoke logs to docs only.
