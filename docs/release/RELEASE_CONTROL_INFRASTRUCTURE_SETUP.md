# Production release-control infrastructure setup

This is the one-time setup contract for the Mosaic backend agentic release
workflow. It is intentionally separate from the per-release runbook. Completing
the repository change does not provision these resources, change GitHub
settings, enable checkout gating, invoke SSM, or deploy Production.

For the normal per-release sequence, failure behavior, business UAT boundary,
and break-glass operation, use `AGENTIC_RELEASE_OPERATIONS.md` and
`CHECKOUT_GATE_OPERATIONS.md`.

Never copy full AWS account IDs, ARNs, credentials, database URIs, customer data,
or command output into this document, pull requests, Actions logs, or release
artifacts. Record resource identities only in protected GitHub Environment
variables; release evidence uses hashes or suffixes.

## Decisions an infrastructure owner must approve once

The owner must approve all of the following before the production workflow can
be enabled:

1. Two stable ALB listener rules—one on HTTP/80 and one on HTTPS/443—will be the
   only checkout-maintenance control.
2. The rules will be created in their disabled state and remain provisioned
   between releases; a release only changes their exact path condition.
3. GitHub will use separate read-only preflight and production mutation OIDC
   roles.
4. The single `production-release-control` Environment approval is the human
   Production decision; the preflight Environment has no required reviewer.
5. The production EB instance will be SSM-managed and may execute only the pinned
   parameterless custom reservation-count document.
6. A concrete drain duration and maximum application-request duration will be
   measured, approved, and stored as variables.
7. The preflight role may call `DescribeConfigurationSettings`, accepting the
   secret-read caveat below.
8. Coupled frontend/backend releases remain disabled until product and
   infrastructure owners choose a canonical cross-repository coordinator,
   exact frontend proof, and release/rollback order.

If any decision is not approved, leave automated Production mutation disabled.

## GitHub branch and Environment controls

Repository workflows cannot create or strengthen their own rulesets safely.
Configure these settings once, then capture screenshots or API exports in the
infrastructure change record without including secrets.

### `staging` ruleset

- Require a pull request before merge; do not permit routine direct pushes.
- Require at least one human approval according to the repository's review
  policy and require all review conversations to be resolved.
- Require the `Test` status check and require the branch to be current before
  merge.
- Block force pushes and deletion. Limit bypass to an audited emergency owner;
  bypass is not part of the normal release path.

### `main` ruleset

- Require a pull request, at least one human approval, dismissal of stale
  approvals when code changes, and resolved review conversations.
- Require `Test`, `Enforce staging promotion`, and
  `mosaic/trusted-staging-certification`, with strict/current-branch
  enforcement. Bind the trusted-certification context to the exact Release
  Automation GitHub App integration; do not accept the same context from an
  arbitrary actor or GitHub Actions workflow.
- The source-enforcement check accepts only the canonical repository's exact
  current `staging` SHA. Do not add an alternate direct-push happy path.
- In the repository merge settings, allow **merge commits only** for this
  promotion path; disable squash merging and rebase merging. The certificate
  verifier requires the resulting canonical two-parent merge (`main` first,
  exact certified `staging` second). Squash or rebase would destroy that
  provenance and can wedge the next staging baseline.
- Block force pushes and deletion. Do not let administrator bypass silently
  become routine release behavior.

The release automation does not auto-merge. A green exact-SHA certificate only
makes the canonical `staging` to `main` PR reviewable.

### Protected Environments

Create `production-preflight` with no required reviewer and a custom deployment
branch policy that permits **only `main`**. GitHub Environments cannot restrict
access by workflow-file path, and the OIDC Environment subject does not include
the ref, so the main-only branch policy is mandatory. It holds only the
read-only role and preflight variables.

Create `release-pr-controller` with no required reviewer and a custom deployment
branch policy that permits **only `main`**. Store the release GitHub App ID and
private key only in this Environment. Never store that key as a repository or
organization Actions secret: candidate-controlled staging workflows can read
repository-level secrets by name.

Set the non-secret repository variable `RELEASE_AUTOMATION_APP_BOT_LOGIN` to the
App installation bot login (an App slug ending in `[bot]`). The separately
required App-owned status and production verifier require the latest exact-SHA
status creator, description, current-main baseline, and completed controller
run URL to match it. Grant
the App only repository contents read, pull requests write, and commit statuses
write. The controller re-runs unit, contract, and integration suites without
the App token and must complete successfully before the separate trusted status
publisher can publish that status.

