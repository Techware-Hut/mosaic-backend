# Agentic release operations

This is the normal operating guide for `Techware-Hut/mosaic-backend`. The
pipeline automates deterministic mechanics; people approve code, production
risk, and business outcomes. A successful merge is not Production acceptance.
Every production run binds both its target SHA and executing workflow-definition
SHA to freshly fetched current `main`; obsolete reruns fail before approval or
AWS mutation.

The repository changes alone do not authorize a deployment. Complete the
one-time controls in `RELEASE_CONTROL_INFRASTRUCTURE_SETUP.md` before approving
the first `production-release-control` Environment job. The legacy `production`
Environment/role must be unable to deploy before this path is enabled. No local
AWS login is part of the normal path.

The read-only preflight also remains fail-closed until the legacy
`/api/payments/create-payment-intent` surface is retired and its outstanding
Stripe liabilities are reconciled under the documented checkout-surface
bootstrap prerequisite.

## Normal workflow

| Owner | Event or action | Result | Production mutation |
| --- | --- | --- | --- |
| Engineer or agent | Open a focused feature PR to `staging` | Normal review and `Test` CI | No |
| Human reviewer | Approve and merge the feature PR | Exact `staging` SHA becomes a candidate | No |
| CI/CD | Certify the exact staging push | Exact push CI, release-control tests, immutable artifact, stale-ref checks | No |
| CI/CD | Create or refresh the one canonical `staging` to `main` PR | Release body and risk/UAT evidence are updated; no auto-merge | No |
| Human reviewer | Review and merge the release PR | Exact `main` SHA starts Production preflight | No |
| CI/CD | Run exact-SHA tests, fresh target route-table proof, source-certificate proof, public probes, and read-only AWS preflight | `READY FOR PRODUCTION APPROVAL` when all checks pass | No |
| Production approver | Approve the protected `production-release-control` Environment once | The already-verified job may continue | Approval itself: no |
| CI/CD | Gate, drain, prove zero reservations, deploy exact SHA, verify, prove zero again, ungate | Production release and evidence packet | Yes, only after approval |
| Human or agent | Execute issue-specific business UAT | Payment, email, role journey, and mobile proof that infrastructure tests cannot provide | Business actions only |

The happy path has three human decisions: approve the feature PR, approve the
release PR, and approve Production. Do not manually dispatch a normal release,
create the release PR, run local AWS inspection, or copy a database credential
into GitHub.

## Exact staging certification

`Staging release certification` runs only on a canonical push to `staging` and
uses the event's full `github.sha`. It:

1. proves the event SHA is the current canonical staging ref;
2. waits for successful `CI` push results for that exact SHA, branch, workflow,
   event, and canonical repository;
3. runs the release-control test suite;
4. proves both staging and the main baseline remain unchanged;
5. generates `staging-certification-<full-sha>.json` without overwriting an
   existing record;
6. rechecks staging before artifact publication.

A separate `workflow_run` controller loaded from the trusted default branch then
validates the canonical trigger and artifact, runs candidate tests in a separate
unprivileged runner, re-requires exact-SHA CI, and rebuilds the manifest in a
fresh trusted runner. Only its final isolated job mints a narrowly scoped GitHub
App token to create, reuse, or refresh exactly one canonical promotion PR.
After that whole controller run succeeds, a separate trusted default-branch
`workflow_run` publisher mints a status-only token and publishes the App-owned
exact-SHA status bound to the completed controller run.
Candidate-controlled workflow or script code never runs with those credentials,
and no filesystem from the candidate-test runner crosses the boundary.

Staging runs use concurrency group `mosaic-staging-release` with stale work
cancelled. A cancelled or stale candidate cannot become eligible merely because
an older CI run passed. The PR automation never merges, enables auto-merge, or
uses a fork branch that happens to be named `staging`.

GitHub's PR metadata API has no compare-and-swap precondition on the head SHA.
If `staging` moves in the narrow interval between a ref check and a PR PATCH, a
stale controller can briefly update managed PR text before its post-write guard
fails. It cannot publish the App-owned status afterward, so the required exact-
SHA context remains absent and the PR cannot merge. The next controller for the
current staging SHA reconciles the managed text; audit this API limitation
rather than claiming stale runs can never touch PR metadata.

