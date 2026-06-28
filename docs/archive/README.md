# Backend Documentation Archive

**Purpose:** dated QA proofs, smoke packs, sprint snapshots, and audit evidence.

Files are not physically moved in this PR to avoid breaking links. Treat older proof and audit docs as historical evidence, not current operating rules. For current behavior, start with:

- [../MVP_BACKEND_PROGRAM_STATUS.md](../MVP_BACKEND_PROGRAM_STATUS.md)
- [../DOCUMENTATION_CONSOLIDATION_2026_06_28.md](../DOCUMENTATION_CONSOLIDATION_2026_06_28.md)
- [../PLATFORM_OPERATING_MODEL.md](../PLATFORM_OPERATING_MODEL.md)
- [../MARKETPLACE_VENDOR_ELIGIBILITY.md](../MARKETPLACE_VENDOR_ELIGIBILITY.md)
- [../README.md](../README.md)

Current production/domain state lives in the status and consolidation docs above. Older proof packs may name previous SHAs, old preview domains, app-domain transition wording, or pre-cutover gates.

## Archive Categories

| Category | Existing locations |
| --- | --- |
| Launch and smoke proofs | `docs/*SMOKE*`, `docs/smoke/*`, `docs/*PROOF*`, `docs/*EVIDENCE*` |
| Sprint and batch audits | `docs/*AUDIT*`, `docs/audit/*`, `docs/BACKEND_*BATCH*` |
| As-built route/model snapshots | `docs/backend/*AS_BUILT*`, `docs/backend/*ROUTE*`, `docs/backend/*CONTRACT*` |
| Deployment verification logs | `docs/*DEPLOY*`, `docs/deploy-verification.md` |

## Rule

If an archive/evidence doc conflicts with a source-of-truth doc or current code, trust source-of-truth plus runtime verification and update the stale doc or add an archive banner in the next documentation pass.