Create a new `production-release-control` Environment restricted by custom
deployment-branch policy to **only `main`**. Configure exactly the intended
required reviewer, prevent self-review, and remove normal administrator bypass.
This is the one Production approval. Do not add a second manual dispatch or
reviewer to `production-preflight`.

The new name is a security boundary, not cosmetic. Historical deployment runs
remain rerunnable with their original workflow definition for a limited period
and used `environment: production`. Before enabling automation:

1. create a new OIDC role trusted only to
   `repo:Techware-Hut/mosaic-backend:environment:production-release-control`;
2. store its ARN only as `AWS_RELEASE_CONTROL_ROLE_TO_ASSUME`;
3. remove the legacy `AWS_ROLE_TO_ASSUME` variable and revoke or delete the old
   `environment:production` deploy-role trust; and
4. archive/delete or otherwise invalidate every still-rerunnable historical
   production deployment run according to GitHub policy.

Do not reuse the old role or Environment. An old run must receive an OIDC denial
even if an authorized actor tries to rerun and approve it.
The new workflow additionally requires `github.workflow_sha` to equal freshly
fetched current `main` during release resolution and again after approval. This
blocks reruns of an obsolete release-control definition in both normal and
rollback modes, but it does not replace revoking the historically trusted role.

Set the repository's default Actions token permission to read-only. Do not
enable GitHub Actions to create/approve pull requests globally merely to support
release PR automation.

## Release-automation GitHub App

Create or reuse a GitHub App installed only on `Techware-Hut/mosaic-backend`
with repository permissions:

- Contents: read
- Pull requests: read and write
- Commit statuses: read and write

Do not grant Actions, Administration, Environments, Secrets, Deployments, or
repository-contents write permission. Record its App ID as Environment variable
`RELEASE_AUTOMATION_APP_ID` and its private key as Environment secret
`RELEASE_AUTOMATION_APP_PRIVATE_KEY` on `release-pr-controller` only.

The default-branch `Staging release PR controller` enters the main-only
`release-pr-controller` Environment and mints a short-lived PR-only installation
token in its isolated release-PR job. After that whole controller run succeeds,
the default-branch `Trusted staging status publisher` enters the same Environment
and mints a separate status-only token. The staging candidate workflow cannot
enter that Environment and never receives the App private key.
Trigger validation, artifact
validation, exact CI revalidation, and trusted manifest reconstruction run in
fresh trusted runners. Candidate `npm ci` and tests run in a separate
unprivileged runner, and no filesystem or artifact from that runner crosses the
credential boundary. All validation completes before either token exists; each
credentialed job checks out only the pinned trusted-main controller. Rotate the
App key under the repository's credential policy and
remove superseded keys promptly.

Both controllers require their own `github.workflow_sha` and the completed
upstream controller run's head SHA/branch/repository to equal the exact current
main baseline. Rerunning an obsolete historical workflow definition must fail
before either App token can be minted.

GitHub loads `workflow_run` controllers from the default branch. Therefore the
first rollout of the PR controller and trusted status publisher requires one reviewed, manual bootstrap
`staging` to `main` PR after staging certification. Do not work around this by
placing the App secret in the staging-push workflow. Once the controller exists
on `main`, future certified staging pushes create or refresh the release PR and
publish its trusted merge-eligibility status automatically.

## Two-listener checkout-gate contract

### Checkout-surface bootstrap prerequisite

Automatic cutover remains deliberately blocked while the authenticated legacy
`POST /api/payments/create-payment-intent` route is mounted. That route can
issue a payable PaymentIntent without using the canonical checkout reservation
path, so gating only `POST /api/orders/initiate` cannot prove a quiet payment,
inventory, or email boundary. The read-only main preflight enforces this stop.

Before enabling normal automation, the release owner must approve and execute a
separate controlled prerequisite that:

1. retires or hard-disables the legacy route;
2. prevents creation of any new legacy PaymentIntent during its own cutover;
3. reconciles every already-issued intent, including intents no longer
   referenced by an order after a legacy overwrite; and
4. proves there are no outstanding payable legacy intents before certifying the
   canonical route as exclusive.