The managed PR section records the exact staging/main SHAs, commit and changed
file lists, discoverable source PR numbers, exact CI run, sensitive paths,
migration/schema signals, rollback guidance, production proof still required,
and generated UAT keys. Text outside the managed markers is preserved for human
release-owner notes. The body states **MERGE DOES NOT EQUAL PRODUCTION
ACCEPTANCE**.

## Production preflight and approval

A canonical release PR merge pushes an exact SHA to `main` and automatically
starts `Mosaic Production Release`. Before the approval boundary, parallel jobs:

- resolve the exact current-main SHA;
- run unit, contract, and integration tests from that exact checkout;
- prove the main commit came from one merged canonical `staging` to `main` PR,
  that its tree matches the certified staging tree, and that both the staging
  artifact and App-owned trusted-controller artifact/status still match exact
  CI and the pre-merge main baseline;
- probe health, readiness, build identity, authentication, featured products,
  CORS, checkout behavior, and all mounted Stripe webhook paths without a valid
  signature, while also requiring the exact release target to omit the legacy
  payment-intent route and live Production to match the separately attested
  legacy-route retirement/reconciliation prerequisite;
- assume the `production-preflight` read-only OIDC role; and
- verify the exact EB application/environment, Ready/Green/Ok state, Enhanced
  Health, `DescribeInstancesHealth`, running version, deployment policy, rolling
  policy, instance/ASG Min-Max-Desired counts, listeners, ALB idle timeout, and
  target health.

The preflight also validates that the approved checkout drain exceeds both the
live ALB idle timeout and approved maximum application request duration. It does
not modify AWS, the database, checkout, or Production.

Only a green preflight reports `READY FOR PRODUCTION APPROVAL`. The following
job references the protected `production-release-control` Environment and waits
for its one required reviewer. After approval it rechecks both the target SHA
and executing workflow-definition SHA against current `main`. A newer main
commit makes the approval stale and stops before mutation.

## Automated cutover after approval

The approved job is serialized by `mosaic-production-release` with
`cancel-in-progress: false`; a newer commit cannot cancel a cutover halfway.
The sequence is fixed:

1. Assume the production OIDC role and revalidate topology.
2. Enable both pinned HTTP/80 and HTTPS/443 checkout rules.
3. Externally prove `POST /api/orders/initiate` is `503` on both surfaces while
   health/readiness/build-info remain available and all Stripe webhook paths
   reach application signature rejection.
4. Validate and wait the approved drain, then re-run the gate proof.
5. Invoke the pinned, parameterless SSM release-blocker document on the one
   exact EB instance and require `activeReservationCount=0`,
   `incompletePaidOrderCount=0`, and `unresolvedPaymentIntentCount=0`.
6. Refresh the short-lived OIDC session, package the exact approved commit as
   `mosaic-<full-sha>`, and update only the configured EB environment.
7. Prove every enhanced-health instance is `Deployed` on the exact version,
   EB/ASG/ALB topology is still safe, every target is healthy, and public
   identity/probes match the SHA while checkout remains gated.
8. Re-run the same count-only reservation proof and require zero.
9. Disable both pinned gate rules.
10. Prove normal unauthenticated checkout behavior is restored (for example
    `401`, never the release `503`), the rules are inactive, webhook signature
    rejection still works, and health/readiness/build identity remain exact.
11. Upload the sanitized evidence packet and update the source release PR with a
    concise result.

The current workflow passes `mixed-version-safe=false` to every topology check.
One instance, Max=1, Desired=1, AllAtOnce, rolling disabled, and one healthy
target are required. Any multi-instance or rolling topology stops before gate
mutation. The declaration schema provides reviewed metadata for a future
mixed-version-compatible release, but the production workflow deliberately does
not consume `true` yet. Enabling that path requires an independently reviewed
workflow change; a declaration alone cannot bypass the stop.

## Fail-closed behavior

