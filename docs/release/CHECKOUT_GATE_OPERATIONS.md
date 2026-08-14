# Checkout gate operations

This runbook covers the Mosaic Production checkout cutover. Normal releases are
automated by `Mosaic Production Release`; manual commands remain only for
break-glass diagnosis and recovery. This document does not authorize a merge,
Production approval, infrastructure change, payment, or database mutation.

Complete the one-time ALB, OIDC, SSM, GitHub Environment, and drain setup in
`RELEASE_CONTROL_INFRASTRUCTURE_SETUP.md` before the first automated release.
Committing the workflow does not provision or enable a live gate.

## Normal automated sequence

A canonical `staging` to `main` merge starts exact-SHA tests and read-only
preflight automatically. Nothing mutates Production before a green
`READY FOR PRODUCTION APPROVAL` state and approval of the protected `production`
Environment.

After that one approval, the serialized job:

1. Rechecks current `main` and the one-instance/Max=1/AllAtOnce topology.
2. Enables the two pre-provisioned HTTP/80 and HTTPS/443 rules.
3. Proves checkout is `503`, all five Stripe webhook paths still reach
   application invalid-signature rejection (`400`), and health/readiness/build
   surfaces remain `200` on both public protocols.
4. Validates and waits the approved drain period, then repeats the gate proof.
5. Runs the pinned SSM count-only reservation proof and requires zero.
6. Deploys `mosaic-<full-main-sha>` from the exact approved checkout.
7. Proves every EB instance version/status, EB health, ALB targets, build
   identity, auth guard, CORS, and canonical featured-products endpoint while
   checkout remains gated.
8. Runs the same reservation proof again and requires zero.
9. Disables both rules and proves normal unauthenticated checkout behavior (for
   example `401`, never `503`), exact release identity, health, readiness, and
   webhook reachability.
10. Uploads sanitized release evidence and comments a concise result on the
    source release PR.

Production releases share concurrency group `mosaic-production-release` with
`cancel-in-progress: false`. A newer commit waits; it does not cancel an active
gate or EB deployment.

## Exact gate contract

The controller accepts exactly two pinned, tagged, non-default ALB listener
rules: one on HTTP/80 and one on HTTPS/443. Each rule always has:

- HTTP method condition exactly `POST`;
- one exact anchored case/trailing-slash-safe regex for the Express-equivalent
  `/api/orders/initiate` spellings while active, or the pinned exact disabled
  sentinel while inactive; and
- one fixed response action with status `503`.

It rejects unapproved regexes, wildcards, prefixes, extra conditions/actions, altered priority,
missing ownership tag, cross-ALB identity, unexpected default rules, duplicate
canonical rules, or disagreement between listeners. The workflow never creates
or deletes a rule. Activation and deactivation modify only each pinned rule's
path condition.

The active regex is:

```text
^/[aA][pP][iI]/[oO][rR][dD][eE][rR][sS]/[iI][nN][iI][tT][iI][aA][tT][eE]/?$
```

This is necessary because ALB value paths are case-sensitive and the existing
Express route accepts mixed case and one trailing slash. It remains anchored to
the single logical checkout-initiation endpoint; the status-only verifier probes
representative aliases on HTTP and HTTPS.

The following routes are never part of the rule:

- `/api/webhooks/stripe`
- `/api/stripe/webhook`
- `/api/stripe/payment/webhook`
- `/api/subscription/webhook`
- `/api/vendor-onboarding/webhook/payment`
- `/api/health`
- `/api/ready`
- `/api/build-info`

There is no atomic AWS update across two listeners. The controller enables HTTPS
first and disables HTTPS last to minimize the canonical-surface window. Any
failed transition best-effort reasserts active state on both rules and fails.
The workflow also attempts fail-safe reactivation after any later failure.

## Drain contract

`CHECKOUT_DRAIN_SECONDS` must be strictly greater than both the live ALB idle
timeout and the approved `CHECKOUT_MAX_REQUEST_SECONDS`. The workflow validates
these values before approval and again before the wait; it does not use an
unreviewed sleep. Re-approve the values whenever the ALB, proxy, server, worker,
or checkout request timeout changes.

The second public gate proof after the wait shows new initiation requests remain
blocked. Time-based drain is still required until a separately reviewed,
PII-safe log proof can establish there are no in-flight initiation requests.

