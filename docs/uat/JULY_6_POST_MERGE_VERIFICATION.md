# July 6 Post-Merge Verification

Date: July 7, 2026 (conformance audit update)

Status: **Controlled production UAT — not final launch approval.** Production promoted via PR #209 (backend) and PR #335 (frontend) before manual UAT evidence was attached.

## Verified Production SHAs

| Repo | Branch | Verified SHA |
| --- | --- | --- |
| Techware-Hut/mosaic-backend | `main` | `ad9ddd14c85ac851f9001e5f9952c9b594159d9c` |
| Digital-Builders-757/mosaic-biz-frontend-launch | `main` | `b3a86cb43a8562e30d535ab5f1a58b6b97dca2a7` |

Pre-promotion candidate SHAs: backend `b838239b`, frontend `8163a3b3`.

## Merged PRs

| PR | Repo | Base | Merge SHA | Scope |
| --- | --- | --- | --- | --- |
| #207 | Techware-Hut/mosaic-backend | `staging` | `429e4ef4d1212199104811adafd77ac95355dc31` | July 6 docs, handoff, readiness, and traceability updates. |
| #334 | Digital-Builders-757/mosaic-biz-frontend-launch | `develop` | `2b1b8fac6c4010a917c01b4e01a7cd9f62dee403` | July 6 cart/checkout ESLint regression fix plus UAT docs, handoff, and readiness updates. |

## Commands Run

Backend:

- `npm test`
- `npm run test:integration`
- `npm run test:contract`

Frontend:

- `npm run build`
- `npm test --if-present`
- `npm run test:unit`
- Focused `npx eslint` on July 6 touched files.

Guardrails:

- Backend active source scan confirmed no `/api/products/featured` route and canonical `/api` + `/featured-products` registration.
- Frontend active source scan confirmed no `/api/products/featured` caller and canonical `/api/featured-products` helper usage.

## Results

| Area | Result |
| --- | --- |
| Backend unit tests | Passed, 529/529. |
| Backend integration tests | Passed, 74/74. |
| Backend contract tests | Passed, 20/20. Confirmed canonical featured route and Stripe webhook raw-body order. |
| Frontend build | Passed. |
| Frontend `npm test --if-present` | Passed with exit code 0. |
| Frontend unit tests | Passed, 172/172. |
| Focused July 6 ESLint | Passed with 0 errors and 9 known warnings. |
| Secrets and env file check | No `.env` files, secret files, or credential-value patterns found in the merged PR diffs. |

## Remaining Blockers

- Manual UAT evidence is still required for the July 6 checklist.
- Shipment tracking email needs safe provider/log evidence.
- PDF and JPEG hosted upload behavior needs safe proof without signed upload URLs.
- Bryan written business approval is required before **launch sign-off** (promotion to `main` already occurred).
- Lionel technical approval is still required before **launch sign-off**.

## Manual UAT Checklist

Use [JULY_6_PRODUCTION_UAT_CHECKLIST.md](./JULY_6_PRODUCTION_UAT_CHECKLIST.md) and [JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md](../release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md).

Conformance audit: [JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md](../audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md)

## Release Statement

Controlled production UAT in progress; not final launch approval.

No deployment was performed by this audit pass.