| Failure point | Expected checkout state | Production mutated | Required next action |
| --- | --- | --- | --- |
| Certification, source proof, CI, public preflight, or AWS preflight | Not touched | No | Fix the exact failing prerequisite; use only the current canonical SHA |
| Production approval becomes stale | Not touched | No | Let the new main SHA complete its own preflight and approval |
| Gate enable or verification | Active where transition was attempted; controller best-effort reasserts both rules active | No EB deployment | Treat as P0, verify both listeners, keep checkout closed |
| Drain or pre-deploy reservations | Active | No EB deployment | If count is nonzero, perform human Stripe reconciliation; otherwise fix the failed proof |
| EB deployment or post-deploy verification | Active | Yes or possibly partial | Keep gate active; redeploy or use break-glass rollback after exact topology review |
| Post-deploy reservations | Active | Yes | `BLOCKED — HUMAN RECONCILIATION REQUIRED`; reconcile with Stripe before any ungate |
| Ungate or final public proof | Controller attempts to restore active gate | Yes | P0; verify both rules and do not claim checkout restored |

After any gate attempt, the workflow runs a fail-safe enable step on later
failure. Never infer gate state solely from a red or cancelled job: inspect the
sanitized evidence and verify both public surfaces. If GitHub or AWS is
unavailable, choose the safer active-gate state.

The evidence summary reports the release SHA, failing phase, whether Production
was mutated, observed gate state, current version when known, reservation counts
when known, rollback requirement, and exact next action. Raw credentials,
database URIs, SSM command output, ARNs, full instance IDs, response bodies, and
PII are excluded.

## Business UAT remains separate

Automatic file-risk classification contributes minimum post-deploy UAT keys:

| Detected change | Minimum human/agent UAT after infrastructure release |
| --- | --- |
| Stripe, payment, checkout, or webhook | Controlled test purchase, payment-failure negative case, webhook replay/idempotency |
| Mailer or email | Transactional delivery to each affected recipient role and duplicate-send negative case |
| Inventory | Reservation, payment finalization, stock result, and reconciliation evidence |
| Vendor/customer/admin journey | The affected role's end-to-end business flow and authorization boundary |
| Frontend/mobile | Required browsers/devices, responsive flow, and exact frontend production identity |

Issue-specific declarations may add stricter keys; automation success never
removes them. Payment-sensitive UAT must use approved test-mode payment methods
and sanitized provider evidence. Do not place message bodies, customer data,
tokens, or payment details in release artifacts.

## Frontend coordination

The frontend repository has a separate `feature` to `develop` to `main` to
Vercel path. The backend automation has no frontend token, dispatch, promotion,
or deployment step. Therefore `backendRequired=true` and
`frontendRequired=false` means backend-only in fact, not merely by convention.

`release/release-declaration.schema.json` defines the generic cross-repository
contract and exact component SHAs. Its example is not an active release. The
schema's `mixedVersionSafe` default is false, and a true value requires explicit
review evidence.

A release that genuinely requires both repositories is currently a human
infrastructure/product stop condition. Before enabling it, choose one canonical
coordinator, exact frontend certification and Vercel identity proof, GitHub App
scope, deployment order, failure ownership, and rollback order. Do not set
`frontendRequired=false` to route around that decision, and do not deploy the
frontend for backend-only symmetry.

## Break glass

`workflow_dispatch` exists for rollback and automation recovery, not the normal
path. A normal dispatched release still requires the exact current-main SHA and
all ordinary checks. Rollback requires:

- mode `rollback`;
- one full SHA that is an approved ancestor of `main`;
- the exact confirmation phrase `BREAK GLASS ROLLBACK EXACT SHA`; and
- the same preflight, protected Production approval, gate, drain, reservation,
  deployment, verification, and evidence controls.

For diagnostics, prefer read-only scripts and the read-only preflight role.
Manual gate commands are allowed only for recovery by an infrastructure owner
using the exact pinned resources. Never use manual dispatch to bypass source,
topology, reservation, or approval failures.

## One-time controls

Before normal operation, complete the branch rulesets, GitHub App, protected
Environments, OIDC roles, two disabled ALB rules, SSM managed-instance/document
pinning, and drain approval in
`RELEASE_CONTROL_INFRASTRUCTURE_SETUP.md`. Keep that document authoritative for
names-only settings and least-privilege policy decisions.

The `workflow_run` PR controller and status publisher are read from the default
branch. For their first introduction only, they cannot react until both files
have reached `main`. Bootstrap that first `staging` to `main` PR manually after
the exact staging certificate is green; do not temporarily expose the App key
to the staging workflow. From the next staging push onward, PR maintenance is
automatic.
