# Agent Workflow — Mosaic Backend

Process guide for AI agents and developers working on `Techware-Hut/mosaic-backend`. Read this before opening a branch.

**Related:** [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) · [LLM_CONTEXT.md](LLM_CONTEXT.md) · [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) · [BACKEND_STABILITY_AGENT_PROMPT.md](BACKEND_STABILITY_AGENT_PROMPT.md)

---

## Read order (mandatory)

1. [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) — production SHA, merged issues, open work
2. [LLM_CONTEXT.md](LLM_CONTEXT.md) — safe-edit rules, domain map, env names, no-touch zones
3. [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) — route → controller → model ownership
4. Issue-specific doc from [docs/README.md](README.md) (if one exists for your issue)
5. [API_SURFACE.md](API_SURFACE.md) or [ARCHITECTURE.md](ARCHITECTURE.md) for deep route detail

---

## Global guardrails

| Rule | Detail |
| --- | --- |
| One issue per branch | Branch name: `sprint/backend-<short-description>` |
| One PR per issue | Do not bundle unrelated fixes |
| No direct commits to `main` | Always use a feature branch |
| No merge | Human merges after review |
| No deploy | Human runs EB deploy via GHA `workflow_dispatch` |
| No secrets | Never commit `.env`, paste values in docs, or log credentials |
| No fake proof | Do not invent smoke results, payment success, or production evidence |
| No live Stripe charges | Test mode only unless written approval exists |
| Preserve canonical featured route | **`GET /api/featured-products`** only — never introduce `/api/products/featured` |
| Payment/checkout changes | Require written approval; treat Stripe/Connect as no-touch by default |
| Workflow edits | Do not edit `.github/workflows/*` unless the issue explicitly requires it **and** approval is written |
| Minimal diff | Match existing patterns; no drive-by refactors |

---

## Before coding

1. `git checkout main && git pull origin main`
2. Confirm working tree is clean (`git status`)
3. Read docs listed in [Read order](#read-order-mandatory) above
4. Inspect existing tests for the area you will change (`tests/<domain>/`)
5. Create branch: `git checkout -b sprint/backend-<short-description>`
6. Write a short implementation plan in chat or PR description before editing files
7. For audit-first issues: produce documentation before code changes

---

## Before opening a PR

1. Run relevant tests for your domain
2. Run full suite when practical: `npm test` (expect **173/173** on current `main`)
3. Confirm diff contains **no secrets** and **no unrelated files**
4. Confirm docs updated where the issue requires it
5. Do **not** use `git add .` — stage files intentionally
6. Include in PR body:
   - **Summary** — what changed and why
   - **Test proof** — command + pass count
   - **Risk notes** — what could break
   - **Rollback notes** — how to revert safely
   - **Open questions** — anything blocked on human decision

### PR title format

```
<type>(<scope>): short description (#<issue>)
```

Examples: `docs(agent): architecture knowledge pack (#50)` · `fix(checkout): block unapproved vendors (#42)`

---

## Release-control rules

| Action | Who | How |
| --- | --- | --- |
| Merge to `main` | Human reviewer | GitHub PR merge |
| Production deploy | Release owner | Manual GHA workflow: [deploy-eb-production.yml](../.github/workflows/deploy-eb-production.yml) |
| Post-deploy smoke | QA / release owner | [production-smoke-checklist.md](production-smoke-checklist.md) tiers P0–P6 |
| Deploy evidence | Release owner | Append to [deploy-verification.md](deploy-verification.md) |
| Push-to-main auto-deploy | **Disabled** | Intentionally commented out in deploy workflow |

Agents must **not** trigger deploy workflows, change EB env vars, or mark launch items complete without evidence.

---

## Documentation-only issues

- Must not change runtime behavior
- Still run `npm test` to confirm no accidental code edits
- Update [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) when sprint state changes (usually human after merge)

---

## When you find out-of-scope bugs

Document the issue clearly (file, risk, suggested fix) in the PR **Open questions** section. Do **not** fix it in the same PR unless explicitly approved.

---

## Quick commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Local dev with nodemon (port 3001) |
| `npm start` | Production-style start |
| `npm test` | Full automated test suite |
| `node scripts/verify-auth-check-smoke.js` | Manual auth smoke against API |

Local env: app reads **`.env`**, not `.env.local`. See [SETUP.md](../SETUP.md).