After that controlled bootstrap is complete, set the non-secret repository
variable `LEGACY_PAYMENT_RETIREMENT_SHA` to the full exact SHA observed on the
production health/build surfaces and set
`LEGACY_PAYMENT_RECONCILIATION_SHA256` to the SHA-256 of the reviewed, redacted
Stripe-liability reconciliation record. The automatic preflight requires both
values, requires the live legacy endpoint to return `404` or `405`, and proves
the retirement SHA is a Git ancestor of both the currently deployed production
identity and the exact release target. The SSM
aggregation separately requires zero non-paid orders with a stored PaymentIntent
reference. It cannot discover an intent overwritten out of MongoDB, which is
why the reviewed Stripe reconciliation digest remains mandatory.

The trusted target-tree checker scans every runtime JavaScript/TypeScript source
(excluding tooling, tests, docs, and dependencies), case-insensitively—not just
the historical payment router. It also refuses dynamic Express POST/route path
registration, so a constant, mixed-case spelling, or alternate router cannot
hide this known bypass. Independently, it requires the exact
`app.use('/api/orders', orderRoutes)` mount and literal
`post('/initiate', ...)` registration, so a generic parent-path auth catch-all
cannot masquerade as the canonical checkout handler. Deployed and ungated
public proofs require the legacy endpoint to remain `404` or `405`.

Exact-SHA CI then makes fresh post-test checkouts of the trusted current-main
probe and exact target, installs target dependencies with lifecycle scripts
disabled, and starts the target app only on loopback with synthetic non-secret
configuration. Every canonical case/trailing-slash alias must reach the normal
unauthenticated `401` guard, and every retired legacy alias must return `404` or
`405`. That runner receives no AWS credentials, database URI, App token, or
production secret. This route-table proof is required before the Production
approval job can become reachable.

This cannot be inferred from inventory state alone and requires
Stripe-aware human reconciliation. If the legacy API must remain a supported
product surface, stop and redesign the checkout gate and liability proof as an
explicit product/infrastructure decision.

Create exactly two non-default Application Load Balancer listener rules on the
dedicated production ALB:

| Listener | Stable priority | Conditions | Action |
| --- | --- | --- | --- |
| HTTP/80 | `1` | method exactly `POST` AND path exactly the disabled sentinel | fixed response `503` |
| HTTPS/443 | `1` | method exactly `POST` AND path exactly the disabled sentinel | fixed response `503` |

The disabled sentinel default is:

```text
/__mosaic_release_control/checkout_gate_disabled__
```

It must be an exact, non-wildcard path that the application does not serve.
Activation changes only the path matcher on both rules to this one anchored
`RegexValues` entry:

```text
^/[aA][pP][iI]/[oO][rR][dD][eE][rR][sS]/[iI][nN][iI][tT][iI][aA][tT][eE]/?$
```

ALB value paths are case-sensitive while Express accepts route case and a
trailing slash by default. The anchored regex covers only the application-
equivalent spellings of `/api/orders/initiate`; it cannot match a prefix,
suffix, other order route, webhook, or health route. The verifier probes lower,
upper, mixed-case, and trailing-slash forms on both listeners.

The method condition remains exactly one value, `POST`. The action remains
exactly one fixed response with status `503`. Do not add host, source-IP, header,
query-string, authentication, wildcard, or prefix conditions. Do not redirect
HTTP/80 as part of this setup: current production accepts direct HTTP and the
release verifies both listeners.

Tag both rules exactly:

```text
mosaic:release-control = checkout-initiation
```

Pin each full rule ARN, the full ALB ARN, and priority `1` for each listener in
protected GitHub Environment variables. Priority `1` is mandatory: no other
listener rule can precede the checkout gate. The controller rejects a default rule, a missing
tag, changed priority/action/method/path, cross-account/cross-region/cross-ALB
identity, an extra canonical checkout rule, or any topology other than the two
pinned HTTP/80 and HTTPS/443 listeners. Verification and disable operations
reject a mixed active/inactive state; the enable/fail-safe operation alone may
recover that exact mixed state by forcing and re-verifying both rules active.

There is no atomic ELBv2 update spanning two listeners. The controller enables
HTTPS first and disables HTTPS last to minimize the canonical-surface window. A
failed transition best-effort reasserts the active `503` state on both rules and
then fails. The workflow must also run its fail-safe enable step after any
post-attempt failure. Never delete or dynamically create the rules during a
release.