## Reservation proof

The production job never receives `MONGODB_URI`. It invokes only the pinned,
parameterless custom SSM document `MosaicReadOnlyReservationCheck` on the one
exact online Linux EB instance. The document obtains the credential locally,
runs one fixed majority-read aggregation that computes all three counts from the
same MongoDB operation, and emits only:

```json
{"activeReservationCount":0,"incompletePaidOrderCount":0,"unresolvedPaymentIntentCount":0}
```

The runner rejects extra fields, multiline output, stderr, a changed document
name/version/hash, an arbitrary target, and any nonzero count. The counts cover
active inventory reservations, paid orders whose post-payment email work lacks
its aggregate terminal marker, and every non-paid order that still references
an issued PaymentIntent. A nonzero pre- or post-deploy result means:

```text
BLOCKED — HUMAN RECONCILIATION REQUIRED
```

Keep the gate active and follow `docs/inventory-reservation-operations.md`.
Never add automatic reconciliation or direct inventory/order edits.

## Stop and failure states

Stop and keep or restore checkout gated if:

- checkout is not `503` on both public protocols before deployment;
- a Stripe webhook is gated or does not reach signature validation;
- the approved drain is invalid or cannot complete;
- the SSM document/instance proof is unavailable or reservations are nonzero;
- the exact release SHA, source certificate, or current-main identity disagrees;
- topology is not one instance, Min=Max=Desired=1, AllAtOnce, rolling disabled,
  with one healthy target;
- Enhanced Health or `DescribeInstancesHealth` is unavailable;
- EB running version, per-instance deployment data, build-info, or requested SHA
  disagree;
- health, readiness, auth, CORS, featured products, or target checks fail; or
- ungating or final public proof fails.

Do not infer gate state from a cancelled workflow. Verify the two exact pinned
rules and both public protocols. If verification is unavailable, treat the gate
as active and checkout as closed until proven otherwise.

## Break-glass commands

Manual operation is for recovery by an authorized infrastructure owner, not the
happy path. Work only from the exact reviewed repository commit and a principal
restricted to the pinned resources. Do not print environment variables or use
shell tracing.

Inspect without mutation:

```bash
node scripts/release/manage-checkout-gate.js verify \
  --expected-state active \
  --output release-evidence/manual-gate-state.json

bash scripts/release/verify-checkout-gate.sh \
  https://api.mosaicbizhub.com \
  http://api.mosaicbizhub.com
```

Reassert the safe active gate after a failed release:

```bash
node scripts/release/manage-checkout-gate.js enable \
  --confirm ENABLE_CHECKOUT_GATE \
  --output release-evidence/manual-gate-enabled.json
```

Disable only after exact version/health/target proof and both reservation checks
are zero:

```bash
node scripts/release/manage-checkout-gate.js disable \
  --confirm DISABLE_CHECKOUT_GATE \
  --output release-evidence/manual-gate-disabled.json

bash scripts/release/verify-checkout-gate.sh --state inactive \
  https://api.mosaicbizhub.com \
  http://api.mosaicbizhub.com
```

The controller reads the full ALB/rule identities from protected environment
variables described in the setup guide. Never paste those identities, AWS
credentials, SSM output, database URIs, response bodies, or customer data into
issues, PRs, workflow summaries, or evidence artifacts.

## Rollback

Use the production workflow's `rollback` dispatch with one full SHA that is an
approved ancestor of `main` and the exact phrase
`BREAK GLASS ROLLBACK EXACT SHA`. Rollback still requires preflight, the one
Production approval, gate, drain, zero reservations, exact deployment proof,
post-deploy zero, and verified ungate.

The trusted current-main controller downloads the historical EB source bundle,
rejects unsafe/duplicate/extra members, and compares every packaged file byte
for byte with the rollback Git tree under the reviewed legacy packaging policy.
An embedded manifest alone is never accepted as rollback authenticity.

Before checkout is reopened, keep the gate active and redeploy the known-good
version. After checkout was reopened, restore the gate and drain first. Never
roll back across reservation semantics while any active marker exists; reconcile
with Stripe and prove zero before deployment. If payment state is uncertain,
leave inventory reserved and checkout gated.
