# Inventory Reservation Operations Runbook

This runbook applies to the reservation-aware checkout implementation in PR
#262. It does not authorize a production deploy or a direct database mutation.

## Product tradeoff

A `payment_intent.payment_failed` event normally represents a retryable Stripe
PaymentIntent. The current design cancels that intent before releasing its
inventory reservation. This deliberately favors inventory integrity and
stale-client-secret safety over allowing the shopper to retry the same
PaymentIntent. The shopper may need to restart checkout. Do not change that
behavior without written product approval.

## Automatic expiry is disabled

`ENABLE_INVENTORY_RESERVATION_EXPIRY` is disabled by default. Until a TTL is
approved and the worker is explicitly enabled, operations must inspect and
reconcile aged reservations. The current 30-minute value is a proposal, not an
approved product rule.

Use a read-only query with an operations-approved cutoff:

```javascript
db.orders.find(
  {
    inventoryReservedAt: { $ne: null, $lt: ISODate("<approved-cutoff>") },
    inventoryDecrementedAt: null,
    inventoryRestoredAt: null
  },
  {
    _id: 1,
    paymentId: 1,
    paymentStatus: 1,
    status: 1,
    inventoryReservedAt: 1,
    inventoryAdjustments: 1
  }
).sort({ inventoryReservedAt: 1 })
```

Do not use a cutoff by habit. Record the chosen cutoff, query time, order IDs,
and operator in the release evidence.

## Manual reconciliation

For each aged reservation:

1. Retrieve the PaymentIntent from Stripe using `paymentId`. Do not infer its
   state from the order alone.
2. If Stripe reports `succeeded`, use the canonical signed
   `payment_intent.succeeded` webhook/replay path. It marks the order paid and
   finalizes the existing reservation idempotently without another stock
   decrement.
3. If Stripe reports `canceled`, use the canonical canceled-event path to
   release the reservation exactly once.
4. If Stripe reports a retryable state, cancel it in Stripe first. Retrieve it
   again and release inventory only after Stripe confirms `canceled`.
5. If cancellation loses a race and the retrieved state is `succeeded`, run
   the canonical success reconciliation. Never release that reservation.
6. If Stripe is unavailable, retrieval fails, the status is unfamiliar, or
   the state is otherwise uncertain, leave the reservation intact and
   escalate. Never release inventory on an assumption.
7. Re-read the order after reconciliation. A success must have
   `paymentStatus=paid` and `inventoryDecrementedAt` set with no active
   `inventoryReservedAt`. A release must have `inventoryRestoredAt` set with no
   active `inventoryReservedAt`.
8. Re-run the aged-reservation query and retain the before/after counts and
   Stripe evidence.

Do not manually edit stock or reservation markers. Use the existing
transactional reconciliation paths so multi-line updates remain atomic.

## Production deployment from the old implementation

The implementation deployed by PR #260 does not understand
`inventoryReservedAt`. A reservation created by new code must never have its
success event handled by an old instance.

Production topology evidence supplied by the release owner on 2026-08-07 shows
an ALB-backed Elastic Beanstalk environment with Auto Scaling Min=1, Max=1,
exactly one current instance/target, and an AllAtOnce deployment policy. That
topology does not create a simultaneous multi-instance old/new serving window,
but a request can still be in flight on the old code and the single target can
be unavailable during deployment. The checkout gate and drain therefore remain
mandatory. If instance count, Max capacity, target count, or deployment policy
differs at release time, stop and reassess.

Follow `docs/release/CHECKOUT_GATE_OPERATIONS.md`. The inventory-specific safety
sequence is:

1. At the load balancer/WAF/maintenance layer, temporarily return `503` for
   authenticated `POST /api/orders/initiate` only. Keep both Stripe webhook
   endpoints reachable.
2. Wait at least the maximum application request timeout and confirm there are
   no in-flight checkout-initiation requests.
3. Confirm no `inventoryReservedAt` marker was created after the gate time.
4. Start the deployment. Do not reopen checkout during the single-instance
   deployment/recovery interval.
5. In Elastic Beanstalk, verify every serving instance reports the new
   application version. Repeated `/api/build-info` probes are supporting
   evidence but do not replace the per-instance/version check.
6. Verify health/readiness and the signed Stripe webhook endpoints while the
   checkout gate remains active.
7. Re-run the active-reservation query. Reconcile any unexpected marker before
   proceeding.
8. Remove the checkout-initiation gate only after no old #260 instance can
   receive traffic.

If the infrastructure owner cannot provide this gate and per-instance version
proof, deployment is blocked. Do not assume rolling-drain behavior is safe.

## Rollback

Never revert to the pre-reservation implementation while any order has an
active `inventoryReservedAt` marker. Before rollback:

1. Gate `POST /api/orders/initiate` while leaving webhooks available.
2. Reconcile every active reservation with Stripe using the procedure above.
3. Finalize every succeeded PaymentIntent.
4. Cancel every retryable PaymentIntent and confirm `canceled` before release.
5. Leave uncertain states reserved and resolve them before continuing.
6. Prove the active-reservation count is zero.
7. Only then roll back code. The additive schema fields may remain.

## Production topology evidence

The production data source was checked read-only on 2026-08-07. Proven facts:

- `ReplicaSetWithPrimary`
- writable primary
- three replica-set members
- logical sessions enabled
- modern wire version
- a read-only snapshot transaction committed
- exact public product/variant data matched the live production API
- zero production inventory writes

The Elastic Beanstalk `MONGODB_URI` value was not read: the available IAM
principal was denied `elasticbeanstalk:DescribeConfigurationSettings`.
`retryWrites=true&w=majority` was observed on the tested connection URI, not
directly retrieved from the EB environment. The topology and committed
read-only transaction are the transaction-capability proof.

## Legacy stock audit

Read-only production audit at `2026-08-07T07:46:17Z`:

- total `ProductVariant` records: 22
- variants with one or more positive legacy `sizes[].stock` rows: 0
- variants with positive legacy size stock and missing, null, nonnumeric,
  nonfinite, or negative top-level `stock`: 0
- affected published variants: 0
- affected currently public products: 0
- production writes performed: 0

The legacy top-level-stock concern is closed for the audited production data.