The gate is route-specific. Stripe webhook paths and `/api/health`, `/api/ready`,
and `/api/build-info` remain forwarded to the application. The verifier must show
checkout `503`, each invalid-signature webhook `400`, and each health surface
`200` on both HTTP and HTTPS before deployment. After ungating, checkout must
return normal unauthenticated `401`, not `503`, on both surfaces.

## OIDC roles and trust separation

Use GitHub Actions OIDC with environment-scoped trust. Do not create long-lived
AWS access-key GitHub secrets. Restrict the role trust policy to the canonical
repository and its exact Environment subject; restrict audience to
`sts.amazonaws.com`. Do not trust forks, pull-request subjects, arbitrary refs,
or wildcard repositories.

### Read-only production-preflight role

The `production-preflight` Environment uses `AWS_PREFLIGHT_ROLE_TO_ASSUME`. It
must have no required reviewer and no deployment protection rule that creates a
second human approval. Grant only these read operations, scoped to the production
application/environment/resources wherever the AWS API supports resource-level
authorization:

- `elasticbeanstalk:DescribeEnvironments`
- `elasticbeanstalk:DescribeEnvironmentResources`
- `elasticbeanstalk:DescribeInstancesHealth`
- `elasticbeanstalk:DescribeConfigurationSettings`
- `autoscaling:DescribeAutoScalingGroups`
- `elasticloadbalancing:DescribeLoadBalancers`
- `elasticloadbalancing:DescribeListeners`
- `elasticloadbalancing:DescribeTargetGroups`
- `elasticloadbalancing:DescribeTargetHealth`
- `elasticloadbalancing:DescribeLoadBalancerAttributes`

Do not grant Elastic Beanstalk update/deploy, ELB modification, SSM command,
Secrets Manager, Parameter Store, IAM, or S3 write permission to this role.

### Approved production release-control role

The protected `production-release-control` Environment uses
`AWS_RELEASE_CONTROL_ROLE_TO_ASSUME` and exactly one required human reviewer.
Its role trust must name only that new Environment subject; never extend it to
the legacy `production` subject. Grant the exact-SHA Elastic Beanstalk
deployment permissions plus:

- the read operations listed for preflight;
- `elasticloadbalancing:DescribeRules` and
  `elasticloadbalancing:DescribeTags` for the pinned ALB/rules;
- `elasticloadbalancing:ModifyRule` only for the two pinned rule resources;
- `ssm:DescribeDocument` for the one custom document;
- `ssm:DescribeInstanceInformation`;
- `ssm:SendCommand` constrained to the exact custom-document resource and the
  production EB managed instance scope; and
- `ssm:GetCommandInvocation` for the release-created invocation.

Do not grant `ssm:SendCommand` on `AWS-RunShellScript`, wildcard custom
documents, or arbitrary EC2 instances. Do not grant `ssm:GetParameter`,
`ssm:GetParameters`, `secretsmanager:GetSecretValue`, database write access, or
IAM mutation for this design. Preserve resource, region, tag, and document
conditions supported by each action. Because some Describe APIs require
`Resource: "*"`, keep those statements read-only and enumerate actions rather
than using service wildcards.

The production Actions job does not need `pull-requests: write`; PR commenting
belongs in a separate reporting job without AWS credentials.

## `DescribeConfigurationSettings` secret-read caveat

Elastic Beanstalk exposes deployment policy, rolling-update policy, and Enhanced
Health through `DescribeConfigurationSettings`. The same API response can also
contain secret-bearing application environment properties. IAM cannot authorize
individual option namespaces inside this API.

The repository topology checker passes an AWS CLI JMESPath projection that
returns only:

- `aws:elasticbeanstalk:command/DeploymentPolicy`
- `aws:autoscaling:updatepolicy:rollingupdate/RollingUpdateEnabled`
- `aws:elasticbeanstalk:healthreporting:system/SystemType`

This keeps unrelated settings out of Node, stdout, and artifacts. It does not
remove the OIDC role's underlying ability to call the broader API. The
infrastructure owner must explicitly accept that read exposure. If policy does
not permit it, do not grant the action: replace the live policy check with a
separately governed, immutable topology declaration and accept that drift cannot
be detected through this workflow until AWS offers narrower authorization.

