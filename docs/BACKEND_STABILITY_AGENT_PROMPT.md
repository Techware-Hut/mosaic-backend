# Backend Stabilization + Roadmap Progress Prompt

Use this prompt in Cursor or OpenClaw when running a controlled backend stabilization sprint on `Techware-Hut/mosaic-backend`.

**Branch:** `sprint/backend-stability-roadmap-cleanup` (or a new `sprint/backend-*` branch for a focused follow-up)

**Related docs:** [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) · [BACKEND_STABILITY_ROADMAP_AUDIT.md](BACKEND_STABILITY_ROADMAP_AUDIT.md) · [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md)

---

## Prompt (copy from here)

```text
You are working in the backend repo:

Techware-Hut/mosaic-backend

Act as a senior backend engineer, release coordinator, and production-readiness auditor.

Current production API:
https://api.mosaicbizhub.com

Frontend launch origin:
https://mosaic-biz-frontend-launch.vercel.app

Canonical featured endpoint:
GET /api/featured-products

IMPORTANT RULES

- Do not merge to main.
- Do not deploy.
- Do not edit production deployment workflows unless explicitly required and documented.
- Do not commit secrets.
- Do not introduce breaking API changes.
- Preserve GET /api/featured-products as the canonical featured endpoint.
- Do not create or switch the frontend/backend contract to /api/products/featured.
- Do not touch Stripe checkout, payment intent creation, Stripe Connect, or webhook behavior unless the issue is clearly about broken checkout and you isolate the change carefully.
- Keep all public response changes backward compatible.
- Prefer small, safe fixes with tests over large rewrites.
- Leave clear documentation and proof.

Branch name:
sprint/backend-stability-roadmap-cleanup

Primary goal:
Clean up lingering backend issues, improve loading/API performance where safe, verify MVP backend readiness, and create a clear roadmap report for what remains.

Context:
Mosaic Biz Hub is a marketplace platform with vendor onboarding, public browsing, products, services, food/restaurants, business/vendor profiles, featured listings, tier plans, trust/verification workflow, checkout/order flow, admin review, and customer browsing. The project requires a structured deliverable review process, defect tracking, and separation of accepted work, defects, pending work, deferred work, and change requests.

Use the existing repo docs first, especially anything under docs/, GitHub issues, API audit files, smoke proof docs, marketplace data contract docs, deployment docs, and launch-readiness notes.

PHASE 1 — Repository and Issue Audit

1. Inspect the full backend repo.
2. Read existing docs and recent completed backend work.
3. Review open GitHub issues if available locally or through gh CLI.
4. Identify lingering backend issues related to:
   - public marketplace APIs
   - products
   - services
   - food/restaurants
   - vendor/business profiles
   - featured products
   - search/filter endpoints
   - vendor onboarding approval/rejection flow
   - trust score/status fields
   - admin review queues
   - email notifications
   - health checks
   - CORS
   - error handling
   - logging/monitoring
   - database query performance
   - response payload consistency
   - pagination and loading speed
   - N+1 queries
   - missing indexes
   - duplicate or dead endpoints
   - test coverage gaps
   - production smoke readiness

Deliverable:
Create or update:

docs/BACKEND_STABILITY_ROADMAP_AUDIT.md

Include:
- What exists
- What is working
- What is fragile
- What is missing
- What should be fixed now
- What should be deferred
- What may be change request / future scope
- Risks before production testing

PHASE 2 — Safe Backend Fixes

Apply only safe, scoped fixes that improve production readiness without changing major business logic.

Look for and fix:

1. Slow public endpoints
   - Add pagination defaults where missing.
   - Add max page/limit guards.
   - Avoid returning huge unbounded result sets.
   - Optimize includes/selects.
   - Remove unnecessary heavy nested payloads from list/card endpoints.
   - Keep detail endpoints richer than card/list endpoints.

2. Database performance
   - Identify likely slow filters/sorts.
   - Add safe indexes through migrations if the ORM/migration system supports it.
   - Focus on fields used for:
     - status/visibility
     - category/type
     - vendor/business id
     - featured flag
     - createdAt/updatedAt
     - location/city/state/zip if already implemented
     - product/service/food listing status
   - Do not add speculative geolocation logic if ZIP/geolocation is not already implemented.

3. Public response consistency
   - Ensure cards/detail pages get predictable fields:
     - id
     - title/name
     - slug if available
     - description/summary
     - price or priceRange where applicable
     - image/images
     - category/type
     - vendor/business summary
     - badge/trust fields if available
     - location summary if available
     - availability/status
   - Use DTO/helper/serializer patterns if they already exist.
   - Do not remove existing fields.

4. Error handling
   - Normalize error responses where safe.
   - Avoid leaking stack traces in production.
   - Ensure common 400/401/403/404/500 cases are handled intentionally.

5. Loading and frontend experience
   - Make list endpoints return fast, lightweight payloads.
   - Add pagination metadata if missing:
     - page
     - limit
     - total or hasMore if feasible
   - Ensure empty states return clean arrays, not crashes.
   - Ensure search/filter queries do not crash when params are missing or malformed.

6. Health and observability
   - Verify health endpoint behavior.
   - Add or improve lightweight request logging if already part of the stack.
   - If Sentry is already installed/configured, verify backend error capture is wired safely.
   - If Sentry is not installed, do not force a major integration unless there is already an issue for it. Document the needed env vars and setup instead.

7. Vendor onboarding and verification
   - Verify approval/rejection email flow still works.
   - Confirm failed verification or under-review statuses do not expose unapproved vendor listings publicly.
   - Ensure vendor listings are hidden when status requires review.
   - Do not implement external BusinessScreen/API verification unless already contracted and clearly present in code.
   - Manual review is acceptable for MVP.

8. Security/safety checks
   - Check CORS allowed origins.
   - Check auth guards on admin/vendor routes.
   - Check public endpoints do not expose private vendor/customer data.
   - Check file upload validation if present.
   - Do not commit .env files.

PHASE 3 — Tests and Proof

Run the available test suite and build/lint commands.

Try, in order, based on what exists in package scripts:

- npm install or npm ci only if needed
- npm run lint
- npm test
- npm run test
- npm run build
- npm run typecheck
- any existing smoke scripts

If a command does not exist, document that clearly.

Add or update tests for any changed logic:
- DTO/serializer tests
- public endpoint tests
- pagination/filter tests
- status/visibility tests
- error handling tests

Create or update:

docs/BACKEND_STABILITY_PROOF.md

Include:
- branch name
- files changed
- tests run
- test results
- endpoints manually checked
- remaining risks
- exact commands used
- any migrations added
- any env vars required
- anything intentionally deferred

PHASE 4 — Roadmap Issues

Create a markdown issue plan in:

docs/BACKEND_ROADMAP_ISSUES.md

Group remaining work into GitHub-ready issues.

Use these categories:

1. Launch blockers
2. High-priority post-launch
3. Performance/loading improvements
4. Vendor/admin workflow improvements
5. Marketplace/search improvements
6. Observability/monitoring
7. Future scope/change requests

For each issue include:
- Title
- Problem
- User/business impact
- Scope
- Out of scope
- Acceptance criteria
- Testing notes
- Risk level

Do not overbuild. Separate real MVP defects from future roadmap ideas.

PHASE 5 — Final Output

Before stopping, provide a final summary with:

1. What you found
2. What you fixed
3. What you did not fix and why
4. Test results
5. Any migrations/env changes
6. Exact next recommended GitHub issues
7. Whether this branch is safe to open as a PR

Commit changes only if tests pass or if failures are clearly pre-existing and documented.

Suggested commit message:
chore: stabilize backend roadmap readiness
```

---

## Fix now vs verify vs defer

| Lane | Examples |
| --- | --- |
| **Fix now** | API speed, public listing safety, pagination caps, response consistency, hidden/unapproved vendor visibility, CORS, health checks, failed email paths, test proof |
| **Verify now** | Stripe checkout/order flow, vendor plan/tier permissions, admin approval/rejection flows, public marketplace filters |
| **Defer** | BusinessScreen automation, advanced geolocation, full reviews system, AI chatbot, advanced analytics, referral rewards, Diamond automation, community events, predictive dashboards |
