# Backend Post-Integration Evidence

Date: 2026-06-24  
Repository: `Techware-Hut/mosaic-backend`  
Integration branch audited: `staging`  
Audited `staging` SHA: `88ed0781707df4a54f78a210218001b46b3d20cf`  
Working branch for this pass: `docs/backend-post-integration-reconciliation`

## Scope

This pass reconciled the current backend `staging` branch against the frontend `develop` route surface and the June 24 regression documents. It was not a production deploy, main-branch merge, or release PR.

## Repository State

| Item | Evidence |
| --- | --- |
| Remote sync | `git fetch --all --prune`; `git pull --ff-only origin staging` returned already up to date |
| Working tree before docs | Clean |
| Open backend PR observed | `#129` from `staging` to `main`: `Sync staging with main: promote domain migration and child-service delete` |
| Latest integrated backend PRs | `#132` marketplace badge filter intersections; `#130` root-domain canonicalization |
| Frontend reference | `Digital-Builders-757/mosaic-biz-frontend-launch` `develop` SHA `5d35b4ddd3dec596bec61b686b5b92f895417e6e` |

## Integrated Work Observed

| Area | Evidence |
| --- | --- |
| Canonical frontend domain | `utils/frontendUrl.js` defaults to `https://mosaicbizhub.com`; `app.mosaicbizhub.com` and the Vercel launch origin remain approved transition origins |
| Credentialed CORS origins | `utils/corsOrigins.js` explicitly allows apex, transition app host, and launch Vercel origin; wildcard origins are filtered |
| Stripe Connect return/refresh URLs | `lib/connect/connectUrls.js` honors approved overrides and defaults to apex frontend paths |
| Raw Stripe body order | `app.js` mounts raw webhook handlers before `express.json()`; contract tests cover this |
| Marketplace badge filters | Service/product/food badge filters normalize badge casing and preserve explicit business scope |
| Canonical featured route | `GET /api/featured-products` is registered; `/api/products/featured` is absent |

## Verification

| Command/check | Result |
| --- | --- |
| `npm test` | Pass: 388/388 |
| `npm run test:contract` | Pass: 20/20 |
| Stripe raw-body contract | Covered by unit and contract tests: webhook routes remain mounted before `express.json()` |
| CORS/domain contract | Covered by CORS tests: apex and configured Vercel origin allowed; disallowed origins rejected; wildcard filtered |
| Production `GET /api/health` | 200, release commit `cf454ed`, environment `production` |
| Production `GET /api/ready` | 200, database connected, release commit `cf454ed` |
| Production `GET /api/featured-products?page=1&limit=1` | 200 |
| Production `GET /api/services/list?badge=bronze&page=1&limit=1` | 200 |
| Production `GET /api/food/list?badge=bronze&page=1&limit=1&price=all` | 200 |

## Important Deployment Caveat

Production read-only probes report release commit `cf454ed`, while the audited staging branch is `88ed0781707df4a54f78a210218001b46b3d20cf`. That means production health is healthy, but production is not proven to be running the exact audited staging commit.

## Launch Gate

| Priority | Gate | Status | Evidence/action |
| --- | --- | --- | --- |
| P0 | Production backend must run the audited commit or a known release SHA | Open | Health/ready expose `cf454ed`, not staging SHA `88ed078` |
| P0 | Fresh registration and OTP email delivery | Open | Unit tests pass; live SMTP/fresh account journey not completed in this pass |
| P0 | Final-domain authenticated cookie/CORS smoke | Open | Code/tests allow apex; DNS/Vercel/AWS runtime still needs smoke after cutover |
| P0 | Stripe payment and Connect runtime | Open | Code/tests pass; real/test Stripe execution needs written approval and dedicated accounts |
| P0 | Admin approval/finalize on fresh application | Open | Local tests pass; live destructive workflow not executed |
| P1 | Food default price ceiling | Open | Current backend supports `price=all`; product must decide default behavior |
| P1 | Available marketplace locations endpoint | Open | Location filters apply, but dynamic "only states with listings" source is a product/API follow-up |
| P1 | Production deploy evidence | Open | Promotion/deploy not performed here |
| P2 | Duplicate schema-index warnings | Open | Tests pass but warnings appear for duplicate Mongoose indexes |

## Conclusion

Backend `staging` is coherent with the frontend route contract and passes automated launch-contract gates. It should not be called production launch-ready until the P0 runtime gates are completed on the final domain and production is proven to run the intended release.