## SSM reservation-count setup

Before enabling reservation automation:

1. Ensure the one exact production EB instance is registered with Systems
   Manager, reports `PingStatus=Online`, and is Linux.
2. Build the independently versioned tool under
   `infrastructure/release-control/reservation-tool` with its exact lockfile.
   Install its single bundle at
   `/opt/mosaic-release-control/reservation-check.cjs` through a root-owned base
   image or another provisioning path application candidates cannot change.
   Do not install it from `.platform` or application deployment hooks.
   The deploy controller forbids `.platform/` and `.ebextensions/` in every new
   or rollback bundle because either could invalidate the root trust boundary.
3. Render `MosaicReadOnlyReservationCheck.json` with the resolved Node path and
   exact SHA-256 values for that root-owned bundle, the resolved Node binary,
   and the EB `get-config` helper, then review the rendered document.
   The checked-in placeholders deliberately fail closed.
4. Register it under the exact name `MosaicReadOnlyReservationCheck`.
5. Pin its reviewed positive document version and AWS-reported SHA-256 in the
   protected `production-release-control` Environment variables.
6. Grant the production role only the custom-document command permissions above.
7. Run a controlled, non-release validation that proves stdout is exactly the
   three-field count-only JSON and stderr is empty. Do not retain raw SSM
   output.

The document accepts no parameters or caller-supplied command and never invokes
the deployed application tree. It obtains the database URI locally via the EB
`get-config` helper, with shell tracing disabled,
and never sends the URI to GitHub, SSM parameters, Parameter Store, or Secrets
Manager. The release runner first cross-checks EB's one exact instance against
the one online SSM instance, pins the document name/version/hash, and stops if
any release-blocker count is nonzero. The filters cover active reservations,
paid orders without an aggregate paid-email completion marker, and non-paid
orders that still reference an issued PaymentIntent.

This design is valid only while the base image, SSM agent, pinned binaries, and
their root-owned non-group/world-writable directory chain remain outside
candidate control. If that boundary cannot be independently attested, do not
weaken the checks: provision an external immutable count-only query plane with
a read-only database credential and keep this workflow blocked until its
identity and output contract are pinned.

If Production ever has more than one EB instance, the current reservation runner
stops. Do not choose one instance arbitrarily; review the topology, database
read consistency, mixed-version policy, and SSM targeting design first.

## Approved drain configuration

Determine, record, and approve two integer values in seconds:

- `CHECKOUT_MAX_REQUEST_SECONDS`: the maximum application checkout-initiation
  request duration, including the relevant server timeout; and
- `CHECKOUT_DRAIN_SECONDS`: the gate-to-deploy wait.

The topology preflight reads the current ALB idle timeout. The configured drain
must be strictly greater than both the approved maximum application request
duration and the observed ALB idle timeout. It must include any additional
connection/request-draining behavior actually configured for the application.
Do not choose a value merely to satisfy a test. Re-approve it whenever ALB,
proxy, server, worker, checkout, or topology timeouts change.

The workflow activates and externally verifies both listener rules, records gate
activation evidence, validates the drain decision, waits the approved duration,
and verifies the gate again before the reservation check. If access/application
logs can prove in-flight checkout state without exposing request bodies or PII,
add that proof separately; time-based drain remains required until such proof is
implemented and reviewed.

## GitHub Environment variables and approval settings

Configure names and values in the indicated GitHub Environment. Full ARNs are
sensitive infrastructure identifiers: never echo them or copy them into issue
comments or artifacts.

### Repository variables

- `RELEASE_AUTOMATION_APP_BOT_LOGIN`
- `LEGACY_PAYMENT_RETIREMENT_SHA`
- `LEGACY_PAYMENT_RECONCILIATION_SHA256`

### `release-pr-controller` (main-only, no reviewer)

- Environment variable `RELEASE_AUTOMATION_APP_ID`
- Environment secret `RELEASE_AUTOMATION_APP_PRIVATE_KEY`

### `production-preflight` (no reviewer)

- `AWS_PREFLIGHT_ROLE_TO_ASSUME`
- `AWS_REGION` (`us-east-1` for the current environment)
- `EB_APPLICATION_NAME`
- `EB_ENVIRONMENT_NAME`
- `CHECKOUT_DRAIN_SECONDS`
- `CHECKOUT_MAX_REQUEST_SECONDS`

