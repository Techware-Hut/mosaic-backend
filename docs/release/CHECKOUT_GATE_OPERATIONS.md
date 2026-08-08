# Checkout Gate Operations

This runbook controls production promotion of reservation-aware checkout code. It does not authorize a merge, deployment, infrastructure change, payment, or database mutation. The release owner and infrastructure owner must execute and retain the evidence for every step.

## Enforced repository behavior

- A push or merge to `main` runs the production workflow's tests but cannot run the `deploy` job.
- Production mutation requires a manual `workflow_dispatch` with a full 40-character `release_sha`.
- The workflow rejects a SHA that is missing, abbreviated, unknown, or not reachable from `origin/main`.
- The exact validated commit is tested, packaged, labeled `mosaic-<full-release-sha>`, and deployed.
- Before packaging or AWS deployment mutation, the workflow independently verifies the external checkout gate.
- After Elastic Beanstalk reports recovery, the workflow requires every enhanced-health instance record to report the expected version and `Deployed` status before public probes run.

The workflow does not create or remove the ALB/WAF gate. Those infrastructure changes remain operator-owned.

## Required infrastructure readiness

Before scheduling promotion, prove all of the following:

1. A route-specific ALB/WAF rule can return `503` only when both the method is `POST` and the path is exactly `/api/orders/initiate`.
2. The rule excludes all mounted Stripe webhook paths:
   - `/api/webhooks/stripe`
   - `/api/stripe/webhook`
   - `/api/stripe/payment/webhook`
   - `/api/subscription/webhook`
   - `/api/vendor-onboarding/webhook/payment`
3. Elastic Beanstalk enhanced health is enabled for `mosaic-backend-env`.
4. The GitHub deploy role can call `elasticbeanstalk:DescribeInstancesHealth` for that environment.
5. The intended EB deployment policy and instance/target counts are recorded. The currently reported Max=1, one-instance, AllAtOnce topology has no simultaneous old/new multi-instance window, but checkout must still be gated and drained through the single-instance replacement/restart interval.
6. The operator has a safe read-only `MONGODB_URI` outside GitHub Actions for the active-reservation diagnostic.

## Minimum safe release sequence

1. Merge the approved integrated `staging` commit to `main` using the canonical staging-to-main promotion PR.
2. Record the resulting full `main` SHA and verify its normal CI checks are green.
3. Confirm that the push-triggered **Deploy to Elastic Beanstalk** run tested the SHA and its `deploy` job was skipped. No automatic production deployment should occur.
4. Immediately before gating, record:
   - current EB Running Version;
   - environment health and deployment policy;
   - Auto Scaling minimum, maximum, and current capacity;
   - every registered ALB target and its health.
5. The infrastructure owner enables the route-specific checkout gate: `POST /api/orders/initiate` returns fixed-response `503`.
6. Run `bash scripts/release/verify-checkout-gate.sh https://api.mosaicbizhub.com`. Retain its status-only output. It must prove checkout receives `503`, every invalid-signature webhook probe receives application HTTP `400`, and health/readiness/build-info receive `200`.
7. Record the gate activation timestamp.
8. Wait longer than both the maximum application request duration and the configured ALB connection/request drain interval. Confirm access/application logs show no checkout-initiation request remains in flight.
9. From an operator workstation with approved read-only production access, run:

   ```bash
   node scripts/release/query-active-reservations.js --report
   node scripts/release/query-active-reservations.js --require-zero
   ```

   Do not place `MONGODB_URI` in GitHub Actions. Stop unless the zero check passes. Reconcile any result using `docs/inventory-reservation-operations.md`; never edit orders or inventory directly.
10. In GitHub Actions, manually dispatch **Deploy to Elastic Beanstalk** from `main` with the exact full release SHA.
11. The workflow revalidates main ancestry and independently rechecks the external gate before any deployment mutation.
12. Keep the gate active while the workflow deploys Elastic Beanstalk.
13. Require the workflow's sanitized per-instance table to show every instance on `mosaic-<full-release-sha>` with status `Deployed`.
14. Require successful `/`, `/api/health`, `/api/ready`, `/api/build-info`, auth-guard, CORS, and `GET /api/featured-products` probes. Health and build-info release identity must match the exact version.
15. Reconfirm EB Running Version, environment health, Auto Scaling/target count, and every ALB target's health outside the workflow.
16. Run `query-active-reservations.js --report` and `--require-zero` again. Stop unless zero is proven.
17. The infrastructure owner removes the checkout gate.
18. Prove an unauthenticated `POST /api/orders/initiate` now reaches normal application behavior such as `401`, rather than the gate's `503`. Recheck health/readiness and unsigned webhook rejection.
19. Only then begin the separately approved controlled inventory/payment smoke.

## Gate verifier contract

`verify-checkout-gate.sh` is status-only and fail-closed:

- checkout initiation must return exactly `503`;
- all five actual mounted Stripe webhook paths must return exactly `400` to a harmless invalid signature and must never return the gate `503`;
- `/api/health`, `/api/ready`, and `/api/build-info` must return exactly `200`;
- network failures, timeouts, and unexpected statuses fail the preflight;
- response bodies, credentials, cookies, tokens, and signing secrets are not printed.

## Per-instance verifier contract

`verify-eb-instance-versions.sh <full-release-sha>` calls:

```bash
aws elasticbeanstalk describe-instances-health \
  --environment-name mosaic-backend-env \
  --region us-east-1 \
  --attribute-names Deployment \
  --output json
```

It fails if permission is denied, enhanced-health data is unavailable, the instance list is empty, an instance ID or deployment field is missing, a version differs from `mosaic-<full-release-sha>`, or a deployment status is anything other than `Deployed`. Output contains only an instance ID suffix, version label, deployment ID, and status.

## Active-reservation diagnostic contract

`query-active-reservations.js` executes only the documented read query:

```javascript
{
  inventoryReservedAt: { $ne: null },
  inventoryDecrementedAt: null,
  inventoryRestoredAt: null
}
```

`--report` reports the count and selected reconciliation fields. `--require-zero` uses the same read and exits unsuccessfully when the count is nonzero. The helper contains no update, insert, delete, inventory, Stripe, or reconciliation action.

## Stop conditions

Stop and keep checkout gated if any of these occurs:

- checkout does not return `503` before deployment;
- any Stripe webhook receives `503` or does not reach application signature validation;
- checkout cannot be drained;
- active reservations are present or their Stripe state is uncertain;
- the gate cannot be safely removed;
- the release SHA is not the approved full SHA reachable from `main`;
- AWS permission or enhanced-health data is unavailable;
- the EB instance list is empty or an instance reports missing, stale, in-progress, or failed deployment data;
- EB Running Version, build-info, instance data, target identity, or requested SHA disagree;
- health, readiness, auth, CORS, or featured-product probes fail;
- topology differs from the recorded release plan.

## Rollback

Before checkout is reopened, keep the gate active and redeploy a known-good full SHA that remains reachable from `main`. Prove every EB instance, public release identity, health/readiness check, and ALB target is on that rollback version before removing the gate.

After checkout has been reopened, first restore the gate and drain checkout. Never roll back to the pre-reservation implementation while any active `inventoryReservedAt` marker exists. Reconcile every reservation with Stripe using `docs/inventory-reservation-operations.md`, prove the active count is zero, and only then dispatch the known-good rollback SHA. If payment state is uncertain, leave inventory reserved and stop.
