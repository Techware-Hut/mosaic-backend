# Backend Documentation Archive

**Purpose:** dated QA proofs, smoke packs, sprint snapshots, and audit evidence.

Files are not physically moved in this PR to avoid breaking links. Treat older proof and audit docs as historical evidence, not current operating rules. For current behavior, start with:

- [../PLATFORM_OPERATING_MODEL.md](../PLATFORM_OPERATING_MODEL.md)
- [../MARKETPLACE_VENDOR_ELIGIBILITY.md](../MARKETPLACE_VENDOR_ELIGIBILITY.md)
- [../README.md](../README.md)

## Archive Categories

| Category | Existing locations |
| --- | --- |
| Launch and smoke proofs | `docs/*SMOKE*`, `docs/smoke/*`, `docs/*PROOF*`, `docs/*EVIDENCE*` |
| Sprint and batch audits | `docs/*AUDIT*`, `docs/audit/*`, `docs/BACKEND_*BATCH*` |
| As-built route/model snapshots | `docs/backend/*AS_BUILT*`, `docs/backend/*ROUTE*`, `docs/backend/*CONTRACT*` |
| Deployment verification logs | `docs/*DEPLOY*`, `docs/deploy-verification.md` |

## Rule

If an archive/evidence doc conflicts with a source-of-truth doc or current code, trust source-of-truth plus runtime verification and update the stale doc or add an archive banner in the next documentation pass.