### `production-release-control` (main-only, one required reviewer)

- `AWS_RELEASE_CONTROL_ROLE_TO_ASSUME`
- `AWS_REGION`
- `EB_APPLICATION_NAME`
- `EB_ENVIRONMENT_NAME`
- `CHECKOUT_GATE_LOAD_BALANCER_ARN`
- `CHECKOUT_GATE_HTTP_RULE_ARN`
- `CHECKOUT_GATE_HTTPS_RULE_ARN`
- `CHECKOUT_GATE_HTTP_PRIORITY`
- `CHECKOUT_GATE_HTTPS_PRIORITY`
- `CHECKOUT_GATE_DISABLED_PATH`
- `CHECKOUT_DRAIN_SECONDS`
- `CHECKOUT_MAX_REQUEST_SECONDS`
- `SSM_RESERVATION_DOCUMENT_NAME`
- `SSM_RESERVATION_DOCUMENT_VERSION`
- `SSM_RESERVATION_DOCUMENT_SHA256`

Keep gate tag names at their repository defaults unless the script and this
contract are deliberately changed together. Do not store `MONGODB_URI`, AWS
access keys, SSM stdout, Stripe secrets, or test-user credentials in any of these
variables.

## Cross-repository release decision

`release/release-declaration.schema.json` defines component intent, but no
cross-repository coordinator is enabled by this setup. The backend workflow has
no permission to dispatch, merge, or deploy
`Digital-Builders-757/mosaic-biz-frontend-launch`. This is the required state for
backend-only releases.

Before accepting any declaration with `frontendRequired=true`, owners must make
and document all of these one-time decisions:

1. Which repository or external control plane owns the combined state machine.
2. How the exact frontend `develop` SHA is certified and tied to the exact
   `main` deployment and Vercel production identity.
3. Whether the order is independent, frontend-first, or backend-first, including
   what compatibility proof makes that order safe.
4. Which narrowly scoped GitHub App may read status and create/update promotion
   PRs in each repository; never reuse an AWS-capable token.
5. What happens when one component succeeds and the other fails, including gate
   ownership and rollback order.
6. Which human approval covers the combined release without creating ambiguous
   double approval.

Until those decisions are implemented and independently tested, a coupled
release is blocked. Do not deploy the frontend for symmetry, and do not mark it
optional when the issue actually depends on it. The declaration schema by itself
does not authorize or orchestrate either deployment.

## Pre-enable acceptance checklist

- [ ] Both stable rules are disabled, tagged, fixed `503`, exact `POST`, and use
      the pinned sentinel path.
- [ ] The rule priorities and three ARNs are recorded only in the protected
      `production-release-control` Environment.
- [ ] The preflight role authenticates read-only and its broader EB configuration
      read exposure is explicitly accepted.
- [ ] `production-preflight` has a main-only custom deployment-branch policy;
      no feature or staging workflow can enter it.
- [ ] The new release-control role trusts only the
      `environment:production-release-control` OIDC subject, can modify only the
      two pinned rules, and can deploy only the intended EB target.
- [ ] The legacy `AWS_ROLE_TO_ASSUME` variable and old
      `environment:production` role trust are removed/revoked, and every still-
      rerunnable historical deploy run is invalidated or expired.
- [ ] `production-preflight` has no reviewer;
      `production-release-control` is main-only and has exactly the intended
      required reviewer, self-review prevention, and no normal bypass.
- [ ] The exact EB instance is SSM Online.
- [ ] The custom parameterless document version/hash are reviewed and pinned.
- [ ] The production role cannot invoke `AWS-RunShellScript` or arbitrary
      documents/instances.
- [ ] The approved drain exceeds the measured application and live ALB limits.
- [ ] `staging` and `main` rulesets require the exact checks and human reviews
      described above, with force pushes/deletion blocked.
- [ ] The release GitHub App is repository-scoped and has only Contents-read,
      Pull-requests-read/write, and Commit-statuses-read/write permission; its
      bot login and integration binding are recorded.
- [ ] A fixture/non-production rehearsal proves gate enable, webhook/health
      exclusions, reservation count-only output, fail-safe regating, and ungate.
- [ ] No live release is attempted until all checks pass.
