# Mosaic release declarations

This directory defines the lightweight, cross-repository planning contract for
Mosaic releases. A declaration says which application repositories participate;
it is not a staging certificate, a merge approval, a Production approval, or a
deployment instruction.

Use `release-declaration.schema.json` to validate declarations and
`release-declaration.example.json` as a shape example. Do not copy the example's
placeholder SHA into a real release.

## Fail-closed component rules

- At least one of `backendRequired` and `frontendRequired` is `true`.
- A required component has one exact, lowercase, full 40-character certified
  SHA. A component that is not required has a `null` SHA.
- `backendRequired=true` and `frontendRequired=false` requires
  `deploymentOrder=backend-only`. The backend automation must not dispatch,
  promote, or deploy the frontend.
- A two-repository declaration requires an explicit order: `independent`,
  `frontend-then-backend`, or `backend-then-frontend`.
- `mixedVersionSafe` is fail-closed. Its semantic default is `false`, including
  when a consumer does not understand or cannot load the field. Setting it to
  `true` requires a reviewer, timestamp, and evidence URL. It never bypasses the
  exact-SHA, topology, gate, reservation, or human-approval checks.

JSON Schema's `default` keyword is descriptive; validators do not necessarily
write default values into a document. Real declarations should therefore write
`mixedVersionSafe: false` explicitly. Generated backend certification also
sets the equivalent risk signal to `false`.

## Current integration boundary

The backend staging workflow currently generates an immutable exact-SHA
certification artifact from the Git diff. It does not ingest a committed
cross-repository declaration and does not call the frontend repository. This is
deliberate: backend-only releases cannot promote the frontend accidentally.

Before using `frontendRequired: true`, the owners must approve and implement a
cross-repository coordinator that can prove both exact SHA certificates, enforce
the declared order, observe the Vercel production identity, and write status
without broad repository tokens. Until then, a coupled frontend/backend release
is a stop condition, not a reason to mark the frontend optional.

## UAT keys

`productionUat` is additive, machine-readable business UAT. Infrastructure
automation reports the list; it does not claim the checks passed. Use at least:

| Risk | Minimum UAT keys |
| --- | --- |
| Payment or checkout | `controlled-payment-success`, `payment-failure-negative-case`, `webhook-replay` |
| Transactional email | `transactional-email-delivery`, `duplicate-email-negative-case` |
| Inventory reservation | `inventory-reservation-and-finalization` |
| Frontend/mobile journey | issue-specific customer, vendor, and admin journey keys plus device/browser coverage |

More specific checks may be added for an issue. Never remove a minimum check
merely because unit or infrastructure verification is green.
