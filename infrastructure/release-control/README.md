# Mosaic release-control infrastructure assets

This directory contains reviewed source assets for one-time AWS setup. Committing
an asset does not create, update, or invoke any AWS resource.

## Reservation-count SSM document

`MosaicReadOnlyReservationCheck.json` is the only SSM document the automated
reservation gate may invoke. Its registered AWS Systems Manager document name
must be exactly `MosaicReadOnlyReservationCheck`.

The document has no parameters. It therefore cannot accept a caller-supplied
command, path, environment value, database URI, or query. It also never executes
code from `/var/app/current`: a release candidate must not be able to falsify its
own pre-deploy proof. On the one exact Elastic Beanstalk instance selected by
the workflow, it:

1. verifies the pinned real path, SHA-256, root ownership, and non-writable mode
   for the system Node runtime and every trusted parent directory;
2. verifies SHA-256 and root ownership for the separately installed, bundled
   `/opt/mosaic-release-control/reservation-check.cjs`, including protected
   parent directories;
3. verifies SHA-256, root ownership, real path, and mode for Elastic
   Beanstalk's local `get-config` helper;
4. writes the local EB environment JSON to a mode-`0600` temporary file;
5. extracts `MONGODB_URI` only into a clean child-process environment, with
   tracing off;
6. deletes the temporary file and unsets the URI on every normal or signalled
   exit; and
7. runs only the pinned count-only tool.

Successful stdout is exactly one JSON object:

```json
{"activeReservationCount":0,"incompletePaidOrderCount":0,"unresolvedPaymentIntentCount":0}
```

The release runner rejects multiline output, missing or extra object keys, a
negative or non-integer count, any stderr, a non-success invocation, or any
nonzero count. It
never publishes SSM stdout/stderr, the command identifier, full instance ID, or
database URI. The trusted tool source lives under `reservation-tool/`; it uses
one MongoDB majority-read aggregation with fixed facets for active reservations,
incomplete paid-order delivery, and unresolved issued PaymentIntents. A single
operation prevents a payment-state transition from falling between sequential
counters, and the tool has no database-write operation.

The document intentionally uses `aws:runShellScript` internally because that is
how SSM Command documents execute on Linux. The GitHub OIDC role must not have
permission to call the generic AWS-owned `AWS-RunShellScript` document. Its
`ssm:SendCommand` permission is restricted to this custom document and the
production EB instance resource scope described in the setup guide.

## One-time registration and immutable pin

An AWS administrator, outside a release run:

1. reviews `reservation-tool/index.js` and its exact lockfile;
2. builds it with `npm ci && npm run build` in that directory;
3. installs only the resulting `dist/index.js` as the root-owned
   `/opt/mosaic-release-control/reservation-check.cjs` on the EB base image or
   another candidate-independent provisioning layer;
4. records the resolved Node path and SHA-256 values for that runtime, the
   bundled tool, and the platform-owned `get-config` helper;
5. replaces `__PINNED_SYSTEM_NODE_REALPATH__`,
   `__PINNED_RESERVATION_TOOL_SHA256__`, `__PINNED_SYSTEM_NODE_SHA256__`, and
   `__PINNED_GET_CONFIG_SHA256__` in a temporary rendered copy of the SSM
   document; and
6. creates a new immutable document version from the rendered copy.

The literal placeholder source is fail-closed and must never be registered as a
usable document. Instance replacement must reinstall the exact pinned tool; an
application deployment hook is not a valid installer because candidate code
controls it. Treat each update as a new immutable document version:

- never edit the registered content during a release;
- do not set a new version as the workflow pin until it has been reviewed;
- retain the reviewed version while a release may still reference it; and
- record the exact positive document version and AWS-reported SHA-256 hash as
  protected GitHub Environment variables.

The workflow-facing variables are names only:

- `SSM_RESERVATION_DOCUMENT_NAME`
- `SSM_RESERVATION_DOCUMENT_VERSION`
- `SSM_RESERVATION_DOCUMENT_SHA256`

The name must remain `MosaicReadOnlyReservationCheck`. The Node runner calls
`DescribeDocument` and requires the name, active status, type `Command`, exact
version, `Sha256` hash type, and exact hash before `SendCommand`. It also passes
that version and hash to `SendCommand`, so a changed default version cannot be
silently substituted.

Do not put `MONGODB_URI` in this file, SSM parameters, GitHub variables/secrets,
or an SSM command parameter. The credential remains inside the EB instance trust
boundary.

The trusted deploy controller rejects every `.platform/` and `.ebextensions/`
member in both new and rollback bundles. Those mechanisms can execute candidate
commands as root and would invalidate an in-instance proof. The base image and
release-control installation are infrastructure-owned; if the operator cannot
prove that candidates cannot mutate the pinned runtime, tool, `get-config`, or
their parent directories, use an external immutable query plane instead and
keep Production blocked.
